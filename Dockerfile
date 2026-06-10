FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8082
# 預設為 scenarioA，可在 docker run 時用 -e INDEX_MODE=scenarioB 覆蓋
ENV INDEX_MODE=scenarioA
CMD ["node", "server.js"]