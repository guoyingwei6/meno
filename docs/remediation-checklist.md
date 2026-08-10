# Meno 修复与性能优化 Checklist

> 建立日期：2026-08-09
> 状态：本轮源码修复、本地验收、正式部署、功能烟测与全部性能目标均已完成。
> 范围：本轮源码审计确认的安全、首页性能、记录可靠性、数据一致性、UI 与未闭环功能；PWA 已明确不纳入本轮，不影响网页使用。
> 约束：本次生产部署与旧 session 清理由用户单独授权执行；仍不提交、不推送。

> 本地验收（2026-08-10）：`npm run typecheck` 通过；`npm test` 通过（前端 57 文件/164 项，Worker 39 文件/168 项）；`npm run deploy:dry-run` 通过。Worker 构建 dry-run 只使用提交到仓库的无密模板，正式部署以本地真实配置为来源并使用临时去敏配置。迁移 `001`–`011` 已在空本地 D1 按顺序应用，重复运行无待执行迁移；FTS5 的插入、更新、删除触发器已验证。前端首屏入口 gzip 为 125.78 kB，Markdown 渲染器为独立懒加载块（47.42 kB gzip）。

> 本轮续作复核（2026-08-10）：前端已将 `sort`、`has_images`、`has_tags` 纳入分页 query key 与请求，普通服务端分页不再在客户端重复排序/筛选；附件 GC 新增图片、语音、共享对象和 R2 删除失败重试回归。语音转写可重新领取 `failed` 项；知识库/Vectorize 已改为 D1 持久队列，具备 revision fencing、lease、指数退避、错误字段和 cron 重试，普通 Memo、Quick、V1、MCP 的 create/update/delete 均在响应前入队。公开/作者 feed 已由 `007` 复合索引执行且无临时排序，20 条 feed 固定为 3 次关系查询，dashboard/public stats 各合并为 1 次查询。原生 `wrangler d1 migrations apply` 已在临时本地 D1 验证可顺序应用 `001`–`011` 且重复执行无迁移；该段仅记录当时的本地验证，后续生产证据见下方。

> 最终本地复核（2026-08-10）：AI/OCR/语音转写、向量索引与外部聊天提示词均在模型调用前复核当前 Memo 与受限附件关系；共享给私密或已删除 Memo 的 R2 对象不会因另一条 public Memo 而进入模型。最终门禁中的长正文 fixture：20 条 feed 为 3 条 D1 statement、19,066 B JSON、2,821 B gzip、本地 handler p75 2.495 ms；120 条全量 fixture 为 5 条 statement、112,463 B JSON、14,012 B gzip、本地 handler p75 9.03 ms。本地 handler 仅作回归代理，不等同线上 TTFB。

> 本机浏览器性能回归（2026-08-10）：以 production build 的 Vite preview 连续采样 15 次，`Composer` 文本框可见且 enabled 的自动化墙钟上界：每次新标签页 p75 为 204 ms（最大 504 ms），同一浏览器连续导航 p75 为 101 ms（最大 113 ms）。这只证明本机回归趋势，包含浏览器自动化开销；未模拟真实网络、Cloudflare edge/cold start，也没有 PWA service-worker 缓存，因此不能替代下列生产验收项。

> 真实浏览器 IndexedDB 入队回归（2026-08-10）：本地 Vite 页面直接调用实际 `enqueueOutbox`，预热 5 次后各采样 30 次、共复跑两轮；IndexedDB 可用，最近一轮 min/p50/p75/max 为 0.1/0.2/0.2/0.6 ms。计时从入队调用开始，到 IndexedDB transaction 完成为止，覆盖离线发布真正落入 outbox 的持久化边界；不把网络失败检测或 Cloudflare 网络耗时混入该指标。

## 本次生产发布记录（2026-08-10）

