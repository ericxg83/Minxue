# ============================================
# Playwright Chromium headless 启动需要的系统库
# mcr.microsoft.com/playwright 镜像里已装，这里只是备份说明
# ============================================

如果将来想用更小的镜像（node:22-slim + 手动装 chromium），需要以下系统库：

```
libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
libgbm1 libxshmfence1 libpango-1.0-0 libcairo2 libasound2 \
libatspi2.0-0 fonts-noto-cjk fonts-noto-color-emoji
```

Dockerfile 改用 node:22-slim 时的完整示例：

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libxshmfence1 libpango-1.0-0 libcairo2 libasound2 \
    libatspi2.0-0 fonts-noto-cjk fonts-noto-color-emoji \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3001
CMD ["node", "index.js"]
```

**优先用 mcr.microsoft.com/playwright 镜像**（已装好一切，约 1.5GB），部署稳定。
