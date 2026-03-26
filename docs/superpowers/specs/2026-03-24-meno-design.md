# Meno 设计文档

日期：2026-03-24
状态：待评审
产品名：Meno

## 1. 项目目标

Meno 是一个单作者的 memo Web 应用，交互形态参考 usememos/memos 的 timeline-first 模式，界面布局参考用户提供的左栏 + 主内容区截图。产品目标是以尽可能接近 0 成本、尽可能 serverless 的方式实现公开可读、作者登录后可发布的轻量笔记系统。

第一版明确支持：
- 文字输入与 Markdown 展示
- 正文中的 `#标签` 自动解析
- 图片上传与插入正文
- `public / private / draft` 可见状态 + `trash` 回收站视图
- 标签筛选与日期筛选
- 月历、热力图、基础统计
- GitHub OAuth 单作者登录

第一版明确不支持：
- 多用户注册与协作
- 评论、点赞、通知
- 全文搜索
- 外部图床依赖
- 复杂权限角色系统

## 2. 对 usememos/memos 的调研结论

对 `usememos/memos` 仓库的调研结论如下：

- 产品层面，它是典型的 timeline-first 笔记产品，强调“打开即写、快速记录”，不是基于文件夹的层级笔记系统。
- 技术层面，仓库采用 Go 后端 + Vite/React 前端的分层结构，前端位于 `web/`，服务层位于 `server/`，持久化逻辑集中在 `store/`。
- `store/memo.go` 中的核心模型表明 memo 的核心职责围绕内容、可见性、时间字段以及关联附件清理展开，这些都是本项目可以借鉴的抽象边界。
- 最近提交集中在 `MemoDetail`、sidebar、preview metadata、可维护性重构，说明 memo 详情页与侧栏是该类产品中持续演进的重点区域。

本项目借鉴其产品交互与信息组织方式，但不继承其单体服务部署模式。Meno 将采用 Cloudflare serverless 架构替代自托管服务端。

## 3. 架构选型

### 3.1 最终选型

- 前端：Vite + React + TypeScript
- 托管：Cloudflare Pages
- API：Cloudflare Workers
- 数据库：Cloudflare D1
- 图片存储：Cloudflare R2
- 登录：GitHub OAuth，仅允许预设 GitHub 账号登录
- 内容格式：Markdown
- 标签来源：正文 `#标签` 自动解析

### 3.2 选型理由

该选型满足以下目标：
- 尽量接近长期 0 成本
- 不自建服务器
- 能处理单作者的写入与公开读取
- 能支持图片、筛选、状态管理等动态能力
- 不引入多余的基础设施复杂度

不采用 GitHub 作为主存储，是因为图片管理、标签索引、private/draft 权限控制都会变得别扭。不采用 Vercel 作为首选，是因为在图片存储与数据库组合上，长期 0 成本稳定性不如 Cloudflare 方案。

## 4. 产品边界与页面结构

### 4.1 用户角色

系统只有两种视角：
- 游客：可读取公开内容
- 作者：登录后可创建、编辑、删除、切换状态

系统不提供注册入口，不支持多账户。

### 4.2 页面清单

第一版包含以下 4 类页面/路由类型：
- 主页 / 时间线页
- 单条 memo 详情页
- 标签页
- 登录回调页

作者端的“全部 / 公开 / 私密 / 草稿 / 回收站”都是主页时间线页中的筛选视图，不新增独立路由页面。

### 4.3 布局结构

采用固定左栏 + 右侧主内容的布局，尽量贴近参考图。

左侧固定栏包括：
- 产品标题
- 统计信息（笔记数、标签数、连续天数等）
- 月历筛选
- 热力图
- 导航（全部、公开、私密、草稿、标签、回收站）

右侧主内容区包括：
- 顶部固定的 `MemoComposer`
- 当前筛选信息条
- 时间线列表 `MemoTimeline`
- memo 详情入口

公开端与作者端使用同一套主框架，但作者端会暴露写入和管理能力。