- Worker：首轮生产版本 `9e24efe7-7289-4493-85a1-2f3dc1aa5602`，Cloudflare 部署记录时间为 `2026-08-10T11:44:36Z`；后续性能增量版本见下节。
- Pages：首轮生产部署 `c094df23-99c3-4531-a053-ad61781a02e9`，地址 `https://c094df23.meno-680.pages.dev`。Cloudflare 显示的 `Source` 是 `959e9ff`；本次为 dirty working tree 的手工发布，未提交、未推送，不将该字段误记为干净源码的等价证明。
- D1 migration reconciliation：上线前发现生产 schema 已具备 `003`–`006`，但 ledger 仅登记 `001`–`002`；在只读核对定义后仅补录四条 ledger metadata，不重放 schema 或业务数据。随后 Wrangler ledger 应用 `007`–`011`。发布后只读查询确认 `d1_migrations` 为 `001`–`011`。
- 匿名烟测：首页、`/api/public/stats`、`/api/public/memos?limit=20`、`/api/me` 均为 200；`/api/me` 返回 `viewer`；匿名 `/api/dashboard/memos` 为 401。首页可见 Composer 与 20 条公开 Memo，控制台无 error；CSP、`X-Content-Type-Options`、`Referrer-Policy` 与 frame 限制响应头存在。
- Session 清理：完成烟测后按用户单独授权删除生产 `sessions` 表全部 39 条记录，立即复核为 0；未读取 session 内容，未改动 Memo、附件或设置。
- 线上公开 feed 20 次采样：20/20 成功、全部 gzip；p75 TTFB 为 703.56 ms，p75 gzip 为 16,934 B。因此本清单的线上 TTFB 与 gzip 目标均未达标，保留为开放项。

## 性能摘要与最终增量发布（2026-08-10）

- Worker：新版本 `ed2bc4a3-f075-41a8-803f-ab2789a722e0` 已承载生产流量；Worker startup time 为 3 ms。
- Pages：新部署地址 `https://f15001c5.meno-680.pages.dev`；生产域名返回新入口 `/assets/index-pVzjwGkb.js`。
- D1：正式发布前通过 Wrangler ledger 复核，返回 `No migrations to apply`；未重放 SQL，也未改动业务数据。
- 匿名烟测：首页、公开 stats、20 条公开 Feed、`/api/me` 均为 200，匿名 dashboard 为 401；安全头齐全。Feed 第二次相同请求为 `X-Meno-Cache: HIT`，弱 ETag 条件请求返回 304。
- 新版 20 条公开 Feed：20/20 成功、全部 gzip，p75 TTFB 303.10 ms、p75 gzip 9,065 B；相较旧版 703.56 ms / 16,934 B，两个目标均已达标。
- 新版无 `limit` 全量 Feed：20/20 成功、p75 TTFB 320.94 ms、p75 gzip 247,833 B、未压缩 1,299,286 B；它不是首屏接口，结果证明首页必须保持分页。
- Chrome 外层自动化墙钟（每组 15 次）曾测得冷启动 p75 1,258 ms、reload p75 643 ms，但包含控制工具往返，不能代表页面自身。新增 `scripts/measure-composer-startup.mjs` 通过 Chrome DevTools Protocol 在页面内用 MutationObserver 标记“Composer 已出现且 enabled”：禁用缓存并绕过 service worker 的 15 次冷启动 p75 为 192.4 ms（最大 716.3 ms），复用缓存的 15 次暖启动 p75 为 93.6 ms（最大 342.5 ms）。
- 生产 HTML 未注入 `rocket-loader`，主 module 与 `runtime-config.js` 均保留 `data-cfasync="false"`，当前 SPA 不受 Rocket Loader 改写。
- 本轮没有再次删除 session；此前按单独授权执行的 39→0 清理不重复执行。

## 总体验收目标

- [x] 真实生产网络冷启动到输入框可输入：p75 < 1 秒。
  - 本机 Chrome 对生产域名进行 15 次禁用缓存、绕过 service worker 的原生页面内测量，Composer-ready p75 为 192.4 ms；同一浏览器暖启动 p75 为 93.6 ms。测量从 `navigationStart` 到 textarea 存在且 enabled，不包含外层控制工具往返。
