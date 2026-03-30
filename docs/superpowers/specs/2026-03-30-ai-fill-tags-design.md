# AI 填充标签 + API 配置 设计文档

日期：2026-03-30
状态：待实现

## 1. 功能概述

新增两个相关功能：

1. **填充标签（AI）**：在 MemoCard 的 `···` 菜单中，编辑下方新增此项。点击后调用用户配置的 OpenAI 兼容 API，从现有标签库中自动为当前笔记匹配标签，经用户确认后写入内容开头。
2. **AI 配置**：在 TopBar 导入/导出按钮右侧新增魔杖图标按钮（仅登录后显示），点击打开配置弹窗，可设置 Base URL、API Key、Model。

## 2. UI 设计

### 2.1 TopBar 新增按钮

- 位置：导入/导出图标右侧
- 图标：魔杖 SVG（自行内联，stroke 风格与其他图标一致）
- 仅 `authenticated` 时渲染
- 点击触发 `onAiConfig` 回调

### 2.2 MemoCard ··· 菜单

新菜单顺序（isAuthor 时）：
```
查看详情
分享链接
编辑
填充标签（AI）   ← 新增，绿色，编辑下方
设为私密 / 设为公开
删除
```

- 调用中：按钮文字变为「分析中...」，禁用，菜单保持打开
- 未配置 AI：关闭菜单，Toast "请先配置 AI"

### 2.3 AI 配置弹窗（AiConfigModal）

字段：
- API 地址（Base URL），如 `https://api.openai.com/v1`
- API Key
- 模型，如 `gpt-4o-mini`

- 样式与 `ImportExportModal` 一致，Portal 渲染到 body
- 底部说明：配置保存于本地 localStorage，不上传服务器
- 打开时读取已有配置填充表单

### 2.4 填充标签确认弹窗（内联于 MemoCard）

- Portal 渲染到 body（与 lightbox 同模式）
- 列出 AI 建议的新标签，每个带勾选框，默认全选
- 底部：「取消」/ 「应用」按钮
- 取消全部勾选后点应用 = 无操作

## 3. 数据与存储

### 3.1 AI 配置（localStorage）

```ts
interface AiConfig {
  url: string;     // Base URL，不含末尾斜杠
  apiKey: string;
  model: string;
}
// key: 'meno_ai_config'
```

### 3.2 标签写入格式

新标签追加到内容**开头**：

```
#技术 #读书笔记
原有内容...
```

即：`suggestedTags.map(t => `#${t}`).join(' ') + '\n' + memo.content`

已在 memo 中存在的标签不重复追加——客户端在弹出确认弹窗前，过滤掉 `memo.tags` 中已有的标签。

## 4. AI 调用流程

```
点击「填充标签（AI）」
  ↓
读取 meno_ai_config
  → 未配置 → 关闭菜单 + Toast "请先配置 AI"，结束
  → 已配置 → 按钮变「分析中...」禁用
  ↓
POST {url}/chat/completions
  headers: { Authorization: "Bearer {apiKey}", Content-Type: "application/json" }
  body: {
    model,
    messages: [
      {
        role: "system",
        content: "你是标签推荐助手。只能从用户提供的标签列表中选择，不得新造标签。返回格式为 JSON 数组，如 [\"tag1\",\"tag2\"]，不要包含其他内容。"
      },
      {
        role: "user",
        content: "笔记内容：\n{memo.content}\n\n可用标签列表：{allTags.join(', ')}\n\n请从可用标签中选出适合此笔记的标签。"
      }
    ]
  }
  ↓
解析响应
  → 优先 JSON.parse content
  → 降级：正则 /\[[\s\S]*?\]/ 提取
  → 两种都失败：Toast "AI 返回格式无法解析"，恢复按钮
  ↓
过滤掉 memo.tags 中已有的标签
  → 无新标签：Toast "未找到新的匹配标签"，关闭菜单
  → 有新标签：关闭菜单，弹出确认弹窗
  ↓
用户确认
  → 取消：无操作
  → 应用：newContent = tags + '\n' + memo.content
           调用 onFillTags(memo.id, newContent)
           → HomePage 执行 updateMemoMutation({ id, input: { content: newContent } })
```

## 5. 错误处理

| 情况 | 处理方式 |
|------|----------|
| 未配置 AI | Toast "请先配置 AI" |
| 标签库为空 | Toast "暂无可用标签，请先创建标签" |
| fetch 失败 / HTTP 错误 | Toast "AI 调用失败: {message}" |
| 响应解析失败 | Toast "AI 返回格式无法解析" |
| 无新标签可添加 | Toast "未找到新的匹配标签" |
| 确认弹窗全部取消勾选 | 点应用等同取消，不写入 |
| fillLoading 中重复点击 | 按钮禁用，阻止重复请求 |

Toast 复用 MemoCard 现有的右上角淡出提示样式（`toastMsg` state），2 秒后消失。

## 6. 文件改动清单

| 文件 | 类型 | 改动 |
|------|------|------|
| `frontend/src/lib/ai-config.ts` | 新增 | `getAiConfig` / `setAiConfig` 工具函数 |
| `frontend/src/components/AiConfigModal.tsx` | 新增 | AI 配置弹窗组件 |
| `frontend/src/components/MemoCard.tsx` | 修改 | 新增 `allTags` / `onFillTags` prop；AI 调用逻辑；确认弹窗；Toast |
| `frontend/src/components/MemoTimeline.tsx` | 修改 | 透传 `allTags` / `onFillTags` prop |
| `frontend/src/components/TopBar.tsx` | 修改 | 新增 `onAiConfig` prop；魔杖图标按钮 |
| `frontend/src/pages/HomePage.tsx` | 修改 | 传 `allTags` / `onFillTags` 给 Timeline；`showAiConfig` 状态；`<AiConfigModal>` |

## 7. 不在范围内

- 标签展示位置调整（现有行为已满足：`memo.tags` 在正文前绿色显示，无论标签在内容哪个位置）
- 创建新标签（AI 只从现有标签库匹配）
- 流式响应（一次性返回即可）
- 前端校验 API Key / URL 格式
