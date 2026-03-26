# Meno 部署模板

## 前端 runtime-config.js
部署前修改：

```js
window.__MENO_API_BASE_URL__ = 'https://your-worker-domain';
```

如果前后端同域，可保持空字符串。

## Worker / Cloudflare 变量
在 `worker/wrangler.toml` 或 secrets 中填写：

- `APP_ORIGIN=https://your-frontend-domain`
- `ASSET_PUBLIC_BASE_URL=https://your-assets-domain`
- `GITHUB_ALLOWED_LOGIN=your-github-login`
- `GITHUB_CLIENT_ID=...`
- `GITHUB_CLIENT_SECRET=...`
- `SESSION_SECRET=...`

## D1 / R2
- 替换 `database_id`
- 确认 `bucket_name`

## GitHub OAuth 回调地址
开发：
- `http://localhost:5173/api/auth/github/callback`

线上：
- `https://your-frontend-domain/api/auth/github/callback`

## 建议最终部署方式
- 前端：Cloudflare Pages
- Worker：Cloudflare Workers
- D1：生产数据库
- R2：生产 bucket
- 前端 runtime-config.js 指向 Worker 域名或同域 API
