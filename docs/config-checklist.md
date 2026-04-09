# Meno 可填配置清单

## GitHub OAuth
- GITHUB_ALLOWED_LOGIN=
- GITHUB_CLIENT_ID=
- GITHUB_CLIENT_SECRET=

## Cloudflare
- APP_ORIGIN=
- API_ORIGIN=
- ASSET_PUBLIC_BASE_URL=
- wrangler.toml -> d1 database_id=
- wrangler.toml -> r2 bucket_name=
- wrangler.local.toml -> [ai] binding=AI
- wrangler.local.toml -> [[vectorize]] binding=VECTORIZE
- wrangler.local.toml -> [[vectorize]] index_name=meno-memos
- SESSION_SECRET=

## 推荐本地命令
```bash
npx wrangler login
npx wrangler d1 create meno
npx wrangler r2 bucket create meno-assets
npx wrangler vectorize create meno-memos --dimensions=1024 --metric=cosine
```

## 上线前核对
- [ ] GitHub OAuth 回调地址已改成线上域名
- [ ] GITHUB_ALLOWED_LOGIN 已填成你的 GitHub 用户名
- [ ] D1 database_id 已替换
- [ ] R2 bucket_name 已替换
- [ ] Vectorize index `meno-memos` 已创建
- [ ] `wrangler.local.toml` 已补 `AI` / `VECTORIZE` 绑定
- [ ] ASSET_PUBLIC_BASE_URL 已配置成可访问域名
- [ ] SESSION_SECRET 已替换成随机长字符串
- [ ] 作者登录后已执行一次“重建知识库索引”
