# Meno

Meno 是一个面向个人使用的轻量级自托管知识站：公开访客可以直接阅读，作者登录后可以随手记录、管理私密内容，并通过 API、MCP 与 AI 工具复用自己的笔记。

- 站点：<https://meno.guoyingwei.top>
- API：<https://api.meno.guoyingwei.top>
- 技术栈：React 19、Vite、TypeScript、Hono、Cloudflare Pages、Workers、D1、R2、Vectorize 与 Workers AI

## 核心能力

### 记录与整理

- Markdown 笔记、层级标签、置顶、收藏、公开/私密、回收站和按日期展示。
- Composer 随内容自动增高；超过 `min(60vh, 420px)` 后才在输入框内滚动。
- 图片、录音、语音转写和图片 OCR；附件不会在界面中暴露原始 R2 对象地址。
- 标签树、日历热力图、那年今日、每日回顾、全文搜索和服务端筛选。
- 私密 Memo 可生成带可选过期时间的分享链接，并可随时撤销。

### 离线与可靠性

- 正文、日期、可见性、标签、图片 Blob 和录音 Blob 自动保存到 IndexedDB。
- 断网或网络失败时发布内容进入 outbox；恢复网络后自动重放。
- Memo 与附件使用 `client_id` 幂等，重复请求不会重复创建数据或对象。
- 删除、取消和失败上传会进入可重试的附件清理流程。
- OCR、语音转写和知识库同步使用持久队列、lease、重试与 revision fencing。

### 安全

- GitHub OAuth 登录；Cookie session 在 D1 中校验有效期和吊销状态。
- Cookie 鉴权的写请求校验 `Origin`，响应包含 CSP、frame 限制等安全头。
- Markdown 默认禁用原始 HTML，并过滤危险 URL。
- 私密附件读取会同时校验 Memo 关系和作者权限。
- 上传限制 MIME、扩展名、数量和大小，对象名使用高熵 ID。
- 私密或已删除内容不会进入公开 Feed、公开统计或第三方模型调用。

### AI、API 与自动化

- OpenAI 兼容的 AI 配置、AI 标签建议和基于公开笔记的深度对话。
- Quick API 适配苹果快捷指令等轻量自动化。
- `/api/v1` 提供稳定的 Memo CRUD 与导出接口。
- `/api/mcp` 提供 MCP Streamable HTTP 服务。
- `/openapi.json` 提供机器可读的 OpenAPI 文档。

PWA 安装、service worker 缓存和更新提示不在当前范围内；Meno 作为普通网页可完整使用。

## 架构

| 层 | 实现 | 职责 |
|---|---|---|
| Web | React 19 + Vite + TanStack Query | 首页、Composer、公开阅读与作者界面 |
| API | Cloudflare Workers + Hono | 鉴权、公开/作者 API、Quick API、V1、MCP |
| 数据 | Cloudflare D1 | Memo、标签、session、分享、FTS5 与持久队列 |
| 对象 | Cloudflare R2 | 图片、录音、备份与受控附件读取 |
| 检索 | Vectorize + Workers AI | 公开知识库检索、OCR 与语音处理 |
| 前端托管 | Cloudflare Pages | SPA 与安全响应头 |

主要目录：

```text
frontend/          React 前端
worker/            Hono Worker、D1 migration 与测试
shared/            前后端共享类型
scripts/           配置检查、migration、部署配置与性能采样
docs/              部署 runbook、整改清单与设计说明
```

## 本地开发

要求 Node.js 18+，推荐使用与 lockfile 一致的 npm。

```bash
npm install
npm run dev --workspace worker
npm run dev --workspace frontend
```

默认情况下，前端和 Worker 分别由各自 workspace 的开发命令启动。Cloudflare 绑定、域名和 OAuth 回调地址需要在本地配置中与实际环境保持一致。

## Cloudflare 资源与配置

首次部署需要创建或准备：

- D1 数据库 `meno`
- R2 bucket `meno-assets`
- Vectorize index `meno-memos`（1024 dimensions，cosine）
- Workers AI binding
- GitHub OAuth App
- Cloudflare Pages 项目 `meno`

Wrangler 配置分工：

| 文件 | 用途 | 是否提交 |
|---|---|---|
| `worker/wrangler.toml` | 占位模板和本地 Worker dry-run | 是 |
| `worker/wrangler.local.toml` | 本机真实绑定与非 secret 配置的来源 | 否 |
| `worker/wrangler.deploy.toml` | 从 local 配置临时生成的去敏部署文件 | 否 |
| `worker/wrangler.ci.toml` | GitHub Actions 临时生成的 CI 配置 | 否 |

`GITHUB_CLIENT_SECRET`、`SESSION_SECRET`、`API_TOKEN` 必须使用 Wrangler secrets 或 CI secrets，不能放入 `[vars]`、README、日志或提交记录。`npm run config:check:deploy` 会生成权限为 `0600` 的临时 `worker/wrangler.deploy.toml`，并剔除这些 secret 类变量。

