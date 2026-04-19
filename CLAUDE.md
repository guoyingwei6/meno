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

**必须使用本地配置文件部署，不能用 `wrangler.toml`（里面是占位符，提交到 GitHub 的）：**

```bash
cd worker
npx wrangler deploy --config wrangler.local.toml
```

`wrangler.local.toml` 包含真实的 D1 database ID、域名、GitHub OAuth 等配置，不提交到 Git。

## 一键全量部署

```bash
# 根目录先 build
npm run build

# 前端
cd frontend && npx wrangler pages deploy dist --project-name=meno

# Worker
cd ../worker && npx wrangler deploy --config wrangler.local.toml
```
