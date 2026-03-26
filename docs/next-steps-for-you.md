# 现在你要做的最少步骤

如果你想把 Meno 真接到你自己的 Cloudflare + GitHub 上，按这个顺序做。

## 1. 登录 Cloudflare
```bash
npx wrangler login
```

## 2. 创建 D1
```bash
npx wrangler d1 create meno
```
把返回的 `database_id` 填到：
- `worker/wrangler.toml`

## 3. 创建 R2 bucket
```bash
npx wrangler r2 bucket create meno-assets
```
确认 bucket 名填到：
- `worker/wrangler.toml`

## 4. 创建 GitHub OAuth App
在 GitHub Developer Settings 里创建 OAuth App。

本地回调地址：
```text
http://localhost:5173/api/auth/github/callback
```
线上回调地址：
```text
https://你的前端域名/api/auth/github/callback
```

## 5. 填这些变量
参考：
- `.env.example`
- `docs/config-checklist.md`
- `docs/setup-cloudflare.md`
- `docs/deploy-template.md`

你需要真正填写：
- `GITHUB_ALLOWED_LOGIN`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `APP_ORIGIN`
- `ASSET_PUBLIC_BASE_URL`
- `SESSION_SECRET`
- D1 `database_id`
- R2 `bucket_name`

## 6. 当前正式线上地址
- 前端：`https://meno.guoyingwei.top`
- API：`https://api.meno.guoyingwei.top`
- OAuth callback：`https://api.meno.guoyingwei.top/api/auth/github/callback`

## 7. 你执行完后告诉我
到时候我会继续帮你把：
- 真正部署到 Cloudflare
- 校验 GitHub 登录
- 校验 R2 上传
- 校验 D1 读写

## 最关键提醒
`GITHUB_ALLOWED_LOGIN` 必须是你的 GitHub 用户名。不是这个用户名的人，即使完成 GitHub 登录，也进不了后台。
