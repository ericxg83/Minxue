# 后端镜像：Node 22 + Chromium 运行库 + 中文字体
# 构建上下文是 ./server（见 docker-compose.yml 的 build.context）
FROM node:22-bookworm-slim

WORKDIR /app

# Chromium 运行所需的系统库
# （@sparticuz/chromium / puppeteer-core 渲染 PDF 报告都依赖这些 .so）
# fonts-noto-cjk 是中文 PDF 渲染必需，缺了中文会显示成方块
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    fonts-noto-cjk fonts-noto-cjk-extra \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# 只装生产依赖；@sparticuz/chromium 的二进制在 npm ci 阶段随包下载
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "index.js"]
