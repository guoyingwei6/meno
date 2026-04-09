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

## 4. 创建 Vectorize 索引

知识库功能需要一个向量索引：

```bash
npx wrangler vectorize create meno-memos --dimensions=1024 --metric=cosine
```

说明：

- `meno-memos` 要和 `worker/wrangler.toml` / `wrangler.local.toml` 里的 `index_name` 保持一致
- `@cf/baai/bge-m3` 的 embedding 维度按 1024 配置

## 5. 绑定 Workers AI

知识库检索要用 Workers AI 生成 embedding。

在 `wrangler.local.toml` 里增加：

```toml
[ai]
binding = "AI"
```

并确保存在：

```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "meno-memos"
```

## 6. 准备公开资源域名
填写：

- `ASSET_PUBLIC_BASE_URL`

可先用你自己的 CDN 域名，或未来给 R2 绑定的公开访问域名。

## 7. GitHub OAuth App
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

## 8. 前后端分域时的关键配置
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

## 9. Session secret
设置一个随机长字符串：

- `SESSION_SECRET`

## 10. 当前需要你最终填写的位置

### `worker/wrangler.local.toml`

至少应包含这些块：

```toml
name = "meno-worker"
main = "src/index.ts"
compatibility_date = "2025-03-24"

[ai]
binding = "AI"

[[vectorize]]
binding = "VECTORIZE"
index_name = "meno-memos"

[[d1_databases]]
binding = "DB"
database_name = "meno"
database_id = "你的真实 D1 database_id"

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "meno-assets"

[vars]
APP_ORIGIN = "https://你的前端域名"
API_ORIGIN = "https://你的worker域名"
ASSET_PUBLIC_BASE_URL = "https://你的worker域名/api/assets"
GITHUB_ALLOWED_LOGIN = "你的 GitHub 用户名"
GITHUB_CLIENT_ID = "你的 GitHub OAuth Client ID"
```

### `worker/wrangler.toml`
- `database_id`
- `bucket_name`
- `VECTORIZE.index_name`
- `APP_ORIGIN`
- `ASSET_PUBLIC_BASE_URL`
- `GITHUB_ALLOWED_LOGIN`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`

### `.env.example`
已提供示例模板，可拷贝成你自己的本地环境文件。

## 11. 知识库首次启用顺序
1. D1 创建成功
2. R2 bucket 创建成功
3. Vectorize 索引创建成功
4. `wrangler.local.toml` 补上 `AI` / `VECTORIZE` 绑定
5. Worker 重新部署
6. 作者登录后，打开侧边栏「深度对话」
7. 点击一次「重建知识库索引」
8. 再开始提问

## 12. 验证顺序
1. D1 创建成功
2. R2 bucket 创建成功
3. Vectorize 索引创建成功
4. GitHub OAuth App 创建成功
5. 本地变量填好
6. 运行前端和 worker
7. 尝试 GitHub 登录
8. 尝试上传图片
9. 尝试知识库索引和问答