- [x] PWA 安装、service worker 缓存启动与更新 UI：N/A（用户明确不做，范围外）；当前网页正常使用不依赖 PWA。
- [x] `/api/me`、feed 延迟 5 秒或失败时，页面壳和输入框仍可立即使用。
- [x] 刷新、崩溃、离线后，正文、日期、可见性、图片和录音草稿均可恢复。
- [x] 离线发布进入 outbox：真实 IndexedDB transaction p75 < 100 ms（本机两轮 30 次采样均为 0.2 ms）。
- [x] 恢复网络后同一 `client_id` 只创建一次 Memo（含多标签重放）。
- [x] 首屏 20 条 Memo API gzip < 15 KB：新版线上 20 次采样 p75 为 9,065 B。
- [x] 首屏 20 条 Memo API：线上 p75 TTFB < 400 ms。
  - 新版生产公开 URL 20 次采样 p75 为 303.10 ms、失败 0；旧版基线为 703.56 ms。
- [x] 首屏关键 JS gzip < 130 KB，HTML 不再预加载 Markdown 渲染栈。
- [x] 伪造、过期、已登出的 session 均返回 401；私密附件未授权返回 401/404。
- [x] 全量 typecheck、tests、production build 通过；新增关键路径回归测试。

## T0：鉴权、会话与 Web 安全（P0）

### T0.1 统一真实鉴权

- [x] 移除“Cookie 非空即 author”的 `isAuthorSession` 语义。
- [x] 所有 dashboard、Memo 写操作、上传、AI 等作者路由统一查询 D1 session。
- [x] session 查询必须校验 `expires_at > now`。
- [x] 无效、过期、伪造 Cookie 的响应语义统一为 401。
- [x] 修正把任意 `valid-author-session` 当合法身份的测试夹具。
- [x] 增加伪造、过期、已吊销 session 的路由级回归测试。

### T0.2 Session 生命周期

- [x] 新 session ID 使用 `crypto.randomUUID()` 或至少 256-bit CSPRNG，不再复用 Memo slug。
- [x] logout 同时删除 D1 session，并清浏览器 Cookie。
- [x] 评估并收紧 Cookie 属性；保持跨子域登录可用。
- [x] 增加 session 到期、登出吊销、重复登出的测试。
- [x] 已单独确认并删除生产环境全部历史 session（2026-08-10）。
  - 安全修复烟测通过后执行；清理前 39 条、清理后 0 条。删除只让已登录浏览器重新 GitHub 登录，不会删除 Memo、附件或设置。浏览器刷新不会更换 session，不能替代该操作。

### T0.3 CSRF、Origin 与响应安全头

- [x] Cookie 鉴权的 POST/PATCH/DELETE 校验 `Origin`，只允许配置的应用 origin。
- [x] CORS origin 与 Origin 校验共用配置，避免规则漂移。
- [x] 增加 CSP、`X-Content-Type-Options`、`Referrer-Policy`、frame 限制等响应头。
- [x] CSP 与图片、音频、GitHub OAuth、Workers AI 等现有能力兼容。
- [x] 增加受信/非受信 Origin 的测试。

### T0.4 Markdown/XSS

- [x] `rehypeRaw` 后接可靠 sanitize schema，或默认禁用原始 HTML。
- [x] 明确允许的 Markdown 标签、属性、URL scheme。
- [x] 阻止 `style`、`iframe/srcdoc`、事件属性、`javascript:` 等载荷。
- [x] MemoCard、详情页、分享页使用同一安全渲染器。
- [x] 增加存储型 XSS 回归测试。

## T1：Quick Capture、本地草稿与离线可靠性（P0/P1）

### T1.1 首页解除串行门控

- [x] 页面壳、TopBar、侧栏占位和 Composer 不等待 `/api/me` 或 feed。
- [x] 游客先并行请求公开 feed/tags/calendar/stats；身份确认后再升级为作者数据。
- [x] 未确认身份时 Composer 可以输入，但发布按钮显示锁定/验证中状态。
- [x] feed 使用局部 skeleton/error/empty state，不再整页 `Loading...`。
- [x] feed 失败不卸载 Composer，不清空草稿。

### T1.2 IndexedDB 草稿

- [x] 保存正文、展示日期、可见性、标签和 UI 所需元数据。
- [x] 图片与录音 Blob 写入 IndexedDB，不使用只存 URL 的脆弱方案。
- [x] 约 500 ms 防抖保存；页面恢复时避免旧草稿覆盖用户刚输入内容。
- [x] 每个浏览器标签页使用独立 draft ID，并能清理已成功草稿。
- [x] 保持输入框随内容自动增高；超过 `min(60vh, 420px)` 才内部滚动。
- [x] 增加刷新恢复、Blob 恢复、成功后清理、失败保留测试。

