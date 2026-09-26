# 图标迁移表：emoji → 矢量图标

> UI 阶段 1.1 的执行清单。盘点方式：`web/src` 全量扫描（排除测试），
> 结果 **32 个文件 / 269 行含 emoji**；连同符号字形（`✓ ✕ → ⌘`）共 **66 种、274 + 110 次**。
> 组件出口：`web/src/components/Icon.tsx`（语义名 → lucide 组件，五档尺寸，一律 `currentColor`）。
> 背景与论证见 `ui-optimization.md` U-1。

## 0. 先分类，再替换（不是所有 emoji 都该换）

| 类别                         | 处理                                                                      | 例子                                                       |
| ---------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **A. 功能图标**              | 换成 `<Icon name=… />`                                                    | 顶栏 ⚙️ 、工具栏 ⭐ 、状态 ✅                              |
| **B. i18n 串里内嵌的 emoji** | **先把图标从文案里拆出来**，再按 A 处理。否则翻译里带着图标、换库时四处漏 | `settings.mode_split: '⚡ 分屏'`、`'👁 预览'`、`'🌿 主题'` |
| **C. 品牌与装饰**            | 保留或换成 SVG 标志，不走 Icon                                            | `Logo.tsx` 的 🌿、关于页图标                               |
| **D. 用户内容 / 模板正文**   | **不动** —— 那是数据不是 UI                                               | 模板里的 `✅ 待办清单`、笔记正文表情                       |

> 判定口径：出现在 JSX 文本节点或 i18n 的**界面标签**里 = A/B；出现在 `content`/`body` 字段、
> 模板字符串、导出文件里 = D。

## 1. A 类映射表（按出现次数排序，覆盖 ~85% 用量）

| emoji | 次数 | 语义名                   | lucide 组件                  | 主要位置                                                                      |
| ----- | ---- | ------------------------ | ---------------------------- | ----------------------------------------------------------------------------- |
| ✅    | 48   | `shield-check`           | `ShieldCheck`                | `Editor.tsx:567`（已加密保存）                                                |
| ✕ / ✖ | 16   | `close`                  | `X`                          | `AdminConfig.tsx:91` 等（关闭按钮，属符号当图标）                             |
| 🗑    | 13   | `trash`                  | `Trash2`                     | `Editor.tsx:560`                                                              |
| ✓     | 12   | `check`                  | `Check`                      | `SharesManager.tsx:287`                                                       |
| 🔗    | 10   | `link`                   | `Link2`                      | `CommandPalette.tsx:181`、分享                                                |
| 📋    | 9    | `clipboard` / `notebook` | `ClipboardList` / `Notebook` | `DiagnosticsPanel.tsx:115`（⚠️ 同一个 📋 既表示"复制"又表示"模板"，必须拆开） |
| 📁    | 9    | `folder`                 | `Folder`                     | `Editor.tsx:590`                                                              |
| ⚠     | 8    | `warning`                | `AlertTriangle`              | `App.tsx:337`                                                                 |
| 📝    | 8    | `note`                   | `FileText`                   | `CommandPalette.tsx:154`                                                      |
| 📌    | 8    | `pin`                    | `Pin`                        | `Editor.tsx:574`（置顶）                                                      |
| 📦    | 7    | `archive`                | `Archive`                    | `CommandPalette.tsx:205`                                                      |
| ⭐    | 7    | `star`                   | `Star`                       | `Editor.tsx:581`（收藏）                                                      |
| 📱    | 5    | `device`                 | `Smartphone`                 | `AdminConfig.tsx:41`（设备管理）                                              |
| 🔒    | 5    | `lock`                   | `Lock`                       | `CommandPalette.tsx:163`、锁屏                                                |
| 🔍    | 5    | `search`                 | `Search`                     | `CommandPalette.tsx:332`                                                      |
| 🔄    | 5    | `refresh`                | `RefreshCw`                  | `ForceUpdateOverlay.tsx:16`                                                   |
| 🔐    | 5    | `recovery`               | `KeyRound`                   | `i18n.ts:514`（B 类：恢复码）                                                 |
| ✨    | 4    | `wysiwyg`                | `Sparkles`                   | `Editor.tsx:497`                                                              |
| 🎤    | 4    | `mic`                    | `Mic`                        | `VoiceInputButton.tsx:129`                                                    |
| ⚡    | 4    | `split`                  | `SplitSquareHorizontal`      | `i18n.ts:193`（B 类：分屏）                                                   |
| 👁    | 4    | `preview`                | `Eye`                        | `i18n.ts:194`（B 类：预览）                                                   |
| 📥    | 4    | `download`               | `Download`                   | `i18n.ts:553`（B 类：导入）                                                   |
| 💻    | 3    | `desktop`                | `Monitor`                    | `AdminConfig.tsx:34`                                                          |
| ⚙     | 3    | `settings`               | `Settings`                   | `CommandPalette.tsx:172`                                                      |
| 📄    | 3    | `note`                   | `FileText`                   | `Editor.tsx:809`                                                              |
| 🔑    | 3    | `recovery`               | `KeyRound`                   | `i18n.ts:218`                                                                 |
| 🌓    | 2    | `watch-system`           | `Monitor`                    | `CommandPalette.tsx:197`（跟随系统）                                          |
| 🏷    | 2    | `tag`                    | `Tag`                        | `i18n.ts:166`                                                                 |
| ️      | 1    | `admin`                  | `Wrench`                     | 顶栏（已迁移）                                                                |
| ☰    | 1    | `menu`                   | `Menu`                       | 顶栏汉堡（已迁移）                                                            |

