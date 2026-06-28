# DustNote 导入导出与分享规范

> 文档版本：v1.0.0
> 适用产品：DustNote · 尘心笔记
> 目标读者：产品 / 开发

---

## 1. 导入规范

### 1.1 支持格式

| 格式 | 扩展名 | 解析方式 | 标题来源 | 备注 |
|------|--------|----------|----------|------|
| 纯文本 | `.txt` | 原样 | 文件名 | 自动按段落切分 |
| Markdown | `.md` / `.markdown` | 原样 | 第一个 `#` 标题 | 保留原始格式 |
| Word 文档 | `.docx` | mammoth → HTML → remark | 第一个 H1 或文件名 | 图片转为附件 |

### 1.2 导入流程

```mermaid
flowchart TD
    A[选择 / 拖拽文件] --> B{格式校验}
    B -- 不支持 --> Z1[提示 仅支持 .txt .md .docx]
    B -- 支持 --> C[解析内容]
    C --> D[生成预览笔记]
    D --> E[加入待确认列表]
    E --> F[用户调整标题 / 标签 / 分类]
    F --> G[批量确认导入]
    G --> H{冲突检测}
    H -- 同 ID --> I[策略: 合并 / 覆盖 / 跳过]
    H -- 无冲突 --> J[直接写入]
    I --> J
    J --> K[返回导入结果]
```

### 1.3 冲突策略

| 策略 | 行为 | 适用场景 |
|------|------|----------|
| 合并 | 保留服务端版本，追加新内容（按 `---` 分隔） | 增量导入 |
| 覆盖 | 用新版本替换服务端 | 强制刷新 |
| 跳过 | 不导入冲突项 | 保守导入 |

### 1.4 大文件处理

- 单文件 > 5MB：分块上传，客户端先压缩为 `.zip`
- 单次导入 > 50 个文件：分批异步处理，进度条展示

### 1.5 .docx 解析细节

```typescript
// 使用 mammoth 将 .docx 转为 HTML
import mammoth from 'mammoth';

const result = await mammoth.convertToHtml({ arrayBuffer });
// 再使用 rehype -> remark 转为 Markdown
// 图片提取为附件
```

---

## 2. 导出规范

### 2.1 支持格式

| 格式 | 适用场景 | 优点 | 限制 |
|------|----------|------|------|
| **Markdown** (.md) | 二次编辑、迁移 | 纯文本、可读 | 富格式有限 |
| **HTML** | 网页分享、归档 | 还原度高 | 文件较大 |
| **PDF** | 长期保存、打印 | 跨平台稳定 | 不可二次编辑 |
| **JSON** | 全量备份 | 完整结构 | 仅本工具可恢复 |

### 2.2 导出范围

- **时间范围**：fromDate / toDate
- **标签筛选**：单标签 / 多标签 AND / OR
- **状态筛选**：全部 / 收藏 / 置顶 / 已删除
- **附件包含**：可选，勾选后附加 `attachments/` 目录

### 2.3 导出包结构（JSON 备份）

```
dustnote-backup-2026-06-27.zip
├── manifest.json           # 导出元信息
├── notes/
│   ├── <note-id>.json      # 单条笔记（标题、内容、标签、元数据）
│   └── ...
├── tags.json               # 标签表
├── preferences.json        # 偏好
└── attachments/
    ├── <note-id>/<file>
    └── ...
```

```json
// manifest.json
{
  "version": "1.0.0",
  "exportedAt": "2026-06-27T10:00:00Z",
  "noteCount": 256,
  "includeAttachments": true,
  "checksum": "sha256:..."
}
```

### 2.4 PDF 导出

- 客户端：Web 用 `@react-pdf/renderer`，移动端用原生 `Print` 桥接
- 样式：注入主题色 → 灰度版（保证打印效果）
- 页眉：标题 + 页码；页脚：`DustNote · 导出于 <日期>`

---

## 3. 分享规范

### 3.1 分享粒度

- 仅支持**单条笔记**分享（v1.x 不支持笔记本 / 文件夹）
- 未来 v2.0 评估"集合分享"（含多条笔记只读视图）

