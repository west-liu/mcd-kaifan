FROM node:22-alpine

WORKDIR /app

# 零第三方依赖，只拷运行必需的源码与静态资源
COPY package.json server.js mcp.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production
ENV PORT=5173
ENV ENABLE_ORDER=0

EXPOSE 5173

CMD ["node", "server.js"]
