Always respond in Chinese-simplified

# Superpowers Skills 策略
只启用以下两个 skill，其余 superpowers skill 一律不调用：
- superpowers:brainstorming
- superpowers:test-driven-development

# 前端交互约定

- 发布 Memo 的输入框需要随内容自动增高；短内容不出现内部滚动，超过 `min(60vh, 420px)` 后才在输入框内滚动，避免长文输入挤掉整页布局。

# 部署

## 前端（Cloudflare Pages）

```bash
cd frontend
npx vite build
npx wrangler pages deploy dist --project-name=meno
```

## Worker（Cloudflare Workers）

**必须以本地真实配置为来源部署，不能用 `wrangler.toml`（里面是提交到 GitHub 的占位符）：**

```bash
npm run config:check:deploy
npm run deploy:worker
```

`worker/wrangler.local.toml` 包含真实的 D1 database ID、域名、GitHub OAuth 等非 secret 配置，不提交到 Git。部署检查会生成去敏的临时 `worker/wrangler.deploy.toml`，正式 Worker 部署使用该文件；`GITHUB_CLIENT_SECRET`、`SESSION_SECRET`、`API_TOKEN` 使用 Wrangler secrets。

## 一键全量部署

```bash
# 在根目录按 migration → Worker → Pages 的顺序验证并部署
npm run deploy
```

部署完成后运行 `npm run config:clean:deploy` 清理临时配置。
