# Meno

一个自托管的轻量级笔记应用，灵感来自 [flomo](https://flomoapp.com)，基于 Cloudflare 全栈部署。

## 特性

### 笔记
- Markdown 编辑器，支持加粗、斜体、下划线、有序/无序列表、代码块
- 发布编辑器会随段落内容自动增高，长文达到上限后才在输入框内滚动
- 发布编辑器有低调的草稿取消按钮，可一键清空正文、图片、语音草稿并恢复默认选项
- 代码块内容（围栏 ` ``` ` 和行内 `` ` ``）不识别为标签，渲染时等宽字体 + 水平滚动
- 图片上传与缩略图预览，支持删除，不暴露图床链接
- 收藏笔记（⭐），侧边栏独立收藏 tab，收藏状态仅作者可见
- 置顶笔记（📌），置顶笔记在全部和收藏 tab 中始终排在最前
- 笔记卡片展开/收起，短笔记全文显示，长笔记按完整行自动截断，避免收起态切掉半行文字
- 分享链接，一键复制笔记独立访问地址
- 字数统计、创建时间、编辑时间显示
- 软删除 → 回收站 → 30 天后自动彻底删除（含图床清理）

### 标签
- `#标签` 自动解析，支持 `#一级/二级` 层级标签
- 输入 `#` 弹出标签建议下拉框，支持键盘上下键选择、Enter 确认、Escape 关闭
- 侧边栏标签树，分组折叠/展开
- 点击标签名筛选笔记，点击箭头折叠子标签
- 选中标签整行绿色高亮
- **标签管理**：侧边栏标签右侧 `···` 菜单，支持重命名（自动更新所有笔记内容和子标签）和删除（仅删标签或连同笔记移入回收站）
- **AI 填充标签**：在笔记菜单中一键调用 OpenAI 兼容 API，从现有标签库自动匹配标签，弹窗确认后前置写入笔记

### 筛选
- 公开/私密、有/无标签、有/无图片 三组筛选条件
- 点击循环切换：选项 A → 选项 B → 清除
- 日历热力图，点击日期筛选当天笔记
- 「那年今日」查看往年同日笔记，有历史笔记时侧边栏显示绿点提示
- 「每日回顾」随机展示 3 篇笔记

### 响应式
- 桌面端：侧边栏 + 居中内容区
- 移动端：侧边栏收起，点击汉堡菜单滑出，点击遮罩关闭
- 刷新按钮强制同步多端数据

### AI
- TopBar 魔杖按钮配置 AI（Base URL / API Key / Model），兼容 OpenAI 接口，配置存于本地 localStorage
- 支持填写完整 endpoint URL 或 Base URL 两种格式
- 内置验证按钮，一键测试配置是否可用
- 侧边栏提供「深度对话」，以页面视图打开，仅基于公开笔记做 RAG 检索问答
- 支持手动“重建知识库索引”，首次启用时可全量同步历史笔记
- 支持 OCR 队列状态查看、手动跑一轮 OCR，图片中的文字会持久化后接入知识库索引
- RAG 默认会混合向量检索和关键词检索，并对候选资料做摘要裁剪与 token 预算控制，以适配 GitHub Models 等免费模型

### API
- Quick API：通过 `X-API-Key` 认证，支持 POST 创建笔记和上传图片
- 适配苹果快捷指令、自动化工具等场景
- 稳定外部 API：`/api/v1/memos` 支持列表、创建、读取、更新、软删除，`/api/v1/export` 支持完整导出
- OpenAPI 文档：`/openapi.json` 提供机器可读接口说明，方便 AI 助手、客户端和自动化工具接入
- 私密分享：作者可为私密 memo 生成 share token 链接，撤销后链接立即失效
- 设置模型：后端提供站点标题、默认可见性等 settings 存储接口
- MCP Server：实现 MCP (Model Context Protocol) Streamable HTTP 端点，让 AI 助手可以对笔记进行增删改查

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + Vite + TypeScript |
| 后端 | Cloudflare Workers + Hono |
| 数据库 | Cloudflare D1 (SQLite) |
| 图床 | Cloudflare R2 |
| 检索 | Cloudflare Vectorize + Workers AI |
| 认证 | GitHub OAuth + Session |
| 部署 | Cloudflare Pages + Workers |

## 快速开始

### 前置条件
- Node.js 18+
- Cloudflare 账号（免费）
- GitHub OAuth App

### 部署

```bash
# 安装依赖
npm install

# 初始化 D1 数据库
cd worker
npx wrangler d1 create meno
npx wrangler d1 execute meno --file=migrations/001_init.sql
npx wrangler d1 execute meno --file=migrations/002_add_pinned.sql
npx wrangler d1 execute meno --file=migrations/003_add_favorited.sql
npx wrangler d1 execute meno --file=migrations/004_add_memo_image_ocr.sql

# 创建 R2 存储桶
npx wrangler r2 bucket create meno-assets

# 创建知识库向量索引
npx wrangler vectorize create meno-memos --dimensions=1024 --metric=cosine

# 配置 worker/wrangler.local.toml 中的环境变量与绑定
# 至少需要：D1 / R2 / AI / VECTORIZE / GitHub OAuth / SESSION_SECRET

# 设置 API_TOKEN secret
echo "your-token" | npx wrangler secret put API_TOKEN

# 部署 Worker（本地使用含真实配置的 wrangler.local.toml）
npx wrangler deploy --config wrangler.local.toml

# 部署前端
cd ../frontend
npx vite build
npx wrangler pages deploy dist --project-name=meno
```

详细配置参考 `docs/` 目录。

### 部署前验证

```bash
# 检查 worker/wrangler.local.toml 关键配置
npm run config:check

# 部署前严格检查，避免 Wrangler dry-run/deploy 打印 secret 类变量
npm run config:check:deploy

# 配置检查 + 类型检查 + 测试
npm run verify

# 构建前端并对 Worker 做 dry-run，不直接上线
npm run deploy:dry-run
```

正式部署：

```bash
# 先 verify，再部署前端和 Worker
npm run deploy

# 或拆开部署
npm run deploy:frontend
npm run deploy:worker
```

说明：

- Worker 部署必须使用 `worker/wrangler.local.toml`。
- `worker/wrangler.toml` 是提交到仓库的占位模板，不用于真实部署。
- `GITHUB_CLIENT_SECRET`、`SESSION_SECRET`、`API_TOKEN` 等 secret 类配置应使用 Wrangler secrets；部署前严格检查会阻止它们留在 `[vars]` 中。
- Agent 部署流程参考 `docs/agent-deploy.md`，人工部署流程参考 `docs/deploy-runbook.md`。

### GitHub Actions 自动部署

仓库包含 `.github/workflows/deploy.yml`。推送到 `main` 后会自动：

1. 安装依赖并执行类型检查与测试。
2. 生成临时 `worker/wrangler.ci.toml`。
3. 执行 D1 migrations。
4. 同步 Worker secrets。
5. 部署 Cloudflare Worker。
6. 构建并部署 Cloudflare Pages 前端。

需要在 GitHub 仓库配置以下 Secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `D1_DATABASE_ID`
- `OAUTH_CLIENT_SECRET`（写入 Worker 时会同步为 `GITHUB_CLIENT_SECRET`）
- `SESSION_SECRET`
- `API_TOKEN`

需要配置以下 Variables：

- `OAUTH_ALLOWED_LOGIN`（生成 Worker 配置时会写入 `GITHUB_ALLOWED_LOGIN`）
- `OAUTH_CLIENT_ID`（生成 Worker 配置时会写入 `GITHUB_CLIENT_ID`）
- 可选：`APP_ORIGIN`、`API_ORIGIN`、`ASSET_PUBLIC_BASE_URL`、`OCR_DAILY_LIMIT`、`OCR_BATCH_SIZE`、`OCR_SEED_BATCH_SIZE`

## 知识库启用

1. 在 `worker/wrangler.local.toml` 中补上 `[ai] binding = "AI"` 和 `[[vectorize]] binding = "VECTORIZE"`。
2. 确认 `index_name = "meno-memos"`。
3. 配好 `SESSION_SECRET`、GitHub OAuth、`API_TOKEN` 等必需配置。
4. 重新部署 Worker。
5. 作者登录后，点击侧边栏里的“深度对话”。
6. 先执行一次“重建知识库索引”，再开始提问。

说明：

- 只有 `public` 笔记会进入知识库索引；`private` 笔记不会被向量化，也不会参与深度对话检索。
- 深度对话会先做向量召回，再叠加关键词召回；随后按相关性排序，并在写入模型 prompt 前做 token 预算裁剪。
- 当前默认参数面向 GitHub Models 免费层做了保守控制：较少的候选条数、较长的单条摘录、较短的历史消息。

## OCR 图片文字入库

1. 新增或编辑带图片的笔记时，图片会自动进入 OCR 队列。
2. 历史图片不会一次性全量 OCR，而是按批次逐步补录。
3. 可在“深度对话”页查看 OCR 队列状态，并手动跑一轮 OCR。
4. OCR 成功后，会只增量重建对应那一条 memo 的知识库索引，不会全量重建。

可调参数：

- `OCR_DAILY_LIMIT`：每天最多 OCR 的图片数
- `OCR_BATCH_SIZE`：单轮最多实际 OCR 的图片数
- `OCR_SEED_BATCH_SIZE`：单轮最多补入队列的历史 memo 数

## Quick API 用法

### 创建笔记

```bash
curl -X POST https://your-api.workers.dev/api/quick/memos \
  -H "X-API-Key: your-token" \
  -H "Content-Type: application/json" \
  -d '{"content": "想法 #标签", "images": ["https://..."]}'
```

### 上传图片

```bash
curl -X POST https://your-api.workers.dev/api/quick/upload \
  -H "X-API-Key: your-token" \
  -F "file=@photo.jpg"
```

## MCP Server

Meno 内置了 [MCP (Model Context Protocol)](https://modelcontextprotocol.io) 端点，支持 Streamable HTTP 传输协议。AI 助手（如 Claude、Hermes 等）可以通过 MCP 对笔记进行增删改查。

### 可用工具

| 工具 | 说明 |
|------|------|
| `list_memos` | 列出笔记，支持按标签、日期、关键词筛选 |
| `get_memo` | 按 slug 查看单条笔记 |
| `create_memo` | 创建笔记，内容中的 `#标签` 自动解析 |
| `update_memo` | 编辑笔记内容、可见性或日期 |
| `delete_memo` | 将笔记移入回收站 |

### 连接配置

- **URL**: `https://your-api.workers.dev/api/mcp`
- **认证**: `Authorization: Bearer <API_TOKEN>`

### 测试

```bash
curl -X POST https://your-api.workers.dev/api/mcp \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 更新日志

### 2026-06-29

- 新增 GitHub Actions 自动部署：push 到 `main` 后自动验证、执行 D1 migrations、同步 Worker secrets、部署 Worker 和 Cloudflare Pages。
- 修正 GitHub Actions 自动部署配置命名：仓库 secrets/variables 使用 `OAUTH_*`，避开 GitHub 保留的 `GITHUB_*` 前缀限制，生成 Worker 配置时仍写回应用需要的 `GITHUB_*` 名称。
- 修正 GitHub Actions 验证流程：CI 环境不再依赖本地-only 的 `worker/wrangler.local.toml`，改为运行类型检查和测试，部署时生成临时 `worker/wrangler.ci.toml`。
- 修正 GitHub Actions Worker 构建步骤：CI 使用 `worker/wrangler.ci.toml` 做 dry-run，不再调用依赖本地配置的 `worker` build 脚本。
- 新增 CI 专用 Wrangler 配置生成脚本和 D1 migration 执行脚本，避免把真实 Cloudflare 配置写入仓库。
- 新增 UI primitive 第一批：抽出 `IconButton` 并迁移 TopBar 操作按钮，统一按钮语义、禁用态和可访问标签。
- 优化首屏加载：`DeepChatModal`、`ImportExportModal`、`AiConfigModal` 改为 lazy import，避免随首页主 bundle 一起加载。
- 新增 `memo_shares` 和 `app_settings` 数据模型：私密 memo 可生成 share token 链接，settings 支持站点标题和默认可见性。
- 私密 memo 的卡片分享按钮已接入 share token，公开 memo 仍复制原公开详情页链接。
- 优化图片缩略图链路：上传图片时返回并保存 Cloudflare Image Resizing `previewUrl`，列表页优先加载缩略图，点击预览仍打开原图。
- 新增稳定外部 API：`/api/v1/memos` 支持笔记列表、创建、读取、更新和软删除，`/api/v1/export` 支持导出包含回收站在内的 memo 数据。
- 新增 `/openapi.json` 机器可读 API 文档，并补充 v1 请求校验层，复用现有 `API_TOKEN` 鉴权。
- 新增 v1 API 测试，覆盖 OpenAPI、鉴权、列表、创建、更新、删除和导出流程。
- 修复 `streakDays` 统计逻辑，从“最早公开笔记到今天的跨度”改为按公开 memo 的连续 `display_date` 计算，避免日期变化导致测试和侧边栏统计漂移。
- 修复 MCP 路由测试的 TypeScript 类型标注，使 Worker `typecheck` 可以通过。
- 新增部署工程化脚本：`config:check`、`verify`、`deploy:dry-run`、`deploy:frontend`、`deploy:worker` 和 `deploy`，统一部署前检查与发布入口。
- 新增 `docs/agent-deploy.md` 和 `docs/deploy-runbook.md`，明确 Agent/人工部署顺序，并固定 Worker 使用 `worker/wrangler.local.toml`。
- 修复前端日历筛选测试的硬编码月份，使 `npm run verify` 不再因当前运行月份变化而失败。
- 加固部署前配置检查：新增 `config:check:deploy`，阻止 secret 类变量留在 `worker/wrangler.local.toml` 的 `[vars]` 中，避免 Wrangler dry-run/deploy 输出敏感值。
- 优化首页列表性能：`/api/public/memos` 和 `/api/dashboard/memos` 支持 `limit/cursor` 分页，首页默认首屏只拉取 20 条 memo，滚动到底再加载下一页。
- 优化 `MemoCard` 渲染：缓存图片提取、正文清洗和字数统计结果，纯文本 memo 跳过 `ReactMarkdown`，降低列表滚动和首屏渲染开销。

## 开源协议

MIT