## 数据库 Migration

Migration 是对同一个 D1 数据库进行增量 schema 升级，不是把数据搬到另一个数据库，也不会清空 Memo、附件或设置。

必须通过 Wrangler migration ledger 应用尚未执行的 migration，不能逐个使用 `d1 execute` 重放 SQL：

```bash
npm run deploy:migrations
```

部署顺序固定为：

```text
D1 migration → Worker → Pages
```

新 Worker 可能依赖新字段、索引或队列表，因此不要颠倒顺序。删除生产 session 是独立的破坏性维护，不属于 migration，也不会被任何部署脚本自动执行。

## 验证与部署

### 部署前门禁

```bash
npm run config:check
npm run typecheck
npm test
npm run build
npm run config:check:deploy
npm run deploy:dry-run
```

也可以运行聚合校验：

```bash
npm run verify
```

### 正式部署

一键按正确顺序部署：

```bash
npm run deploy
```

或分步执行：

```bash
npm run deploy:migrations
npm run deploy:worker
npm run deploy:frontend
```

部署脚本以 `worker/wrangler.local.toml` 为真实配置源，生成并使用临时去敏的 `worker/wrangler.deploy.toml`。不要用仓库中的占位 `worker/wrangler.toml` 部署生产 Worker。

部署和验证完成后清理临时配置：

```bash
npm run config:clean:deploy
```

人工操作细节见 [部署 Runbook](docs/deploy-runbook.md)，Agent 约束见 [Agent 部署 Runbook](docs/agent-deploy.md)。

### GitHub Actions

`.github/workflows/deploy.yml` 可在推送 `main` 后执行校验、生成 CI 配置、应用 D1 migration、同步 Worker secrets，并部署 Worker 与 Pages。所需 Secrets/Variables 及顺序说明以 [部署 Runbook](docs/deploy-runbook.md) 为准。

## 生产烟测与性能检查

部署后至少验证：

- 首页、公开统计、20 条公开 Feed 和 `/api/me` 返回 200。
- 匿名 `/api/me` 返回 `viewer`，匿名作者接口返回 401。
- CSP、`X-Content-Type-Options`、`Referrer-Policy` 和 frame 限制存在。
- 公开 Feed 返回摘要字段，第二次相同请求可命中边缘缓存。
- Composer 在身份接口或 Feed 失败时仍可输入，私密附件不能匿名读取。

公开 Feed 的只读采样脚本不会发送认证信息或打印正文：

```bash
node scripts/measure-public-feed.mjs \
  --url 'https://api.meno.guoyingwei.top/api/public/memos?limit=20' \
  --samples 20 \
  --json
```

使用本机 Chrome 原生 Performance Timeline 测量“导航开始 → Composer 可见且可输入”；冷启动样本禁用浏览器缓存并绕过 service worker，暖启动样本复用缓存：

```bash
npm run measure:composer-startup -- \
  --url 'https://meno.guoyingwei.top/' \
  --samples 15
```

目标和最新实测记录维护在 [整改与验收清单](docs/remediation-checklist.md)，不在 README 固化一次性的版本号或历史性能数值。

## API

### Quick API

创建 Memo：

```bash
curl -X POST https://api.meno.guoyingwei.top/api/quick/memos \
  -H 'X-API-Key: <API_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"content":"想法 #标签","client_id":"<UUID>"}'
```

上传图片：

```bash
curl -X POST https://api.meno.guoyingwei.top/api/quick/upload \
  -H 'X-API-Key: <API_TOKEN>' \
  -F 'file=@photo.jpg'
```

### V1 与 OpenAPI

- Memo API：`/api/v1/memos`
- 完整导出：`/api/v1/export`
- OpenAPI：`/openapi.json`

V1 使用 Bearer token；具体请求字段以 OpenAPI 文档为准。

## MCP Server

- URL：`https://api.meno.guoyingwei.top/api/mcp`
- 传输：MCP Streamable HTTP
- 认证：`Authorization: Bearer <API_TOKEN>`

可用工具：

| 工具 | 说明 |
|---|---|
| `list_memos` | 按标签、日期、关键词等条件列出 Memo |
| `get_memo` | 按 slug 读取 Memo |
| `create_memo` | 创建 Memo 并解析标签 |
| `update_memo` | 更新内容、可见性或日期 |
| `delete_memo` | 将 Memo 移入回收站 |

检查工具列表：

```bash
curl -X POST https://api.meno.guoyingwei.top/api/mcp \
  -H 'Authorization: Bearer <API_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 相关文档

- [部署 Runbook](docs/deploy-runbook.md)
- [Agent 部署 Runbook](docs/agent-deploy.md)
- [整改与验收清单](docs/remediation-checklist.md)
- [性能优化计划](docs/perf-optimization-plan.md)

## License

Private project.
