/**
 * 轻量 Markdown 渲染器（小程序/H5 通用）
 *
 * 设计取舍：
 * - 直接渲染 React 元素，不使用 innerHTML/RichText，从根上避免 XSS
 *   （笔记内容来自用户自己或访客分享，但分享内容可能是陌生人写的）
 * - 支持的语法子集：标题、粗体、斜体、行内代码、代码块、链接、
 *   无序/有序列表、引用、分隔线、段落
 * - 链接只放行 http/https 相对路径，过滤 javascript: 等危险协议
 */

import React from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';

/** 判断链接协议是否安全（仅放行 http/https/相对路径） */
function isSafeUrl(url: string): boolean {
  if (url.startsWith('/')) return true;
  return /^https?:\/\//i.test(url);
}

function copyLink(url: string) {
  void Taro.setClipboardData({ data: url }).then(() => {
    Taro.showToast({ title: '链接已复制', icon: 'none' });
  });
}

// 行内语法：行内代码优先，避免 ** 或 [ 在代码里被误解析
const INLINE_RE = /(`[^`]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;

/** 渲染一行内联内容（粗体/斜体/行内代码/链接） */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let index = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    const key = `${keyPrefix}-${index++}`;
    if (m[1]) {
      // `code`
      nodes.push(
        <Text key={key} className="md-code-inline">
          {m[1].slice(1, -1)}
        </Text>
      );
    } else if (m[2]) {
      // **bold**
      nodes.push(
        <Text key={key} className="md-strong">
          {m[2].slice(2, -2)}
        </Text>
      );
    } else if (m[3]) {
      // *italic*
      nodes.push(
        <Text key={key} className="md-em">
          {m[3].slice(1, -1)}
        </Text>
      );
    } else if (m[4]) {
      // [text](url)
      const linkMatch = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(m[4]);
      if (linkMatch && isSafeUrl(linkMatch[2]!)) {
        nodes.push(
          <Text key={key} className="md-link" onClick={() => copyLink(linkMatch[2]!)}>
            {linkMatch[1]}
          </Text>
        );
      } else {
        nodes.push(m[4]);
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

/** 识别分隔线：--- / *** / ___ */
const HR_RE = /^\s*([-*_])\s*\1\s*\1\s*$/;
/** 识别无序列表项 */
const UL_ITEM_RE = /^\s*[-*+]\s+(.+)$/;
/** 识别有序列表项 */
const OL_ITEM_RE = /^\s*(\d+)[.)]\s+(.+)$/;
/** 识别标题 */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
/** 识别引用 */
const QUOTE_RE = /^\s*>\s?(.*)$/;
/** 代码块围栏 */
const FENCE_RE = /^\s*(```|~~~)/;

interface BlockItem {
  type: 'fence' | 'ul' | 'ol' | 'quote' | 'heading' | 'hr' | 'para';
  level?: number;
  text?: string;
  items?: string[];
}

/** 把文本行分组为块（代码块 / 列表 / 引用 / 标题 / 段落） */
function groupBlocks(lines: string[]): BlockItem[] {
  const blocks: BlockItem[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // 代码块（围栏）
    if (FENCE_RE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i]!)) {
        code.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // 跳过结束围栏
      blocks.push({ type: 'fence', text: code.join('\n') });
      continue;
    }

    // 分隔线
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 标题
    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: Math.min(heading[1]!.length, 6), text: heading[2] });
      i++;
      continue;
    }

    // 引用：连续多行合并为一个引用块
    if (QUOTE_RE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length) {
        const q = QUOTE_RE.exec(lines[i]!);
        if (!q) break;
        quote.push(q[1] ?? '');
        i++;
      }
      blocks.push({ type: 'quote', text: quote.join('\n') });
      continue;
    }

    // 无序列表：连续项合并
    const ul = UL_ITEM_RE.exec(line);
    if (ul) {
      const items: string[] = [];
      while (i < lines.length) {
        const li = UL_ITEM_RE.exec(lines[i]!);
        if (!li) break;
        items.push(li[1]!);
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // 有序列表：连续项合并
    const ol = OL_ITEM_RE.exec(line);
    if (ol) {
      const items: string[] = [];
      let num = Number.parseInt(ol[1]!, 10);
      while (i < lines.length) {
        const li = OL_ITEM_RE.exec(lines[i]!);
        if (!li) break;
        items.push(`${num}. ${li[2]!}`);
        num++;
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // 普通段落：连续非空行合并
    if (trimmed) {
      const para: string[] = [];
      while (i < lines.length) {
        const l = lines[i]!.trim();
        if (
          !l ||
          HR_RE.test(l) ||
          UL_ITEM_RE.test(l) ||
          OL_ITEM_RE.test(l) ||
          QUOTE_RE.test(l) ||
          FENCE_RE.test(l)
        ) {
          break;
        }
        para.push(l);
        i++;
      }
      blocks.push({ type: 'para', text: para.join('\n') });
      continue;
    }

    i++; // 空行
  }
  return blocks;
}

function renderList(items: string[], ordered: boolean, keyPrefix: string): React.ReactNode {
  return (
    <View key={keyPrefix} className={ordered ? 'md-ol' : 'md-ul'}>
      {items.map((item, idx) => {
        // 有序列表项已带 "n. " 前缀，解析出序号与内容
        const n = ordered ? /^(\d+)\.\s+(.*)$/.exec(item) : null;
        const prefix = ordered && n ? `${n[1]}. ` : ordered ? '• ' : '• ';
        const body = ordered && n ? n[2]! : item;
        return (
          <View key={`${keyPrefix}-${idx}`} className="md-li">
            <Text className="md-li-marker">{prefix}</Text>
            <Text className="md-li-body">{renderInline(body, `${keyPrefix}-${idx}`)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function renderBlocks(blocks: BlockItem[]): React.ReactNode[] {
  return blocks.map((b, idx) => {
    const key = `md-${idx}`;
    switch (b.type) {
      case 'fence':
        return (
          <View key={key} className="md-pre">
            <Text className="md-code">{b.text}</Text>
          </View>
        );
      case 'heading': {
        const cls = `md-h${b.level ?? 1}`;
        return (
          <Text key={key} className={cls}>
            {renderInline(b.text ?? '', key)}
          </Text>
        );
      }
      case 'quote':
        return (
          <View key={key} className="md-quote">
            <Text className="md-quote-text">{renderInline(b.text ?? '', key)}</Text>
          </View>
        );
      case 'hr':
        return <View key={key} className="md-hr" />;
      case 'ul':
        return renderList(b.items ?? [], false, key);
      case 'ol':
        return renderList(b.items ?? [], true, key);
      case 'para':
      default:
        return (
          <Text key={key} className="md-p">
            {renderInline(b.text ?? '', key)}
          </Text>
        );
    }
  });
}

/**
 * 轻量 Markdown 渲染组件
 * @param content Markdown 原文（纯文本）
 */
export default function Markdown({ content }: { content: string }) {
  const lines = (content ?? '').split(/\r?\n/);
  return <View className="md">{renderBlocks(groupBlocks(lines))}</View>;
}
