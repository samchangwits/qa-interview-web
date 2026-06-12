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

# scenarioA（no shadow login）
docker run -d \
  -p 8082:8082 \
  -v $(pwd):/app \
  -v /app/node_modules \
  -e INDEX_MODE=scenarioA \
  --name my-wits-lab-scenarioA \
  wits-lab

# scenarioB (shadow login)
docker run -d \
  -p 8082:8082 \
  -v $(pwd):/app \
  -v /app/node_modules \
  -e INDEX_MODE=scenarioB \
  --name my-wits-lab-scenarioB \
  wits-lab

# scenarioC Reservation page
docker run -d \
  -p 8082:8082 \
  -v $(pwd):/app \
  -v /app/node_modules \
  -e INDEX_MODE=scenarioC \
  --name my-wits-lab-scenarioC \
  wits-lab

# scenarioD User Management System
docker run -d \
  -p 8082:8082 \
  -v $(pwd):/app \
  -v /app/node_modules \
  -e INDEX_MODE=scenarioD \
  --name my-wits-lab-scenarioD \
  wits-lab

# scenarioE
docker run -d \
  -p 8082:8082 \
  -v $(pwd):/app \
  -v /app/node_modules \
  -e INDEX_MODE=scenarioE \
  --name my-wits-lab-scenarioE \
  wits-lab

# scenarioC / scenarioD / scenarioE 只要替換 INDEX_MODE 值即可
# -e INDEX_MODE=scenarioC
# -e INDEX_MODE=scenarioD
# -e INDEX_MODE=scenarioE

# 修改 server.js 後（如更換密碼），執行 restart 讓變更生效（不需重新 run）：
# docker restart my-wits-lab-scenarioA
# docker restart my-wits-lab-scenarioB

# 面試結束後手動清理容器：
# docker rm -f my-wits-lab-scenarioA my-wits-lab-scenarioB


# 4. 啟動 ngrok 專屬通道對外發布 API/Swagger/wits-lab
ngrok start --all

# 5. 開啟考官快速切題頁
# 本機：http://localhost:8082/scenario-manager
# 功能：點選 scenarioA~E、複製 docker run 指令、快速開啟對應 scenario 頁面

# 6. 各 Scenario 對應的 Endpoint 一覽
#
# ── ScenarioA / ScenarioB（Login + Checkout）─────────────────────────────
#   頁面：http://localhost:8082/
#   後端：POST /api/action  (login / createOrder)
#   資料來源：JSON Server @ 9090 (users / products)
#   Swagger：http://localhost:8082/api-docs/json-server
#     GET    /users              取得所有使用者
#     POST   /users              新增使用者
#     PATCH  /users/{id}         更新使用者
#     DELETE /users/{id}         刪除使用者
#     GET    /products           取得所有商品
#     POST   /products           新增商品
#     PATCH  /products/{id}      更新商品
#     DELETE /products/{id}      刪除商品
#
# ── ScenarioC（Reservation）──────────────────────────────────────────────
#   頁面：http://localhost:8082/scenario/scenarioC
#   後端：POST /api/scenario-c/book-now  (送出訂位)
#   資料儲存：data/scenarioC-bookings.json
#
# ── ScenarioD（User Management System）──────────────────────────────────
#   頁面：http://localhost:8082/scenario/scenarioD
#   Swagger：http://localhost:8082/api-docs/user-management
#     GET    /api/users          取得使用者列表（支援 offset/limit/name/status）
#     POST   /api/users          新增使用者
#     PUT    /api/users/{id}     更新使用者
#     DELETE /api/users/{id}     刪除使用者
#   資料儲存：data/scenarioD-users.json
#
# ── 共用 ─────────────────────────────────────────────────────────────────
#   GET /api/scenarios           取得所有 scenario 設定
#   GET /scenario/{scenarioId}   直接訪問指定 scenario 頁面
#   GET /scenario-manager        考官切題管理頁

# 常見錯誤排除
# 1) container name conflict（容器名稱重複）
# docker rm -f my-wits-lab-scenarioA

