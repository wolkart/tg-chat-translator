# Сервер: Node 24 исполняет TypeScript напрямую — сборки и транспайлера в образе нет.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# Каталог базы создаём заранее и отдаём непривилегированному пользователю: под
# именованным томом права наследуются от него.
RUN mkdir -p /app/data && chown -R node:node /app

# Root внутри контейнера не нужен: наружу ничего не слушаем, пишем только в /app/data.
USER node

CMD ["node", "src/main.ts"]