### T1.3 幂等创建与离线 outbox

- [x] Memo 创建契约增加 `client_id`。
- [x] D1 增加 `client_id` 唯一约束和查询路径（当前为单作者应用；多作者化时须改为 `(author_id, client_id)` 复合约束）。
- [x] 相同 `client_id` 重试返回已有 Memo，不重复创建。
- [x] 离线/网络失败时写入 outbox，恢复网络后自动重放。
- [x] enqueue outbox 按 `draft.clientId` IndexedDB 索引直接查重，不为幂等检查扫描整张 outbox；v2 旧库升级后保留记录、tombstone 和 lease 语义。
- [x] 多标签页同时重放仍只创建一次。
- [x] 明确 pending/synced/failed 状态和手动重试入口。

## T2：首屏与前端运行性能（P1）

- [x] `/api/me` 不再门控公开请求；为独立 API origin 增加合理 preconnect/dns-prefetch，或评估同源代理。
- [x] TanStack Query 设置按数据类型区分的 `staleTime`、重试和 refetch 策略。
- [x] 持久化 Query Cache 只缓存匿名默认公开首屏，带 30 秒 TTL/版本；不缓存私有、作者、搜索或筛选数据，登出无需保留私有缓存。
- [x] Markdown 渲染器真正动态 import；纯文本 Memo 走无 Markdown 依赖的快路径与失败 fallback。
- [x] Memo 卡片增加 `content-visibility:auto` 和合理 intrinsic size。
- [x] 修复会让 `memo()` 失效的不稳定 props/回调。
- [x] 搜索、标签、排序、统计、Deep Chat 不再触发隐藏的全库 feed 请求。
- [x] 公共/私密/回收站切换不使用跨权限 `placeholderData` 闪现旧数据。
- [x] Memo 请求失败显示明确局部错误态和重试入口。
- [x] 64 px 展示场景请求接近实际尺寸的缩略图，不默认下载 720 px。
- [x] production build 的主 module 与 runtime-config 脚本保留 `data-cfasync="false"`，避免被 Rocket Loader 改写。
- [x] 提供无认证的公开 feed 采样 CLI，供部署前后记录 TTFB 与体积；默认不指向生产 URL。
- [x] 确认生产 SPA 不受 Rocket Loader 改写。
  - 生产 HTML 无 `rocket-loader` 注入，主 module 与 runtime config 均带 `data-cfasync="false"`；旧/新版浏览器与 API 指标已分别记录。
- [x] 增加 `C` 聚焦 Composer、`Cmd/Ctrl+Enter` 发布；不抢占输入法或浏览器常用快捷键。

## T3：D1、列表 API 与服务端性能（P1）

### T3.1 真正的服务端分页与筛选

- [x] 用稳定 keyset cursor 替换 OFFSET 伪 cursor，排序字段加入唯一 tie-breaker。
- [x] 标签、图片、日期、可见性、收藏、归档和排序尽量在服务端过滤。
- [x] 搜索使用 D1 FTS5；保留无 FTS 条件时的安全 fallback。
- [x] 插入新 Memo 后继续翻页不得重复或漏项。
- [x] 为常用 owner/status/pinned/display-date/id 排序增加复合索引，并用查询计划验证。

### T3.2 减少 D1 轮次与响应体

- [x] Memo、标签、语音/附件关系避免逐条或串行查询，使用 JOIN、`batch` 或受控 `Promise.all`。
- [x] dashboard stats 的独立聚合合并为更少轮次。
- [x] 已评估首屏 bootstrap API：现有并行轻量请求与 3-statement feed 已足够，本轮不增加耦合的聚合端点。
- [x] 列表 DTO 不重复传输 `content === excerpt`；长内容摘要由服务端真正截断或只返回一种字段。
- [x] 公共首屏 API 增加短 TTL edge cache/ETag；作者和私密响应明确 `private, no-store`。
- [x] 记录 20 条与全量响应的 statement 数、TTFB 和 gzip 体积前后对比。
  - 本地长正文 fixture：20 条为 3 statements / 2,821 B gzip；120 条为 5 statements / 14,012 B gzip。新版线上 20 条 p75 为 303.10 ms / 9,065 B gzip；无 `limit` 全量响应 p75 为 320.94 ms / 247,833 B gzip。旧版 20 条基线为 703.56 ms / 16,934 B gzip。

