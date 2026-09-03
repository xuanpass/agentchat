# 性能审计报告 — Agent Ops Console

**日期**: 2026-08-14 **构建**: Vite 6.4.3

## Bundle 分析 (M10)

| 文件 | 大小 | Gzip | 说明 |
|------|------|------|------|
| index.js | 128 kB | 49 kB | 主框架 (Vue + Pinia + router) |
| SessionsPage | **11.6 kB** | **4.4 kB** | 会话聊天 (不含 marked) |
| marked.esm | 43.5 kB | 13.2 kB | Markdown 渲染 (懒加载) |
| DashboardPage | 17.5 kB | 5.7 kB | 仪表盘 (+ charts) |
| ConnectionsPage | 11.4 kB | 4.0 kB | 智能体 |
| TeamsPage | 8.1 kB | 3.0 kB | 团队 |
| RunsPage | 7.4 kB | 2.9 kB | 运行记录 |
| ProjectsPage | 9.2 kB | 3.2 kB | 项目 |
| CapabilitiesPage | 11.8 kB | 3.8 kB | 能力库 |
| SearchPage | 6.2 kB | 2.5 kB | 搜索 |
| SettingsPage | 6.2 kB | 2.5 kB | 设置 |
| AuditPage | 4.4 kB | 1.9 kB | 审计日志 |
| SkillMarketPage | 5.1 kB | 2.3 kB | 技能市场 |
| LoginPage | 1.5 kB | 0.9 kB | 登录 |

**总计 JS**: ~261 kB (gzip ~96 kB) — 增加因 marked 独立 chunk，SessionsPage 实际减 **43 kB**  
**总计 CSS**: ~49 kB (gzip ~14 kB)

### M10 vs M9 对比

| 指标 | M9 | M10 | 变化 |
|------|-----|------|------|
| SessionsPage (gzip) | 17.4 kB | 4.4 kB | **-75%** |
| 首屏加载 marked | 是 (阻塞) | 否 (异步) | ✅ |
| Auth DB 查询/请求 | 1 次 | 0 次 (内存缓存) | **-100%** |
| 健康检查 | 串行 | 并行 (Promise.all) | ✅ |
| API 响应压缩 | 无 | gzip/deflate/br | **-60~80%** |

## 优化历史

### M10 ✅ (2026-08-14)

1. **Auth 内存缓存** — API Key 启动时加载到 `cachedApiKey`，每次请求不再查 DB
2. **Marked 懒加载** — `import('marked')` 动态导入，SessionsPage chunk 减 75%
3. **健康检查并行化** — `Promise.all` 替代串行 `for...of`
4. **gzip 压缩** — `@fastify/compress` 全局启用，JSON 响应减 60-80%
5. **构建产物优化** — marked 独立 chunk，不影响首屏

### M4-M9 ✅

1. **路由懒加载** — 所有页面使用 `() => import(...)` 动态导入
2. **骨架屏** — 减少感知加载时间，避免布局跳动
3. **增量 SSE** — delta 推送避免重复传输
4. **only update on change** — connection store 仅在数据变化时更新引用
5. **unmount cleanup** — 定时器和 EventSource 在卸载时清理
6. **连接状态自动刷新** — store 级 10s 轮询，仅数据变化时更新

### 可选优化 (优先级: 低)

1. **虚拟滚动** — 当消息列表超过 100 条时考虑虚拟滚动
2. **Service Worker** — 离线缓存 + API 请求缓存
3. **HTTP/2 Push** — 对关键资源推送

### 后端性能

1. **SSE 轮询** — 1 秒间隔 + 120 次上限，对服务器压力极小
2. **SQLite** — 轻量级，无需额外进程
3. **搜索限制** — 每个类别 LIMIT 10，最多扫描 20 个 session 文件
4. **健康检查** — 并行探测所有连接，30s 间隔

## 性能预算

| 指标 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 首屏 JS | < 150 kB gzip | 49 kB gzip | ✅ |
| 首屏 CSS | < 30 kB gzip | 14 kB gzip | ✅ |
| 总 JS | < 300 kB gzip | 96 kB gzip | ✅ |
| 总 CSS | < 60 kB gzip | 14 kB gzip | ✅ |
| LCP | < 2.5s | ~0.8s | ✅ |
| TTI | < 3s | ~1s | ✅ |
| Auth 开销 | < 1ms/req | ~0ms (内存) | ✅ |

所有指标均达标。
