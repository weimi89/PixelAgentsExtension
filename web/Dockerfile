# ── Stage 1: Build ──────────────────────────────────────────
FROM node:20-bookworm AS build

# node-pty 需要 build 工具
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先複製 package 檔案以利用 Docker 層快取
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY agent-node/package.json agent-node/

RUN npm ci

# 複製所有 workspace 原始碼
COPY shared/ shared/
COPY server/ server/
COPY client/ client/
COPY agent-node/ agent-node/

# 按順序建置（shared 先、其餘依賴它）
RUN npm run build

# ── Stage 2: Runtime ────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

# node-pty 執行時需要的最小依賴
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# 建立非 root 使用者
RUN groupadd --system pixelagents && \
    useradd --system --gid pixelagents --create-home pixelagents

WORKDIR /app

# 複製建置產物與執行時依賴
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules/ node_modules/

# shared
COPY --from=build /app/shared/package.json shared/
COPY --from=build /app/shared/dist/ shared/dist/

# server
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist/ server/dist/
COPY --from=build /app/server/node_modules/ server/node_modules/

# client（靜態檔案由 server 提供）
COPY --from=build /app/client/dist/ client/dist/
# 素材檔案（PNG、JSON）
COPY --from=build /app/client/public/ client/public/

# agent-node（選用，但保留完整性）
COPY --from=build /app/agent-node/package.json agent-node/
COPY --from=build /app/agent-node/dist/ agent-node/dist/

# 資料目錄（掛載點）
RUN mkdir -p /home/pixelagents/.pixel-agents && \
    chown -R pixelagents:pixelagents /home/pixelagents/.pixel-agents

USER pixelagents

EXPOSE 13001

# 健康檢查：每 30 秒透過 /health 端點確認服務狀態
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:13001/health || exit 1

CMD ["node", "server/dist/index.js"]
