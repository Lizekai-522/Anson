# 爸妈出行宝 · 自托管镜像（可选部署参考，沙箱内未执行 docker build）
# 构建：node 22 跑 vite build；运行：nginx 托管纯静态产物（无后端）
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80