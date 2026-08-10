# 前端/Worker 性能优化实施规划（第一批：低风险项）

> 本文档面向执行代码修改的 agent。请严格按任务边界实施，不要顺手重构无关代码。
> 每个任务相互独立，可并行，但**写入文件集不重叠**，见各任务的 Ownership。
> 全部完成后统一跑验证（见文末）。

## 背景

- 仓库：npm workspaces 单体仓，`frontend/`（Vite + React 19 + react-router 7 + TanStack Query 5）、`worker/`（Hono + Cloudflare Workers + D1 + R2）、`shared/`。
- 现状问题（已确认）：
  1. 首屏 JS 主 chunk 687 kB（gzip 209 kB），4 个路由页全部打进主包，`react-markdown` + `rehype-raw` 也在主包。
  2. `MemoCard` 用了 `memo()` 包裹（`frontend/src/components/MemoCard.tsx:734`），但 `HomePage` 传给 `MemoTimeline` 的所有回调都是渲染期内联箭头函数，引用每次都变，memo 失效，任意状态变化会重渲染整个 timeline。
  3. 打开 memo 详情/标签页用 `window.location.assign`，整页刷新，浪费了 SPA。
  4. `worker/src/storage/r2.ts` 处理 HTTP Range 请求时先 `arrayBuffer()` 下载完整对象再内存切片；音频拖动进度条时每次都全量下载。R2 原生支持 range 读取。
  5. `frontend/package.json` 有未使用依赖：`dayjs`、`clsx`（全 src 无引用），`@types/jszip` 误放在 `dependencies`（应为 devDependencies，且 jszip 3.10+ 自带类型，可直接删）。

## 通用约束

- 不新增依赖。
- 不修改任何测试的断言语义；如果测试因实现细节（如 import 方式）失败，优先调整实现方式而非改测试。
- TypeScript 严格模式，禁止 `as any` / `@ts-ignore`。
- 样式保持 inline-style 现状，不迁移 CSS。
- 遵守根目录 `AGENTS.md`（回复用中文；部署命令见其中说明，但本批任务**不执行部署**）。

---

## 任务 1：路由级代码分割（Route lazy）

**Ownership**：`frontend/src/App.tsx`，可选 `frontend/vite.config.ts`

### 改动点

`frontend/src/App.tsx` 目前静态 import 四个页面。改为：

1. `HomePage` 保持静态 import（首屏路由，lazy 反而增加一次往返）。
2. `MemoDetailPage`、`MemoEditPage`、`TagPage` 改为 `React.lazy`：

```tsx
import { lazy, Suspense } from 'react';

const MemoDetailPage = lazy(() => import('./pages/MemoDetailPage').then((m) => ({ default: m.MemoDetailPage })));
const MemoEditPage = lazy(() => import('./pages/MemoEditPage').then((m) => ({ default: m.MemoEditPage })));
const TagPage = lazy(() => import('./pages/TagPage').then((m) => ({ default: m.TagPage })));
```

3. 用一个 `Suspense` 包住 `<Routes>`（或只包三个 lazy 路由的 element），fallback 参考 `HomePage.tsx` 里 `styles.loading` 的简单 "Loading..." 居中样式即可，不要引入新组件文件。

注意：这三个页面是**具名导出**（`export const MemoDetailPage = ...`），必须用 `.then((m) => ({ default: m.XXX }))` 转换，参考 `frontend/src/pages/HomePage.tsx:19-21` 已有写法。