### 3.2 分享属性

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | 是 | nanoid 12 位 |
| `passwordHash` | string \| null | 否 | Argon2id；为空表示无密码 |
| `expiresAt` | ISO 8601 \| null | 否 | null 表示永不过期 |
| `note` | string | 否 | 主人的备注（仅自己可见） |
| `viewCount` | number | - | 服务端计数 |
| `revokedAt` | ISO 8601 \| null | - | 吊销后置位 |

### 3.3 分享 URL 规范

- 短链：`https://dustnote.app/s/<token>`
- API：`https://api.dustnote.app/api/v1/public/shares/<token>`
- 二维码：分享弹层可一键生成，svg 内嵌

### 3.4 访客访问流程

```mermaid
flowchart TD
    A[访问 /s/<token>] --> B{链接有效?}
    B -- 已吊销 / 过期 --> Z1[显示 已失效]
    B -- 有效 --> C{需密码?}
    C -- 否 --> D[渲染笔记]
    C -- 是 --> E[输入密码]
    E --> F{正确?}
    F -- 否 --> G{连续错误?}
    G -- < 5 --> E
    G -- ≥ 5 --> Z2[锁定 1 小时]
    F -- 是 --> D
    D --> H[POST /public/shares/<token>/view 计数 +1]
    H --> I[显示笔记 + 品牌区]
```

### 3.5 分享页面设计

- 极简白底（不受主人主题影响）
- 顶部 4px 薄荷绿横条
- 内容容器最大宽 720px，居中
- 底部品牌区："用 DustNote 记录你的想法 →"（可隐藏）
- 代码块语法高亮、表格、图片均支持
- 移动端：单栏阅读优化

### 3.6 安全约束

- 分享密码不与主密码共享，独立存储哈希
- IP 限流：每 IP 10 次/分钟
- 错误密码计数：5 次锁 1 小时
- 不返回敏感元数据（创建者邮箱等）
- 访问日志仅保留 IP 哈希（SHA-256 + 盐），7 天滚动删除
- 主人可随时吊销，立即失效

### 3.7 查看统计

- 总查看次数
- 最近 7 天 / 30 天趋势
- 不展示访问者身份（隐私保护）

---

## 4. 数据流向图

```mermaid
flowchart LR
    subgraph ImportFlow[导入流]
        FILE[本地文件] --> PARSE[客户端解析]
        PARSE --> QUEUE[待确认队列]
        QUEUE --> API1[POST /import/parse]
        API1 --> DB1[(SQLite)]
    end

    subgraph ExportFlow[导出流]
        QUERY[查询条件] --> API2[POST /export]
        API2 --> GEN[生成器]
        GEN --> ZIP[打包 ZIP]
        ZIP --> URL[临时下载链接]
    end

    subgraph ShareFlow[分享流]
        NOTE[笔记] --> CREATE[创建分享]
        CREATE --> TOKEN[生成 token]
        TOKEN --> LINK[短链 + 二维码]
        LINK --> VISITOR[访客访问]
        VISITOR --> COUNTER[查看次数 +1]
    end
```

---

## 5. 边界与异常

### 5.1 导入异常

| 场景 | 表现 | 处理 |
|------|------|------|
| 格式不支持 | 拖入 `.pdf` | 红色 Toast + 提示 |
| 文件损坏 | docx 无法解析 | 标记为"失败"行，可重试或跳过 |
| 网络中断 | 批量导入到一半 | 失败项可重新加入队列 |
| 文件超大 | > 10MB | 提示压缩后重试 |

### 5.2 导出异常

| 场景 | 表现 | 处理 |
|------|------|------|
| 笔记为空 | 没有匹配项 | 禁用导出按钮 + 提示 |
| PDF 渲染失败 | 库异常 | 降级为 HTML 导出 |
| 临时链接过期 | 1 小时 | 重新生成 |

### 5.3 分享异常

| 场景 | 表现 | 处理 |
|------|------|------|
| 链接被吊销 | 主人删除 | 访客看到"已失效" |
| 链接过期 | 超过 expiresAt | 访客看到"链接已过期" |
| 笔记被删除 | 主人软删除 | 主人可在 30 天内恢复 |
| 笔记永久删除 | 主人彻底删除 | 自动吊销关联分享 |
