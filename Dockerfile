# ---- Build Stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# 安装所有依赖 (包括 devDependencies)
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

# 复制源码
COPY server/ ./server/
COPY web/ ./web/

# 构建前端 (需要先构建，产物会被 server 引用)
RUN npm -w web run build

# 构建后端 (tsx 不需要编译，但保留 build 脚本兼容性)
RUN npm -w server run build 2>/dev/null || true

# ---- Production Stage ----
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# 仅安装生产依赖
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --omit=dev && npm cache clean --force

# 复制 server 源码
COPY server/ ./server/

# 复制构建后的前端
COPY --from=builder /app/web/dist ./web/dist

# 创建数据目录
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# 启动
CMD ["node", "--import", "tsx", "server/src/index.ts"]
