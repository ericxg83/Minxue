# ============================================
# 敏学后端 - 试卷 PDF 渲染（Playwright + Chromium）
# ============================================
# 镜像来源：mcr.microsoft.com/playwright 官方镜像（已装好 Chromium + 系统库）
# 比裸 Playwright 镜像大，但省去装系统库的麻烦
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

# 容器内工作目录
WORKDIR /app

# 先复制 package.json 装依赖（利用 Docker 层缓存）
COPY package*.json ./

# 装生产依赖（playwright 已自带 Chromium，但需要确保系统库不冲突）
RUN npm install --omit=dev

# 复制源码
COPY . .

# Render 容器对外暴露端口（render.yaml 里 PORT=3001）
EXPOSE 3001

# 启动命令（render.yaml 也指定了 startCommand，这里作默认）
CMD ["node", "index.js"]