4. （可选加分项）`frontend/vite.config.ts` 增加 manualChunks，把 markdown 渲染栈拆出主包：

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        markdown: ['react-markdown', 'rehype-raw'],
      },
    },
  },
},
```

注意 `frontend/vite.config.js` 是 `vite.config.ts` 的编译产物遗留文件，Vite 会优先用 `.ts`（实际上存在两份，改 `.ts` 即可；如果构建时报配置冲突，把改动同步到 `.js` 或直接删除 `.js` 并验证构建）。

### 验收

- `cd frontend && npx vite build` 成功，输出中出现 MemoDetailPage/MemoEditPage/TagPage（或对应 hash 名）的独立 chunk，主 `index-*.js` 体积明显下降。
- `npm run test --workspace frontend` 全绿。

---

## 任务 2：HomePage 回调稳定化（useCallback，恢复 MemoCard 的 memo 效果）

**Ownership**：`frontend/src/pages/HomePage.tsx`

### 改动点

`frontend/src/pages/HomePage.tsx:397-430` 传给 `<MemoTimeline>` 的以下 props 全是内联箭头函数，需提升为组件顶部的 `useCallback`：

- `onOpenMemo`、`onOpenTag`（与任务 3 联动，见下）
- `onSaveEditMemo`、`onRestoreMemo`、`onDeleteMemo`、`onChangeVisibility`、`onFillTagsMemo`、`onPinMemo`、`onFavoriteMemo`
- `onLoadMore`（依赖 `useServerPagination`、`fetchNextPage`）

要点：

1. mutation 对象由 `useMutation` 返回，引用稳定，`useCallback` 依赖里写 `xxxMutation.mutate` 或整个 mutation 均可；推荐依赖 `[updateMemoMutation]` 这种写法，避免 eslint 告警。
2. `onPinMemo` / `onFavoriteMemo` 内部有 `memo.pinnedAt` 分支判断，逻辑保持不变，只是搬进 `useCallback`。
3. `onLoadMore` 当前是 `useServerPagination ? () => { void fetchNextPage(); } : undefined`，改成：

```tsx
const handleLoadMore = useCallback(() => { void fetchNextPage(); }, [fetchNextPage]);
// JSX: onLoadMore={useServerPagination ? handleLoadMore : undefined}
```

4. 传给 `MemoTimeline` 的 `allTags`（`allTags.map((t) => t.tag)`）也是每次渲染新数组，改为 `useMemo`：

```tsx
const allTagNames = useMemo(() => allTags.map((t) => t.tag), [tagsData]);
```

注意 `allTags` 本身在渲染体内派生自 `tagsData`，把这一段一起理顺（`allTags` 也可以 `useMemo` 化），但**不要**改变 `buildTagTree` 的调用行为。

5. 不要求把 `SidebarShell` / `TopBar` 的回调也全部 useCallback 化——只做 `MemoTimeline` 链路（那是列表重渲染的主要开销）。如果做完后改动很小、顺手能覆盖 `onLogout` 等，也允许，但不得改变行为。

### 验收

- `npm run test --workspace frontend` 全绿（有大量 home-page-*.test.tsx 覆盖交互，是主要回归保障）。
- `npm run typecheck --workspace frontend` 通过。
- 人工检查：`MemoTimeline` 收到的所有函数 props 在两次渲染间引用稳定（除 `onLoadMore` 随 `useServerPagination` 切换 undefined 外）。

---

## 任务 3：站内跳转改 SPA 导航

**Ownership**：`frontend/src/pages/HomePage.tsx`（与任务 2 同文件！两任务必须由**同一个执行者**完成，或按 2→3 顺序串行）

### 改动点

`frontend/src/pages/HomePage.tsx`：

1. 引入 `useNavigate`（`react-router-dom`，项目已在 `MemoDetailPage.tsx`、`MemoEditPage.tsx` 使用同样模式）。
2. 替换两处整页刷新（397-398 行）：

```tsx
onOpenMemo={(memo) => navigate(`/memos/${memo.slug}`)}
onOpenTag={(tag) => navigate(`/tags/${tag}`)}
```

结合任务 2 写成 `useCallback`：

```tsx
const handleOpenMemo = useCallback((memo: MemoSummary) => navigate(`/memos/${memo.slug}`), [navigate]);
const handleOpenTag = useCallback((tag: string) => navigate(`/tags/${tag}`), [navigate]);
```

3. **不要动**登出相关的 `window.location.assign('/')`（350、359 行）——登出后整页刷新是有意为之（清理内存中的 query 缓存与登录态），保持现状。
4. `SidebarShell.tsx:242` 的 `loginUrl()` 跳转是外部 OAuth 地址，保持 `window.location.assign`，不要改。

### 验收

- 前端测试全绿 + typecheck 通过。
- 人工验证（如果执行环境能跑 dev server）：首页点 memo 卡片 → 详情页无整页刷新（network 面板无 document 请求）；点标签 → `/tags/xxx` 同理。不能跑浏览器的话，在最终报告里注明未做浏览器验证。

---

## 任务 4：R2 原生 Range 读取

**Ownership**：`worker/src/storage/r2.ts`

### 改动点

`getAssetResponse`（`worker/src/storage/r2.ts:41`）当前逻辑：无 Range 时流式返回（OK）；有 Range 时 `await fullObject.arrayBuffer()` 全量载入再切片（问题所在）。

改为 R2 原生 range：

1. 先 `bucket.head(objectKey)` 拿 `size`（head 不拉 body）；对象不存在返回 null。
2. 无 Range header：`bucket.get(objectKey)` 流式返回，行为与现在一致（etag、`cache-control: public, max-age=31536000, immutable`、`accept-ranges: bytes` 头都保留）。
3. 有 Range header：复用现有 `parseByteRange(header, size)` 解析（该函数逻辑正确，处理了 suffix range，保留不动）：
   - 解析失败 → 416 + `content-range: bytes */<size>`（与现状一致）。
   - 解析成功 → `bucket.get(objectKey, { range: { offset, length } })`，返回 206，设置：
     - `content-range: bytes <offset>-<offset+length-1>/<size>`
     - `content-length: <length>`
     - 其余头同上（注意 range get 返回的 `R2ObjectBody` 同样有 `writeHttpMetadata` / `httpEtag`）。
4. 直接用 `object.body` 流式响应，**不要**再 `arrayBuffer()`。

边界注意：

- range get 理论上可能返回 null（对象在 head 和 get 之间被删），此时返回 null 即可。
- `parseByteRange` 返回的 `{ offset, length }` 形状恰好匹配 R2 的 `R2Range`，可直接传。

### 调用方（只读参考，不修改）

- `worker/src/index.ts:38`（旧路径 `/assets/*` 回退）
- `worker/src/routes/upload.ts:72`（`/api/assets/*`）

两处签名不变，无需改动。

### 验收

- `npm run test --workspace worker` 全绿（`worker/src/test/` 目前没有直接测 r2.ts 的用例，主要靠 typecheck + 手动逻辑复核）。
- `npm run typecheck --workspace worker` 通过。
- 人工复核三种路径：无 Range / 合法 Range（含 suffix `bytes=-500`）/ 非法 Range → 200 流式 / 206 部分 / 416。

---

## 任务 5：清理未使用依赖

**Ownership**：`frontend/package.json`、`package-lock.json`

### 改动点

从 `frontend/package.json` 的 `dependencies` 中删除：

- `dayjs`（全 src 零引用，已确认）
- `clsx`（全 src 零引用，已确认）
- `@types/jszip`（jszip 3.10 自带 d.ts，此包是空壳 stub；直接删除，不要移到 devDependencies）

保留 `jszip`（`ImportExportModal.tsx` 在用）。

然后在**仓库根目录**跑 `npm install` 刷新 `package-lock.json`（workspaces 模式，锁文件在根目录）。如果沙箱内 npm install 因网络失败，申请网络权限重试；再不行就只改 package.json 并在报告中说明锁文件未刷新。

### 验收

- `npm run build`（根目录，frontend+worker 都 build）成功。
- `npm run test --workspace frontend` 全绿（特别是 `memo-composer-voice-note`、`memo-image-sort` 等用到 jszip 间接链路的用例）。

---

## 统一验证清单（全部任务合并后执行一次）

```bash
npm run typecheck          # frontend + worker
npm run test               # frontend + worker 全部测试
npm run build              # 两个 workspace 构建
```

额外记录：build 输出里主 chunk 的新体积（对比基线 687.19 kB / gzip 208.64 kB），写进最终报告。

**不要执行部署**。部署由用户确认后另行进行（worker 部署必须用 `wrangler.local.toml`，见根 AGENTS.md）。

## 已知风险与回避

- `frontend/vite.config.js` 与 `.ts` 并存：改配置只改 `.ts`；若构建行为异常，检查 Vite 实际加载的是哪份。
- HomePage 是测试覆盖最密集的文件（13+ 个测试文件引用），任务 2/3 改完必须全量跑 frontend 测试。
- `useInfiniteQuery` 的 `fetchNextPage` 引用在 v5 中稳定，可安全放入 useCallback 依赖。
- 不要把 `dailyReview` 的洗牌逻辑、客户端筛选逻辑等本批未列入的问题顺手"修复"——那些在后续批次单独处理。