## T4：发布链路与数据一致性（P1）

- [x] D1 Memo 持久化成功后立即响应，前端立即清空已安全落盘的草稿并乐观插入列表。
- [x] OCR、embedding、Vectorize、webhook 等非关键工作通过 `waitUntil` 或持久化 outbox 后台执行。
- [x] 后台任务失败可重试、可观测，不能造成 Memo 创建失败或重复创建。
- [x] 前端 invalidation 不再串行等待 Memo、标签、日历全部 refetch。
- [x] 更新 Memo 正文与标签关系采用 D1 batch/事务语义，避免删除标签后更新失败。
- [x] Memo 改为 private、删除或清空内容时，可靠删除/更新 Vectorize；MCP 路径同样适用。
- [x] 私密内容在未明确配置前不得发送到第三方模型；模型调用前同时复核 Memo 与附件当前可见性，私密/已删除/共享受限对象及其 OCR 派生文本均 fail-closed。
- [x] 修复私密 Memo 可收藏但收藏列表只返回 public 的问题。
- [x] 作者 tags/calendar/stats 应包含其有权查看的私密 Memo；游客仍只统计 public。

## T5：附件、图片与录音可靠性（P0/P1）

- [x] 私密附件读取必须验证所属 Memo/作者权限，或使用不可公开枚举的受控下载路径。
- [x] 对象 key 使用 UUID/高熵 ID，消除同毫秒覆盖风险。
- [x] 前后端同时限制文件大小、允许的 MIME/扩展名和文件数量。
- [x] 上传采用流式/受限内存处理，避免无界 `arrayBuffer()`。
- [x] 前端检查 `response.ok`；上传未完成时不得把正文先发布并把图片落入新草稿。
- [x] 取消/失败/删除 Memo 后清理 R2 孤儿文件；提供可重试 GC。
- [x] 录音“停止→重录”不被旧 effect cleanup 停掉新流。
- [x] 附件上传也使用 `client_id` 幂等，避免 outbox 重放重复对象。

## T6：明确 Bug 与未闭环功能（P1/P2）

- [x] TagPage 在作者态使用作者接口，能看到同标签私密 Memo。
- [x] 实现 `/share/:token` 前端路由、错误/过期态、撤销入口；分享链接必须实际可打开。
- [x] 分享 token 支持可选过期时间；被撤销或过期后不可访问。
- [x] 接入 settings UI；`siteTitle`、默认可见性等不再前后端各自硬编码。
- [x] 更新默认可见性后，新 Composer 与后端设置一致。
- [x] 修复上传、发布、Query invalidation 的竞态和不完整刷新。
- [x] 修复搜索/视图切换时旧内容闪现。
- [x] 补齐局部 skeleton、empty、error、toast 状态。

## T7：UI 一致性与可选产品能力（P2）

- [x] 抽取颜色、间距、圆角、阴影和 hover/focus/disabled 交互状态 token。
  - `Button`、`IconButton`、TopBar、设置、AI 配置、导入导出与侧栏标签操作使用该 token；交互状态和弹窗焦点管理有回归测试。
- [x] 逐步统一 Button/IconButton/Dialog/Menu/Sheet/Toast；不整体重写为 shadcn。
  - 已提供并接入通用原语：设置与 AI 相关弹窗使用 Dialog，Memo/标签/移动格式菜单使用 Menu，移动侧栏使用 Sheet，状态提示使用 Toast；Escape、遮罩关闭、Tab 焦点约束、焦点恢复、`menuitem` 与 `aria-live` 均有回归测试。
- [x] 移动端 Composer 工具栏只保留高频动作，格式功能收入“更多”。
  - 窄屏保留标签、图片、录音、可见性、日期和发布；加粗、斜体、下划线、代码块和列表可从可访问的“更多”菜单调用，桌面端保持直达工具栏。
