# Meno

一个自托管的轻量级笔记应用，灵感来自 [flomo](https://flomoapp.com)，基于 Cloudflare 全栈部署。

## 特性

### 笔记
- Markdown 编辑器，支持加粗、斜体、下划线、有序/无序列表
- 图片上传与缩略图预览，支持删除，不暴露图床链接
- 笔记卡片展开/收起，短笔记全文显示，长笔记自动截断
- 分享链接，一键复制笔记独立访问地址
- 字数统计、创建时间、编辑时间显示
- 软删除 → 回收站 → 30 天后自动彻底删除（含图床清理）

### 标签
- `#标签` 自动解析，支持 `#一级/二级` 层级标签
- 侧边栏标签树，分组折叠/展开
- 点击标签名筛选笔记，点击箭头折叠子标签
- 选中标签整行绿色高亮
- **AI 填充标签**：在笔记菜单中一键调用 OpenAI 兼容 API，从现有标签库自动匹配标签，弹窗确认后前置写入笔记

### 筛选
- 公开/私密、有/无标签、有/无图片 三组筛选条件
- 点击循环切换：选项 A → 选项 B → 清除
- 日历热力图，点击日期筛选当天笔记
- 「那年今日」查看往年同日笔记

### 响应式
- 桌面端：侧边栏 + 居中内容区
- 移动端：侧边栏收起，点击汉堡菜单滑出，点击遮罩关闭
- 刷新按钮强制同步多端数据

### AI
- TopBar 魔杖按钮配置 AI（Base URL / API Key / Model），兼容 OpenAI 接口，配置存于本地 localStorage
- 支持填写完整 endpoint URL 或 Base URL 两种格式
- 内置验证按钮，一键测试配置是否可用

### API
- Quick API：通过 `X-API-Key` 认证，支持 POST 创建笔记和上传图片
- 适配苹果快捷指令、自动化工具等场景

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + Vite + TypeScript |
| 后端 | Cloudflare Workers + Hono |
| 数据库 | Cloudflare D1 (SQLite) |
| 图床 | Cloudflare R2 |
| 认证 | GitHub OAuth + Session |
| 部署 | Cloudflare Pages + Workers |

## 快速开始

### 前置条件
- Node.js 18+
- Cloudflare 账号（免费）
- GitHub OAuth App

### 部署

```bash
# 安装依赖
npm install

# 初始化 D1 数据库
cd worker
npx wrangler d1 create meno
npx wrangler d1 execute meno --file=src/db/schema.sql

# 创建 R2 存储桶
npx wrangler r2 bucket create meno-assets

# 配置 wrangler.toml 中的环境变量
# 设置 API_TOKEN secret
echo "your-token" | npx wrangler secret put API_TOKEN

# 部署 Worker（本地使用含真实配置的 wrangler.local.toml）
npx wrangler deploy --config wrangler.local.toml

# 部署前端
cd ../frontend
npx vite build
npx wrangler pages deploy dist --project-name=meno
```

详细配置参考 `docs/` 目录。

## Quick API 用法

### 创建笔记

```bash
curl -X POST https://your-api.workers.dev/api/quick/memos \
  -H "X-API-Key: your-token" \
  -H "Content-Type: application/json" \
  -d '{"content": "想法 #标签", "images": ["https://..."]}'
```

### 上传图片

```bash
curl -X POST https://your-api.workers.dev/api/quick/upload \
  -H "X-API-Key: your-token" \
  -F "file=@photo.jpg"
```

## 开源协议

MIT
