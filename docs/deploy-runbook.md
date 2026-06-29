# Meno 部署 Runbook

## 常用命令

```bash
npm run config:check
npm run verify
npm run deploy:dry-run
npm run deploy
```

## 自动部署

仓库包含 `.github/workflows/deploy.yml`，推送到 `main` 后由 GitHub Actions 自动部署生产环境。

自动部署流程：

1. `npm ci`
2. `npm run verify`
3. 生成临时 `worker/wrangler.ci.toml`
4. 执行 `worker/migrations/*.sql`
5. 同步 Worker secrets
6. 部署 Worker
7. 构建并部署 Cloudflare Pages

GitHub Secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `D1_DATABASE_ID`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`
- `API_TOKEN`

GitHub Variables：

- `GITHUB_ALLOWED_LOGIN`
- `GITHUB_CLIENT_ID`
- 可选：`APP_ORIGIN`、`API_ORIGIN`、`ASSET_PUBLIC_BASE_URL`、`OCR_DAILY_LIMIT`、`OCR_BATCH_SIZE`、`OCR_SEED_BATCH_SIZE`

## 命令说明

| 命令 | 作用 |
|---|---|
| `npm run config:check` | 检查本地 Cloudflare 配置是否齐全，避免误用占位配置 |
| `npm run config:check:deploy` | 部署前严格检查，会阻止 secret 类变量留在 `worker/wrangler.local.toml` 的 `[vars]` 中 |
| `npm run verify` | 执行配置检查、类型检查和测试 |
| `npm run deploy:dry-run` | 严格配置检查后构建前端，并用 `worker/wrangler.local.toml` 验证 Worker 部署 |
| `npm run deploy:frontend` | 构建并部署 Cloudflare Pages 前端 |
| `npm run deploy:worker` | 用 `worker/wrangler.local.toml` 部署 Worker |
| `npm run deploy` | 先验证，再部署前端和 Worker |

## 部署前检查

- [ ] `npm run config:check` 通过
- [ ] `npm run verify` 通过
- [ ] `npm run config:check:deploy` 通过
- [ ] `npm run deploy:dry-run` 通过
- [ ] GitHub OAuth 回调地址指向线上 Worker 域名
- [ ] Cloudflare D1 / R2 / Vectorize / Workers AI 资源存在
- [ ] `API_TOKEN`、`SESSION_SECRET`、`GITHUB_CLIENT_SECRET` 已作为 Wrangler secret 或安全本地配置准备好

## 配置文件约定

- `worker/wrangler.toml` 是提交到仓库的模板，保留占位符。
- `worker/wrangler.local.toml` 是本地真实部署配置，不提交到 Git。
- `worker/wrangler.ci.toml` 是 GitHub Actions 临时生成配置，不提交到 Git。
- Worker dry-run 和正式部署都必须显式使用 `--config wrangler.local.toml`。

## 安全约定

- 不在 README、提交信息、Issue、PR、聊天记录中写入 secret 值。
- 输出检查报告时只说“存在/缺失/占位符”，不打印具体 secret。
- 不把 `GITHUB_CLIENT_SECRET`、`SESSION_SECRET`、`API_TOKEN` 放在 `[vars]` 里做正式 dry-run/deploy；Wrangler 可能打印这些值。
- 如需检查 Cloudflare 远端资源，先确认当前操作允许网络和账号认证。