- [x] 保持 Meno 的公开个人知识站定位，不照搬 FlareMo 的登录前整页阻塞。
  - 游客直接加载公开 feed，Composer 始终挂载可输入；只有发布和私密视图要求身份确认。
- [x] 完成本轮产品评估：归档、引用/反向链接、历史版本、PAT、i18n 不纳入本次 remediation，须单独立项后再实施。
  - 归档：现有 `deleted_at` 是 30 天后清理的回收站，不可复用为长期归档；需要新状态、列表/统计/搜索语义和保留策略。
  - 引用/反向链接：目前只解析 Markdown 外链/附件引用，没有内部 Memo 引用语法或关系索引；需要先确定语法、迁移图索引和隐私可见性规则。
  - 历史版本：当前只有 `updated_at`，没有不可变版本快照；需要版本表、恢复语义、附件引用与数据保留策略。
  - PAT：当前 `/api/v1` 只使用一个全局 `API_TOKEN`；真正 PAT 需要哈希存储、名称/作用域/过期/撤销和审计，不能把全局 token 直接包装成 PAT。
  - i18n：前后端文案尚未抽取到翻译层；应先确定中英文范围、日期/格式化策略和翻译资源维护方式。
- [x] PWA 安装/更新 UI：N/A（用户明确不做，范围外）；不影响当前网页使用。

## 并行工作流与文件边界

### 工作流 A：安全与会话

- 负责：T0.1、T0.2、T0.3；第一轮不触碰前端页面和 Memo repository。
- 主要文件：`worker/src/lib/auth.ts`、`worker/src/db/session-repository.ts`、`worker/src/routes/auth.ts`、`worker/src/index.ts`、相关测试。
- 交付：统一鉴权中间件/助手、session 生命周期、Origin/安全头和证据。

### 工作流 B：Quick Capture 与前端

- 负责：T0.4、T1、T2 和前端侧 T5/T6。
- 主要文件：`frontend/src/pages/HomePage.tsx`、`frontend/src/components/MemoComposer.tsx`、安全 Markdown 渲染组件、本地 capture 模块、相关测试。
- 第一轮先交付：页面解门控 + IndexedDB 草稿基础 + 局部 loading/error；outbox 依赖工作流 C 的 `client_id` 后接通。

### 工作流 C：数据、发布链路与后端性能

- 负责：T3、T4 和后端侧 T5/T6。
- 主要文件：D1 migrations、repositories、Memo/公开/dashboard/upload 路由、AI/OCR/Vectorize 后台任务、相关测试。
- 第一轮先交付：`client_id` 幂等、keyset cursor、重复 excerpt、私密收藏/统计、发布后台化基础。

## 主代理最终检查

- [x] 审阅三条工作流的 diff，确认无越界重构、无回退他人修改。
- [x] 补齐跨工作流接线：安全鉴权、前端 outbox 与后端 `client_id`、附件权限与发布状态。
- [x] 运行 `npm run typecheck`。
- [x] 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 运行针对性安全测试：伪 Cookie、过期/登出 session、恶意 Origin、XSS、私密附件。
- [x] 运行本地针对性性能检查：bundle/preload、API 体积、D1 statement/查询计划、冷/warm 启动。
  - production build 入口为 125.78 kB gzip，`SafeMarkdown` 为独立 47.42 kB gzip 懒加载块；HTML 未预加载 Markdown 渲染栈。
  - 最终门禁中的长正文 fixture：20 条 feed 为 3 条 D1 statement、19,066 B JSON、2,821 B gzip、本地 handler p75 2.495 ms；查询计划使用 `idx_memos_public_feed` / `idx_memos_author_feed`，无临时排序。
  - 新版线上 20 条 Feed p75 TTFB 303.10 ms、gzip 9,065 B；生产 HTML 未注入 Rocket Loader。浏览器墙钟上界见文首，严格启动阈值仍按实测保留。
- [x] 更新本文件完成状态和遗留项。
- [x] 已取得用户对部署与旧 session 失效的单独确认；完成 migration reconciliation、Worker/Pages 发布、匿名烟测与 session 清理，仍未提交、未推送。