## 5. 数据模型

### 5.1 设计原则

采用规范化设计，正文仍然是唯一内容真源，但标签、图片和 session 以独立表维护索引与管理边界。

### 5.2 核心表

#### `memos`
核心字段建议包括：
- `id`
- `slug`
- `content`
- `visibility`（`public | private | draft`）
- `display_date`
- `created_at`
- `updated_at`
- `published_at`
- `deleted_at`
- `previous_visibility`
- `excerpt`
- `has_images`
- `image_count`
- `tag_count`

#### `memo_tags`
- `memo_id`
- `tag`

#### `assets`
- `id`
- `memo_id`
- `object_key`
- `original_url`
- `preview_url`
- `mime_type`
- `width`
- `height`
- `size`
- `created_at`

#### `sessions`
- `id`
- `github_user_id`
- `expires_at`
- `created_at`

### 5.3 日期模型

系统同时维护两类时间：
- `display_date`：归属日期，用于月历、热力图、按日筛选
- `created_at`：真实创建时间

额外保留：
- `updated_at`：最后编辑时间
- `published_at`：首次进入 public 的时间，可用于后续公开排序策略

列表排序规则建议为：
- 主排序：`display_date desc`
- 次排序：`created_at desc`

这样既能支持补记到过去日期，也能维持同一天内的稳定顺序。

## 6. 图片设计

### 6.1 上传流程

- 作者在编辑器中点击图片插入
- 前端向 Worker 请求上传许可
- 图片上传到 R2
- 返回图片 URL 与对象 key
- 前端自动将 Markdown 图片引用插入正文
- Worker 记录 `assets` 元数据

### 6.2 存储策略

- 原图保留
- 正文中只存 Markdown 图片引用
- 数据库中额外存储图片索引与元数据
- 允许后台生成预览图或缩略图，但不对用户暴露前台上传硬限制

### 6.3 私密图片边界

第一版采用简化策略：
- `public` memo 的图片允许公开访问
- `private / draft` memo 的图片不在公开页面中暴露
- 对象 key 应尽量随机不可猜
- 第一版先不实现 Worker 鉴权下载或临时签名 URL

这意味着第一版对 private/draft 的承诺是“页面层与 API 层私密”，不是“对象存储层强私密”。只要不泄露对象链接，private/draft 图片在正常产品使用路径中不可见；若后续需要更强私密性，可升级为鉴权代理或短时签名 URL。

## 7. 标签与筛选设计

### 7.1 标签规则

- 标签仅来自正文中的 `#标签`
- 保存或编辑 memo 时重新解析正文
- 解析结果写入 `memo_tags`
- 标签做归一化与去重
- 支持中文标签与英文/数字混合标签

### 7.2 筛选规则

第一版仅支持：
- 标签筛选
- 日期筛选
- 作者端视图筛选（全部 / 公开 / 私密 / 草稿 / 回收站）

不支持全文搜索。

### 7.3 左侧统计联动

游客端：
- 仅基于 `public` memo 统计

作者端：
- 可基于当前视图（全部、private、draft、trash 等）生成统计

这样可避免 private/draft 混入公开统计。

## 8. 状态模型

系统支持以下可见状态：
- `public`
- `private`
- `draft`

`trash` 不是 `visibility` 枚举值，而是 `deleted_at != null` 时形成的回收站视图。

### 8.1 状态语义

- `public`：公开可见
- `private`：仅作者可见
- `draft`：仅作者可见，表示未正式发布
- `trash`：软删除视图，仅作者可见，可恢复

### 8.2 软删除策略

删除操作默认进入回收站，不做立即物理删除。进入回收站时：
- 写入 `deleted_at`
- 将删除前的 `visibility` 写入 `previous_visibility`
- 当前 `visibility` 保持删除前值不变，仅通过 `deleted_at` 判断是否属于回收站

恢复时：
- 清空 `deleted_at`
- `visibility` 继续使用原值；若后续实现中需要显式恢复，也可回退到 `previous_visibility`

