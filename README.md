# Agent Ops Console

![CI](https://github.com/your-org/agent-ops-console/workflows/CI/badge.svg)

接入远程智能体（OpenClaw / Hermes / OpenCode）、组建团队、管理会话、共享技能的 Web 控制台。

## 架构

```
web/        Vue 3 + Vite 前端 (port 5173)
server/     Fastify + SQLite 后端 (port 3001)
e2e-pkg/    Playwright E2E 测试
```

## 快速开始

```bash
# 安装依赖
npm install

# 配置环境变量
cp server/.env.example server/.env
# 编辑 server/.env 设置 AOC_SECRET

# 开发模式 (同时启动前后端)
npm run dev
```

打开 http://localhost:5173

## 测试

```bash
# 单元测试 (Vitest, 67 tests)
npm -w server run test

# E2E 测试 (Playwright, 9 tests)
cd e2e-pkg && npx playwright test
```

## Docker 部署

```bash
# 构建镜像
docker build -t agent-ops-console .

# 运行容器
docker-compose up -d
```

或手动运行：

```bash
docker run -d \
  -e AOC_SECRET=your-secret-key \
  -e AOC_PORT=3001 \
  -e AOC_HOST=0.0.0.0 \
  -v aoc-data:/app/data \
  -p 3001:3001 \
  agent-ops-console
```

## 功能

- 仪表盘 — 实例状态、会话统计、图表分析
- 智能体管理 — 接入 OpenClaw/Hermes/OpenCode，健康检查
- 团队编排 — 多智能体协作、消息分发
- 运行记录 — 执行追踪、事件流、状态机
- 会话管理 — 历史消息、全文搜索、实时对话
- 能力库 — 技能同步、差异比对
- 项目 — 代码仓库绑定、上下文管理
- 审计日志 — 操作追踪、过滤查询

## 技术栈

- **前端**: Vue 3 + Pinia + Vue Router + Vite
- **后端**: Fastify + SQLite + Zod + TypeScript
- **测试**: Vitest + Playwright
- **部署**: Docker 多阶段构建

## License

MIT
