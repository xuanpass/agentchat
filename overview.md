# A2A 接入 — 交付概览

## 做了什么
为 agent-ops-console 新增**统一 A2A 适配器**（`kind='a2a'`），一套代码同时接入 101 服务器上 OpenClaw(`:18789`) 与 Hermes(`:9900`) 两个智能体的 A2A v1.0 端点，无需再为它们各自写私有协议翻译器。

## 交付清单
- [x] 后端 `server/src/adapters/a2a.ts`（新增，~525 行，纯 fetch+JSON-RPC：Agent Card 发现、跨机 host 修正、双路径取文本、GetTask 轮询、unsupported 语义）
- [x] 类型/路由/驱动注册：`types.ts` `routes/connections.ts` `index.ts`
- [x] DB 迁移 `db/migrations.ts`：移除 `connections.kind` CHECK 约束（重建表 + 行数校验 + foreign_key_check），允许 `kind='a2a'`
- [x] 前端：`stores/connections.ts` 类型+分组、`style.css` 徽标、`ConnectionsPage.vue` 向导 A2A 项、`CapabilitiesPage.vue` 对 a2a 禁用「导入」
- [x] 设计稿 `A2A-DESIGN.md` 更新为「已实现」+ §13 验证记录

## 验证结果
- vitest **155 单测全过**；前后端 build 通过
- **BFF E2E 对两个端点都跑通**：
  - Hermes(`:9900`)：发「3+4=?」→ 远端回复 **"7"**，能力编目返回 skills[]
  - OpenClaw(`:18789`)：拉起其网关（systemd user 服务）后，发「3+4=?」→ 远端回复 **"7"**，能力编目返回 `autocli` skill
- DB 迁移：`kind` CHECK 已移除、外键完整、业务数据零丢失
- **原始问题已实证回答：能用 A2A 接入 OpenClaw + Hermes 两个智能体**

## 关键实测修正（与原设计稿不同）
1. **JSON-RPC 路径不可硬编码**（OC `/a2a/v1` vs Hermes `/`），一律取 Agent Card `supportedInterfaces[].url` + 跨机 host 修正
2. **Hermes SSE 不吐文本**，取文本统一走同步 `SendMessage` → 驱动对两端行为一致
3. 文本提取优先级：`artifacts[].parts[].text` → `status.message` → `history` 末条

## 已知限制
- 既有代码残留 tsc 报错与本改动无关（我引入的一处已修复）
- OpenClaw 网关（`:18789` systemd user 服务）默认可能未运行；需 `systemctl --user start openclaw-gateway` 才暴露 A2A 端点（本次验证时已拉起）

## 运行方式
```bash
npm run dev    # 同时起前端(5173) + 后端(3001)
# 连接向导选 A2A，填 http://192.168.123.101:9900（Hermes）或 :18789（OpenClaw），
# auth 选 token 填对应 Bearer token 即可
```
