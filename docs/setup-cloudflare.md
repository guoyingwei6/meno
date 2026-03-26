# Meno Cloudflare / GitHub OAuth 配置清单

## 1. Cloudflare 登录
在本机执行：

```bash
npx wrangler login
```

## 2. 创建 D1

```bash
npx wrangler d1 create meno
```

把返回的 `database_id` 填入 `worker/wrangler.toml` 的 `[[d1_databases]]`。

## 3. 创建 R2 bucket

```bash
npx wrangler r2 bucket create meno-assets
```

把 bucket 名确认填入 `worker/wrangler.toml` 的 `[[r2_buckets]]`。

## 4. 准备公开资源域名
填写：

- `ASSET_PUBLIC_BASE_URL`

可先用你自己的 CDN 域名，或未来给 R2 绑定的公开访问域名。

## 5. GitHub OAuth App
在 GitHub Developer Settings 中创建 OAuth App。

建议回调地址：

```text
http://localhost:5173/api/auth/github/callback
```

后续正式部署时改成你的线上域名。

需要填写：

- `GITHUB_ALLOWED_LOGIN`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

其中 `GITHUB_ALLOWED_LOGIN` 必须是你自己的 GitHub 用户名，只有这个账号能进入后台。

## 6. 前后端分域时的关键配置
如果前端和 Worker 不是同一个域名，需要同时配置：

- `APP_ORIGIN=https://你的前端域名`
- `API_ORIGIN=https://你的worker域名`

GitHub OAuth 回调地址必须配置成：

```text
https://你的worker域名/api/auth/github/callback
```

前端登录入口则会跳到：

```text
https://你的worker域名/api/auth/github/login
```

## 7. Session secret
设置一个随机长字符串：

- `SESSION_SECRET`

## 7. 当前需要你最终填写的位置

### `worker/wrangler.toml`
- `database_id`
- `bucket_name`
- `APP_ORIGIN`
- `ASSET_PUBLIC_BASE_URL`
- `GITHUB_ALLOWED_LOGIN`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`

### `.env.example`
已提供示例模板，可拷贝成你自己的本地环境文件。

## 8. 验证顺序
1. D1 创建成功
2. R2 bucket 创建成功
3. GitHub OAuth App 创建成功
4. 本地变量填好
5. 运行前端和 worker
6. 尝试 GitHub 登录
7. 尝试上传图片