## 2. 已迁移（参考实现）

- `web/src/App.tsx` 顶部操作条：`☰` `🛠️` `🔗` `⚙️` `🔒` → `<Icon name="…" />`
  保留原有 `title` + `aria-label`，图标本身 `aria-hidden`，因此屏幕阅读器行为不变、
  视觉尺寸从"emoji 字体的 17px 不确定盒"变成固定 18px 描边盒。

## 3. 迁移规则（后续每个 PR 遵守）

1. **不允许**在 JSX 文本节点或 i18n 界面串里再出现 A/B 类 emoji；新增图标一律 `<Icon name=… />`。
2. B 类拆法：i18n 只留文字（`'分屏'`），图标写在组件里 `<Icon name="split" /> 分屏`。
   拆完必须同步 `scripts/check-i18n.mjs` 的键表，避免中英不对称。
3. 一个 emoji 对应多个语义（📋 = 复制 / 模板；📄 = 笔记 / 文件）时**必须拆成不同语义名**，
   不许复用 —— 复用正是"工具栏 11 个图标里有两个长得几乎一样"的成因。
4. 尺寸只用 14 / 16 / 18 / 20 / 24；描边由 `Icon` 按尺寸给（≤16 用 1.9，更大 1.75）。
5. 没有相邻文字的图标按钮必须有 `aria-label`；纯装饰必须 `aria-hidden`。
6. 四端一致性：mobile 用 `react-native-svg` + 同一份语义名清单；小程序用内联 SVG（data URI）
   或子集化 iconfont。**语义名清单是唯一真相源**，各端只换渲染器。

## 4. 完成判定

`docs/ui-optimization.md` §4 的门禁：**功能图标里的 emoji = 0**。
复核命令（排除 D 类内容字段后应只剩品牌与内容）：

```bash
node -e "const fs=require('fs'),p=require('path');const I=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
let n=0;(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);
if(e.isDirectory()){if(!/node_modules|dist|test/.test(e.name))w(f)}else if(/\.tsx?$/.test(e.name)){
const L=fs.readFileSync(f,'utf8').split('\n');L.forEach((l,i)=>{if(I.test(l)){n++;console.log(f+':'+(i+1),l.trim().slice(0,60))}})}}}})('web/src');
console.log('剩余含 emoji 的行数:', n)"
```
