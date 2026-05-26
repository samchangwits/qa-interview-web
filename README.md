# WITS Labs - SDET Lab 靶機環境部署指南

本文件記錄將原本 Google Apps Script (GAS) 專案轉型為地端 **Node.js Express + Docker 容器化**，並整合 **ngrok** 設定多通道對外發布的完整實作步驟。此環境專為 Playwright / Cypress 等自動化測試演練設計。


## 📂 專案目錄結構

在開始之前，請確保你的地端專案資料夾結構如下所示：

```text
你的專案資料夾/
├── Dockerfile
├── package.json
├── server.js
└── public/
    └── index.html

```

## 🛠️ 步驟一：初始化環境與安裝套件

在專案根目錄開啟終端機（Terminal），依序執行以下指令以建立 Node.js 專案並安裝 Axios 與 Express 套件：

```bash
# 初始化 package.json
npm init -y

# 安裝 Express (後端服務) 與 Axios (替代 UrlFetchApp 請求 JSON Server)
npm install express axios
```
接著，打開 `package.json`，在 `"scripts"` 區塊中加入 `"dev"` 監聽指令：

```json
"scripts": {
  "start": "node server.js",
  "dev": "npx nodemon server.js"
}
```

## 📄 步驟二：後端程式碼 (`server.js`)

請在根目錄建立 `server.js`，將原來的 `Code.gs` 邏輯轉化為 Express 路由。本服務固定監聽 **`8082`** 埠號：


## 📄 步驟三：前端網頁 (`public/index.html`)

請在 `public/` 資料夾下建立 `index.html`。原本的 `google.script.run` 已全面替換為網頁標準的 `fetch('/api/action')`，並內嵌 `data-test` 自動化測試定位點：

## 🐳 步驟四：Docker 部署設定 (`Dockerfile`)

建立 `Dockerfile`，並確保 `CMD` 參數正確拆分，以啟動帶有隨時熱重載功能的 `npm run dev` 開發模式：

## 🌐 步驟五：ngrok 多通道設定 (`ngrok.yml`)

打開本機的設定檔 `~/Library/Application Support/ngrok/ngrok.yml`，將 `wits-lab` 綁定至 `8082` Port：

```yaml
version: "2"
authtoken: YOUR_AUTH_TOKEN_HERE
tunnels:
  qa-api:
    proto: http
    addr: 9090
  qa-docs:
    proto: http
    addr: 8081
  wits-lab:
    proto: http
    addr: 8082

```

## 🚀 步驟六：編譯與無痛熱更新啟動命令

執行以下命令進行容器編譯，並**掛載地端 Volume**。這樣一來，不論修改 `server.js` 還是 `index.html`，皆**不需要重啟容器**，存檔立即刷新生效：

```bash
# 1. 建立 Docker 映像檔
docker build -t wits-lab .

# 2. 強制刪除可能殘留的同名容器
docker rm -f my-wits-lab

# 3. 運行容器 (啟用 Volume 掛載以實現即時免重啟同步)
# 注意：不加 --rm，這樣修改 server.js（如密碼）後只需 docker restart，不需重新 run
# 如果需要換shadow版的話就得砍掉容器重新跑另一個新的容器

# 無shadow DOM版本
docker run -d \
  -p 8082:8082 \
  -v $(pwd):/app \
  -v /app/node_modules \
  -e INDEX_MODE=noshadow \
  --name my-wits-lab-noshadow \
  wits-lab

# 有shadow DOM版本
docker run -d \
  -p 8082:8082 \
  -v $(pwd):/app \
  -v /app/node_modules \
  -e INDEX_MODE=shadow \
  --name my-wits-lab-shadow \
  wits-lab

# 修改 server.js 後（如更換密碼），執行 restart 讓變更生效（不需重新 run）：
# docker restart my-wits-lab-noshadow
# docker restart my-wits-lab-shadow

# 面試結束後手動清理容器：
# docker rm -f my-wits-lab-noshadow my-wits-lab-shadow


# 4. 啟動 ngrok 專屬通道對外發布 API/Swagger/wits-lab
ngrok start --all
```
