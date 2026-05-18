FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8082
# 預設為 noshadow，可在 docker run 時用 -e INDEX_MODE=shadow 覆蓋
ENV INDEX_MODE=noshadow
CMD ["node", "server.js"]