FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# 只带运行所需文件；运行期数据写到 /app/runtime（可挂卷）
COPY package.json ./
COPY server.js ./
COPY data/menu.json ./data/menu.json
COPY public ./public

RUN mkdir -p /app/runtime

ENV PORT=3000
ENV DB_FILE=/app/runtime/db.json
EXPOSE 3000
VOLUME ["/app/runtime"]

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