永久删除时：
- 删除 `memos` 记录
- 删除对应 `memo_tags`
- 删除对应 `assets` 记录
- 同步删除关联 R2 对象

## 9. 认证与权限

### 9.1 登录方案

采用 GitHub OAuth 作为唯一登录入口。系统在 Worker 回调中校验 GitHub 用户 ID 或 login 是否与预设作者账号一致。只有匹配作者账号时才建立 session。

### 9.2 Session 方案

- 使用 HttpOnly Cookie
- Cookie 中只存 session id
- session 记录存储在持久层中

### 9.3 API 分层

建议显式拆分公开 API 与作者 API。

公开 API 示例：
- `GET /api/public/memos`
- `GET /api/public/memos/:slug`
- `GET /api/public/tags`
- `GET /api/public/calendar`
- `GET /api/public/heatmap`

作者 API 示例：
- `GET /api/me`
- `POST /api/auth/logout`
- `POST /api/memos`
- `PATCH /api/memos/:id`
- `DELETE /api/memos/:id`
- `POST /api/memos/:id/restore`
- `POST /api/upload-url`
- `GET /api/dashboard/memos`
- `GET /api/dashboard/stats`

公开与后台接口分离的主要目的是避免 private/draft 数据误暴露，并让前后端边界更清晰。

## 10. 核心交互流程

### 10.1 游客浏览流

- 进入首页看到 public 时间线
- 点击日期进入按日筛选
- 点击标签进入标签页
- 点击 memo 进入详情页

### 10.2 作者写作流

- GitHub 登录
- 在 `MemoComposer` 中输入 Markdown
- 选择 `public / private / draft`
- 选择 `display_date`
- 插入图片
- 保存后写入 `memos`、`memo_tags`、`assets`

### 10.3 编辑流

- 编辑正文后重新解析标签
- 新增图片时继续上传至 R2
- 删除正文中的图片引用时，第一版不立即删除对象，而是将关联 `assets` 标记为未引用候选，允许暂时存在 orphaned assets

## 11. UI 组件边界

建议拆分以下核心组件：
- `SidebarShell`
- `MemoComposer`
- `MemoTimeline`
- `MemoCard`

其中：
- `SidebarShell` 负责统计、月历、热力图、导航与作者端视图切换
- `MemoComposer` 负责纯文本输入、图片插入、状态选择、日期选择
- `MemoTimeline` 负责按筛选条件加载和展示列表
- `MemoCard` 负责单条摘要、图片预览、标签与操作按钮

## 12. 开发顺序

建议按以下顺序实现：

### Phase 1：公开阅读闭环
- 主页 public 时间线
- 标签页
- 详情页
- Markdown 渲染

### Phase 2：作者登录与发布
- GitHub OAuth
- Session 建立
- `MemoComposer`
- 创建 / 编辑 / 状态切换
- `display_date` 选择

### Phase 3：标签与图片
- `#标签` 解析
- 标签筛选
- R2 上传
- Markdown 自动插图
- 图片展示

### Phase 4：侧栏高级能力
- 统计卡片
- 月历
- 热力图
- 回收站
- 视图切换

## 13. 测试重点

第一版至少覆盖以下验证点：
- 游客无法读取 private/draft
- 非指定 GitHub 账号无法获得作者 session
- `draft / private / public / trash` 状态切换正确
- 标签解析与去重正确
- `display_date` 与热力图统计一致
- 图片上传、插入、展示正常
- 公开页不会泄露 private/draft 内容

## 14. 最终结论

Meno 的第一版应被视为一个 timeline-first、单作者、公开可读的 memo 产品。它参考 usememos/memos 的交互与产品形态，但采用更适合个人、低成本、无服务器运维的 Cloudflare 技术栈。系统重点不是构建一个通用笔记平台，而是在最小复杂度下，实现一个真正可长期使用的个人公开/半私密 memo 空间。