# 2) macOS mounts denied（/Volumes 路徑未加入 Docker File Sharing）
# 方案A：到 Docker Desktop -> Settings -> Resources -> File Sharing 加入：
# /Volumes/DevSSD/Documents/qa-interview-web
# 方案B：先不掛載 volume，直接啟動容器：
# docker run -d -p 8082:8082 -e INDEX_MODE=scenarioA --name my-wits-lab-scenarioA wits-lab
```

---

## 🖥️ 不使用 Docker：直接啟動 Server

> Docker 沒有運行，或想快速本機測試時，可用以下指令直接啟動 `server.js`。
> **所有 scenario（A～E）共用同一個 server**，不是只有 scenarioC 才需要開。

### 啟動 Server（前景，關掉 Terminal 就停止）

```bash
cd /Users/zhangheli/Documents/qa-interview-web

# 不指定 INDEX_MODE 時預設為 scenarioA
node server.js

# 指定 scenario（A～E）
INDEX_MODE=scenarioC node server.js
```

### 啟動 Server（背景，關掉 Terminal 仍繼續執行）

```bash
cd /Users/zhangheli/Documents/qa-interview-web

# ⚠️ 務必帶上 INDEX_MODE，否則預設 fallback 成 scenarioA
INDEX_MODE=scenarioC nohup node server.js > server.log 2>&1 &
```

> **注意**：`INDEX_MODE` 決定首頁（`/`）顯示哪個 scenario。
> 所有 `/scenario/scenarioA` ～ `/scenario/scenarioE` 的直接路由不受影響，永遠都可訪問。

### 確認 Server 是否正在運行

```bash
lsof -ti:8082 && echo "✅ running on port 8082" || echo "❌ not running"
```

### 查看 Server Log

```bash
tail -f /Users/zhangheli/Documents/qa-interview-web/server.log
```

### 停止 Server

```bash
lsof -ti:8082 | xargs kill -9
```

---

## 🌍 ngrok Tunnel 對應表

> 執行 `ngrok start --all` 後，依照 `ngrok.yml` 設定，三條 tunnel 各自對應不同 port：

| Tunnel 名稱 | ngrok 公開網址範例 | 對應 Port | 用途 |
| --- | --- | --- | --- |
| `wits-lab` | `https://xxxx.ngrok-free.app` | **8082** | 主要 App（所有 scenario 頁面 + API） |
| `qa-api` | `https://xxxx.ngrok-free.app` | 9090 | JSON Server（scenarioA/B 資料） |
| `qa-docs` | `https://xxxx.ngrok-free.app` | 8081 | Swagger / API 文件 |

查詢目前 tunnel 的實際網址：

```bash
curl -s http://127.0.0.1:4040/api/tunnels | python3 -m json.tool
```

---

## 📅 ScenarioC — 時段（Slot）設定說明

時段狀態由 `public/scenarioC-slots.json` 控制，**修改後不需重啟 server，刷新頁面即生效**。

### JSON 格式

```json
{
  "defaultSlots": [
    { "time": "17:00", "seats": 4 },
    { "time": "18:00", "seats": 0 },
    { "time": "19:00", "seats": null }
  ],
  "dateOverrides": {
    "2026-06-12": [
      { "time": "17:00", "seats": 1 },
      { "time": "18:00", "seats": 0 }
    ]
  }
}
```

| `seats` 值 | 前端顯示 | 可否點選 |
| --- | --- | --- |
| `0` | `Full`（劃線灰底） | ❌ 不可 |
| `N`（正整數） | `N left` | ✅ 可 |
| `null` | 無標籤（無上限） | ✅ 可 |

- **`defaultSlots`**：所有日期的預設時段
- **`dateOverrides`**：特定日期完整覆蓋預設，key 為 `YYYY-MM-DD`

### Slots API

```text
GET /api/booking/slots?date=YYYY-MM-DD
```

範例：

```bash
# 查詢今天的時段
curl http://localhost:8082/api/booking/slots?date=2026-06-11

# 透過 ngrok 查詢（帶跳過警告頁 header）
curl -H "ngrok-skip-browser-warning: true" \
  "https://<wits-lab-ngrok-url>/api/booking/slots?date=2026-06-11"
```
