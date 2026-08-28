/**
 * 轻量 Markdown 渲染组件（只读预览）
 *
 * 不引入 react-native-markdown-display（未安装），手写轻量渲染：
 * - 标题（# ~ ######）
 * - 粗体 **text** / 斜体 *text* / 行内代码 `code`
 * - 代码块（``` 围栏）
 * - 链接 [text](url)（点击调用 Linking.openURL）
 * - 列表（- / * / 1.）与引用（>）
 * - 分割线（---）
 *
 * 仅用于编辑页「预览」模式的只读展示。
 */

import React from 'react';
import { View, Text, Linking, StyleSheet } from 'react-native';
import type { ThemeColors } from '../theme';

interface Span {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link' | 'wikilink';
  text: string;
  url?: string;
}

/** 解析行内格式：粗体 / 斜体 / 行内代码 / 链接 / wikilink */
function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[\[[^\]|]+(?:\|[^\]]+)?\]\])|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1]) {
      spans.push({ type: 'code', text: m[1].slice(1, -1) });
    } else if (m[2]) {
      spans.push({ type: 'bold', text: m[2].slice(2, -2) });
    } else if (m[3]) {
      spans.push({ type: 'italic', text: m[3].slice(1, -1) });
    } else if (m[4]) {
      // wikilink: [[title]] 或 [[title|display]]
      const inner = m[4].slice(2, -2); // 去掉 [[ 和 ]]
      const pipeIdx = inner.indexOf('|');
      const title = pipeIdx >= 0 ? inner.slice(0, pipeIdx).trim() : inner.trim();
      const display = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : title;
      spans.push({ type: 'wikilink', text: display, url: title });
    } else if (m[5]) {
      const inner = m[5];
      const sep = inner.indexOf('](');
      const label = inner.slice(1, sep);
      const url = inner.slice(sep + 2, -1);
      spans.push({ type: 'link', text: label, url });
    }
    last = re.lastIndex;
  }
  if (last < text.length) spans.push({ type: 'text', text: text.slice(last) });
  return spans;
}

function InlineText({ text, colors }: { text: string; colors: ThemeColors }) {
  const spans = parseInline(text);
  return (
    <Text style={{ color: colors.fg }}>
      {spans.map((s, i) => {
        switch (s.type) {
          case 'bold':
            return (
              <Text key={i} style={{ fontWeight: '700', color: colors.fg }}>
                {s.text}
              </Text>
            );
          case 'italic':
            return (
              <Text key={i} style={{ fontStyle: 'italic', color: colors.fg }}>
                {s.text}
              </Text>
            );
          case 'code':
            return (
              <Text
                key={i}
                style={{
                  fontFamily: 'monospace',
                  backgroundColor: colors.accentSoft,
                  color: colors.fg,
                }}
              >
                {s.text}
              </Text>
            );
          case 'link':
            return (
              <Text
                key={i}
                style={{ color: colors.accent, textDecorationLine: 'underline' }}
                onPress={() => void Linking.openURL(s.url ?? '')}
              >
                {s.text}
              </Text>
            );
          case 'wikilink':
            return (
              <Text
                key={i}
                style={{ color: colors.accent, textDecorationLine: 'underline', fontWeight: '500' }}
                onPress={() => {
                  // TODO: 跳转到目标笔记（需要导航到搜索或笔记详情）
                  // 当前仅显示为可点击链接样式
                }}
              >
                📄 {s.text}
              </Text>
            );
          default:
            return <Text key={i}>{s.text}</Text>;
        }
      })}
    </Text>
  );
}

export function MarkdownView({
  title,
  content,
  colors,
}: {
  title?: string;
  content: string;
  colors: ThemeColors;
}) {
  const styles = makeStyles(colors);
  const blocks: React.ReactNode[] = [];

  const lines = content.split('\n');
  let inCode = false;
  let codeLines: string[] = [];
  let key = 0;

  const pushCodeBlock = () => {
    if (codeLines.length > 0) {
      blocks.push(
        <View key={key++} style={styles.codeBlock}>
          <Text style={styles.codeText}>{codeLines.join('\n')}</Text>
        </View>
      );
      codeLines = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    // 代码块围栏
    if (/^\s*```/.test(line)) {
      if (inCode) {
        inCode = false;
        pushCodeBlock();
      } else {
        pushCodeBlock();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        <Text
          key={key++}
          style={[styles.heading, { fontSize: Math.max(16, 24 - (level - 1) * 2) }]}
        >
          {heading[2]}
        </Text>
      );
      continue;
    }
    // 分割线
    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push(<View key={key++} style={styles.hr} />);
      continue;
    }
    // 引用
    if (/^>\s?/.test(trimmed)) {
      blocks.push(
        <View key={key++} style={styles.quote}>
          <InlineText text={trimmed.replace(/^>\s?/, '')} colors={colors} />
        </View>
      );
      continue;
    }
    // 列表
    const list = /^([-*+]|\d+[.)])\s+(.*)$/.exec(trimmed);
    if (list) {
      blocks.push(
        <View key={key++} style={styles.listRow}>
          <Text style={styles.listBullet}>
            {/^\d/.test(list[1]) ? `${list[1].replace(/[.)]/, '')}.` : '•'}
          </Text>
          <View style={styles.listTextWrap}>
            <InlineText text={list[2]} colors={colors} />
          </View>
        </View>
      );
      continue;
    }
    // 普通段落
    blocks.push(
      <Text key={key++} style={styles.paragraph}>
        <InlineText text={line} colors={colors} />
      </Text>
    );
  }
  if (inCode) pushCodeBlock();

  return (
    <View style={styles.container}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {blocks}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { paddingHorizontal: 16, paddingVertical: 12 },
    title: { fontSize: 24, fontWeight: '700', color: c.fg, marginBottom: 12 },
    heading: { fontWeight: '700', color: c.fg, marginTop: 12, marginBottom: 6 },
    paragraph: { fontSize: 16, lineHeight: 24, color: c.fg, marginBottom: 8 },
    codeBlock: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 6,
      padding: 10,
      marginBottom: 8,
    },
    codeText: { fontFamily: 'monospace', fontSize: 13, color: c.fg },
    quote: {
      borderLeftColor: c.accent,
      borderLeftWidth: 3,
      paddingLeft: 10,
      marginBottom: 8,
      opacity: 0.85,
    },
    listRow: { flexDirection: 'row', marginBottom: 6 },
    listBullet: { width: 20, fontSize: 16, color: c.muted },
    listTextWrap: { flex: 1 },
    hr: { height: 1, backgroundColor: c.border, marginVertical: 10 },
  });
}
