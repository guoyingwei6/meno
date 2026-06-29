# Meno Agent 部署 Runbook

这份文档给 Codex、Claude Code、Cursor Agent 或人工操作者使用。目标是让部署前检查、dry-run 和正式部署顺序固定下来，避免误用占位配置。

## 原则

- Worker 部署必须使用 `worker/wrangler.local.toml`。
- 不要用 `worker/wrangler.toml` 部署；它是提交到仓库的占位模板。
- 不要在日志、提交信息、README 或聊天总结里输出 secret、token、OAuth secret、API token。
- 正式部署前先跑 `npm run verify`。
- 不确定 Cloudflare 登录状态时，先让用户确认是否可以执行需要网络和认证的 Wrangler 命令。

## 标准顺序

### 1. 查看工作区状态

```bash
git status --short
```

只处理当前任务相关文件，不回滚用户已有改动。

### 2. 本地配置检查

```bash
npm run config:check
```

该命令检查：

- `worker/wrangler.local.toml` 是否存在。
- D1、R2、Vectorize、Workers AI 绑定是否存在。
- `APP_ORIGIN`、`API_ORIGIN`、`ASSET_PUBLIC_BASE_URL`、GitHub OAuth 基本变量是否仍是占位符。
- secret 类配置只报告存在性或风险，不打印具体值。

### 3. 本地验证

```bash
npm run verify
```

该命令依次执行：

- `npm run config:check`
- `npm run typecheck`
- `npm run test`

任一步失败都应先修复，不要继续部署。

### 4. Dry-run

```bash
npm run deploy:dry-run
```

该命令会先执行严格部署配置检查，再构建前端，并用 `worker/wrangler.local.toml` 对 Worker 做 dry-run。dry-run 失败时不要部署。

严格部署配置检查会阻止 secret 类变量继续留在 `worker/wrangler.local.toml` 的 `[vars]` 中，因为 Wrangler dry-run/deploy 可能打印 `[vars]` 的值。应改用 Wrangler secrets。

### 5. 正式部署

```bash
npm run deploy
```

该命令会先跑 `verify`，再部署 Cloudflare Pages 前端和 Cloudflare Worker。

也可以拆开执行：

```bash
npm run deploy:frontend
npm run deploy:worker
```

## 常见失败处理

### `config:check` 失败

先补齐 `worker/wrangler.local.toml`。不要把真实配置写回 `worker/wrangler.toml`。

如果 `config:check:deploy` 失败，先把 `GITHUB_CLIENT_SECRET`、`SESSION_SECRET`、`API_TOKEN` 等 secret 类配置迁到 Wrangler secrets，再继续 dry-run 或部署。

### `typecheck` 失败

优先修类型错误本身，不要通过放宽 TypeScript 配置绕过。

### `test` 失败

先判断是当前改动引入，还是已有时间敏感/环境敏感测试。能修就修，不能修时在交付说明里明确失败文件和原因。

### `wrangler deploy --dry-run` 失败

常见原因：

- Wrangler 未登录。
- Cloudflare 账号或权限不足。
- D1/R2/Vectorize 绑定不存在或名字不匹配。
- Cron trigger 达到 Cloudflare 免费额度限制。

如果失败信息涉及认证、远端资源或 Cloudflare API，需要请求用户授权后再继续。
