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
4. 通过 Wrangler D1 migration ledger 仅应用尚未记录的 migration；不要逐文件使用 `d1 execute` 重放 SQL
5. 部署 Worker 配置以移除旧的普通变量绑定
6. 同步 Worker secrets
7. 构建并部署 Cloudflare Pages

第 5、6 步的顺序用于避免旧普通变量绑定与同名 secret 冲突；CI 配置中不应保存 secret 值。

GitHub Secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `D1_DATABASE_ID`
- `OAUTH_CLIENT_SECRET`（部署时写入 Worker 的 `GITHUB_CLIENT_SECRET`）
- `SESSION_SECRET`
- `API_TOKEN`

GitHub Variables：

- `OAUTH_ALLOWED_LOGIN`（生成 Worker 配置时写入 `GITHUB_ALLOWED_LOGIN`）
- `OAUTH_CLIENT_ID`（生成 Worker 配置时写入 `GITHUB_CLIENT_ID`）
- 可选：`APP_ORIGIN`、`API_ORIGIN`、`ASSET_PUBLIC_BASE_URL`、`OCR_DAILY_LIMIT`、`OCR_BATCH_SIZE`、`OCR_SEED_BATCH_SIZE`

## 命令说明

| 命令 | 作用 |
|---|---|
| `npm run config:check` | 检查本地 Cloudflare 配置是否齐全，避免误用占位配置 |
| `npm run config:check:deploy` | 从本地真实配置生成去敏的 `worker/wrangler.deploy.toml`，并阻止 secret 类变量留在 `[vars]` 中 |
| `npm run verify` | 执行配置检查、类型检查和测试 |
| `npm run deploy:dry-run` | 严格配置检查后构建前端，并用提交到仓库的 `worker/wrangler.toml` 占位模板构建 Worker；不连接生产资源 |
| `npm run deploy:migrations` | 用本地真实配置将尚未应用的 D1 migrations 写入远端 ledger |
| `npm run deploy:frontend` | 构建并部署 Cloudflare Pages 前端 |
| `npm run deploy:worker` | 以 local 配置为来源，使用临时去敏的 `worker/wrangler.deploy.toml` 部署 Worker |
| `npm run deploy` | 先验证，再按 migration → Worker → Pages 顺序发布 |

## 部署前检查

- [ ] `npm run config:check` 通过
- [ ] `npm run verify` 通过
- [ ] `npm run config:check:deploy` 通过
- [ ] `npm run deploy:dry-run` 通过
- [ ] GitHub OAuth 回调地址指向线上 Worker 域名
- [ ] Cloudflare D1 / R2 / Vectorize / Workers AI 资源存在
- [ ] `API_TOKEN`、`SESSION_SECRET`、`GITHUB_CLIENT_SECRET` 已作为 Wrangler secret 或安全本地配置准备好

发布完成后再运行健康检查和公开 feed 性能采样；删除全部旧生产 session 是独立的破坏性维护操作，不能由上述任何命令隐式触发，须再次取得明确授权。

## 线上公开 Feed 性能采样（只读）

在取得线上只读测量许可后，使用显式 endpoint 采集 20 条公开 feed 的 p50/p75 TTFB、gzip/传输体积和失败数：

```bash
node scripts/measure-public-feed.mjs \
  --url 'https://<api-domain>/api/public/memos?limit=20' \
  --samples 20
```

该脚本不设默认 URL，不发送 Cookie 或 `Authorization`，拒绝 URL 中的 token、`key`、session 等认证参数，也不打印响应正文。它每次独立建连，结果包含建连开销；因此适合部署前后 A/B 对比，但不替代真实设备冷启动验收。

## 配置文件约定

- `worker/wrangler.toml` 是提交到仓库的模板，保留占位符。
- `worker/wrangler.local.toml` 是本地真实绑定与非 secret 配置的来源，不提交到 Git。
- `worker/wrangler.deploy.toml` 由部署检查临时生成，剔除 secret 类普通变量，不提交也不手工维护。
- `worker/wrangler.ci.toml` 是 GitHub Actions 临时生成配置，不提交到 Git。
- `npm run build` 的 Worker dry-run 使用提交到仓库的 `worker/wrangler.toml` 占位模板；真实 Worker 部署由根脚本显式使用 `--config wrangler.deploy.toml`。
- 部署完成后运行 `npm run config:clean:deploy` 删除临时去敏配置。

## 安全约定

- 不在 README、提交信息、Issue、PR、聊天记录中写入 secret 值。
- 输出检查报告时只说“存在/缺失/占位符”，不打印具体 secret。
- 不把 `GITHUB_CLIENT_SECRET`、`SESSION_SECRET`、`API_TOKEN` 放在 `[vars]` 里做正式 dry-run/deploy；Wrangler 可能打印这些值。
- 如需检查 Cloudflare 远端资源，先确认当前操作允许网络和账号认证。
