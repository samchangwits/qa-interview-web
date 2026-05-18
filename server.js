const express = require('express');
const axios = require('axios'); // 取代 UrlFetchApp
const path = require('path');
const app = express();
const PORT = 8082;

// INDEX_MODE=shadow  → 使用 index.html (Shadow DOM 版本)
// INDEX_MODE=noshadow → 使用 index_noShadow.html (一般 DOM 版本，預設)
const INDEX_MODE = process.env.INDEX_MODE || 'noshadow';
const INDEX_FILE = INDEX_MODE === 'shadow' ? 'index.html' : 'index_noShadow.html';
console.log(`[Config] Index mode: ${INDEX_MODE} → serving ${INDEX_FILE}`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 讓 Express 服務靜態網頁，index: false 避免自動回傳 index.html 蓋掉下方路由
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// 根路徑根據 INDEX_MODE 動態回傳對應的 HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', INDEX_FILE));
});

/**
 * 從外部 JSON Server 獲取資料
 * 包含 ngrok 跳過警告頁面的 Header 設定
 */
async function fetchExternalData() {
  const options = {
    headers: { "ngrok-skip-browser-warning": "true" }
  };
  // 這裡使用你更新後的 9090 port 對外網址
  const baseUrl = "https://8879-2001-b011-980b-5580-706e-5829-3e62-5c70.ngrok-free.app";
  
  try {
    const [prodRes, userRes] = await Promise.all([
      axios.get(`${baseUrl}/products`, options),
      axios.get(`${baseUrl}/users`, options)
    ]);
    return { users: userRes.data, products: prodRes.data };
  } catch (e) {
    console.error("API Fetch Error: " + e.message);
    return { users: [], products: [] };
  }
}

// 統一接收原本 google.script.run 的請求
app.post('/api/action', async (req, res) => {
  const { action, payload } = req.body;
  const data = JSON.parse(payload);
  const validPassword = 'secret_sauce';
  
  // 呼叫上方帶有正確網址的 fetchExternalData
  const currentDB = await fetchExternalData();

  if (action === 'login') {
    const user = data.username;
    const pass = data.password;

    if (pass !== validPassword) {
      return res.json({ success: false, message: "Epic sadface: Username and password do not match any user in this service" });
    }

    if (user === 'locked_out_user') {
      return res.json({ success: false, message: "Epic sadface: Sorry, this user has been locked out." });
    } else if (user === 'standard_user') {
      return res.json({ 
        success: true, 
        message: "Welcome back!", 
        userRole: user, 
        products: currentDB.products,
        availableUsers: currentDB.users 
      });
    }
    return res.json({ success: false, message: "Epic sadface: Username and password do not match any user in this service" });
  }

  if (action === 'createOrder') {
    if (data.currentUser === 'error_user') {
      return res.json({ success: false, message: "System Error: Failed to process order for error_user." });
    }
    const userEntry = currentDB.users.find(u => String(u.id) === String(data.userId));
    const product = currentDB.products.find(p => String(p.id) === String(data.productId));
    
    if (!userEntry || !product) {
      return res.json({ success: false, message: "Error: Missing required fields or invalid selection." });
    }
    const orderId = "ORD-" + Math.floor(Math.random() * 9000 + 1000);
    return res.json({ success: true, message: `Success: ${orderId} created for ${userEntry.name}` });
  }
});

// 監聽 8082 埠號
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));