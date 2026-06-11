const express = require('express');
const axios = require('axios'); // 取代 UrlFetchApp
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const swaggerUi = require('swagger-ui-express');
const yaml = require('js-yaml');
const app = express();
const PORT = 8082;

const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'scenarioC-bookings.json');
const SLOTS_CONFIG_FILE = path.join(__dirname, 'public', 'scenarioC-slots.json');
let bookingsWriteQueue = Promise.resolve();

const SCENARIOD_USERS_FILE = path.join(DATA_DIR, 'scenarioD-users.json');
let scenarioDWriteQueue = Promise.resolve();

// 支援 scenarioA~scenarioE，並保留 shadow/noshadow 相容模式
const SCENARIO_FILE_MAP = {
  scenarioA: 'index_noShadow.html',
  scenarioB: 'index.html',
  scenarioC: 'scenarios/scenarioC.html',
  scenarioD: 'scenarios/scenarioD.html',
  scenarioE: 'scenarios/scenarioE.html',
  noshadow: 'index_noShadow.html',
  shadow: 'index.html'
};
const SUPPORTED_SCENARIOS = ['scenarioA', 'scenarioB', 'scenarioC', 'scenarioD', 'scenarioE'];
const REQUESTED_MODE = process.env.INDEX_MODE || process.env.SCENARIO || 'scenarioA';
const RESOLVED_MODE = SCENARIO_FILE_MAP[REQUESTED_MODE] ? REQUESTED_MODE : 'scenarioA';
const INDEX_FILE = SCENARIO_FILE_MAP[RESOLVED_MODE];
const LEGACY_MODE_TO_SCENARIO = {
  noshadow: 'scenarioA',
  shadow: 'scenarioB'
};

if (RESOLVED_MODE !== REQUESTED_MODE) {
  console.warn(`[Config] Unsupported INDEX_MODE: ${REQUESTED_MODE}. Fallback to scenarioA.`);
}
console.log(`[Config] Index mode: ${RESOLVED_MODE} (requested: ${REQUESTED_MODE}) → serving ${INDEX_FILE}`);

function normalizeScenarioId(mode) {
  if (SUPPORTED_SCENARIOS.includes(mode)) {
    return mode;
  }
  return LEGACY_MODE_TO_SCENARIO[mode] || 'scenarioA';
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 讓 Express 服務靜態網頁，index: false 避免自動回傳 index.html 蓋掉下方路由
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Swagger UI for User Management (scenarioD)
const swaggerDoc = yaml.load(fsSync.readFileSync(path.join(__dirname, 'docs/user-management-swagger.yml'), 'utf8'));
app.use('/api-docs/user-management', swaggerUi.serve, swaggerUi.setup(swaggerDoc, {
  customSiteTitle: 'User Management API Docs'
}));

// Swagger UI for ScenarioA/B - JSON Server (Users & Products)
const swaggerDocAB = yaml.load(fsSync.readFileSync(path.join(__dirname, 'docs/user-and-product-management-swagger.yml'), 'utf8'));
app.use('/api-docs/json-server', swaggerUi.serve, swaggerUi.setup(swaggerDocAB, {
  customSiteTitle: 'SDET Assessment API Docs'
}));

// 根路徑根據 INDEX_MODE 動態回傳對應的 HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', INDEX_FILE));
});

// 考官快速切題頁
app.get('/scenario-manager', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scenario-manager.html'));
});

// 提供前端管理頁所需的 scenario 設定資訊
app.get('/api/scenarios', (req, res) => {
  const currentScenario = normalizeScenarioId(RESOLVED_MODE);
  const scenarioFiles = {};

  SUPPORTED_SCENARIOS.forEach((scenarioId) => {
    scenarioFiles[scenarioId] = SCENARIO_FILE_MAP[scenarioId];
  });

  return res.json({
    success: true,
    currentScenario,
    supportedScenarios: SUPPORTED_SCENARIOS,
    scenarioFiles,
    scenarioUrls: SUPPORTED_SCENARIOS.map((scenarioId) => `/scenario/${scenarioId}`)
  });
});

// 額外提供明確 scenario 路由：/scenario/scenarioA ~ /scenario/scenarioE
app.get('/scenario/:scenarioId', (req, res) => {
  const scenarioId = req.params.scenarioId;

  if (!SUPPORTED_SCENARIOS.includes(scenarioId)) {
    return res.status(404).json({
      success: false,
      message: `Unknown scenario: ${scenarioId}`,
      supportedScenarios: SUPPORTED_SCENARIOS
    });
  }

  const file = SCENARIO_FILE_MAP[scenarioId];
  return res.sendFile(path.join(__dirname, 'public', file));
});

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDateYYYYMMDD(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isValidTimeHHMM(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidPhone(value) {
  const phone = normalizePhone(value);
  return phone.length >= 8 && phone.length <= 15;
}

function generateBookingId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 1679616).toString(36).toUpperCase().padStart(4, '0');
  return `BK-${ts}-${rand}`;
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(BOOKINGS_FILE);
  } catch (_error) {
    await fs.writeFile(BOOKINGS_FILE, '[]\n', 'utf8');
  }
}

async function readBookings() {
  await ensureDataFile();
  const raw = await fs.readFile(BOOKINGS_FILE, 'utf8');
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (_error) {
    return [];
  }
}

async function saveBookings(bookings) {
  await ensureDataFile();
  await fs.writeFile(BOOKINGS_FILE, JSON.stringify(bookings, null, 2) + '\n', 'utf8');
}

async function withBookingsLock(task) {
  const run = bookingsWriteQueue.then(task, task);
  bookingsWriteQueue = run.then(() => undefined, () => undefined);
  return run;
}

// 計算各 slot 扣除已訂人數後的動態剩餘座位
// configuredSeats=null → 無上限；=0 → 停用；=N → 扣除已訂後剩餘
function computeSlots(rawSlots, bookings, date) {
  return rawSlots.map(s => {
    const configuredSeats = s.seats === undefined ? null : s.seats;
    if (configuredSeats === null) return { time: s.time, available: true, seats: null };
    if (configuredSeats === 0)    return { time: s.time, available: false, seats: 0 };

    // 該 date + time 已被訂走的總人數
    const bookedCount = bookings
      .filter(b =>
        b.reservation &&
        String(b.reservation.bookingDate) === date &&
        String(b.reservation.bookingTime) === s.time
      )
      .reduce((sum, b) => sum + (Number(b.reservation.partySize) || 0), 0);

    const remaining = Math.max(0, configuredSeats - bookedCount);
    return { time: s.time, available: remaining > 0, seats: remaining };
  });
}

app.get('/api/scenario-c/slots', async (req, res) => {
  const date = String(req.query.date || '').trim();

  // 讀取 slots 設定檔
  let config;
  try {
    const raw = await fs.readFile(SLOTS_CONFIG_FILE, 'utf8');
    config = JSON.parse(raw);
  } catch (_) {
    const fallback = [
      '17:00','17:20','17:40','18:00','18:20','18:40',
      '19:00','19:20','19:40','20:00','20:20','20:40'
    ].map(t => ({ time: t, available: true, seats: null }));
    return res.json({ date: date || null, slots: fallback });
  }

  // 決定使用哪一組 slot 定義（dateOverrides 優先，否則 defaultSlots）
  let rawSlots;
  if (date && config.dateOverrides && config.dateOverrides[date]) {
    rawSlots = config.dateOverrides[date];
  } else if (Array.isArray(config.defaultSlots)) {
    rawSlots = config.defaultSlots;
  } else if (Array.isArray(config.slots)) {
    // 向下相容舊格式 { slots: [ { time, available } ] }
    return res.json({
      date: date || null,
      slots: config.slots.map(s => ({
        time: s.time,
        available: s.available !== false,
        seats: s.available !== false ? null : 0
      }))
    });
  } else {
    return res.status(500).json({ error: 'Invalid slots config format.' });
  }

  // 讀取訂位記錄，動態計算剩餘名額
  const bookings = await readBookings();
  const slots = computeSlots(rawSlots, bookings, date);

  res.json({ date: date || null, slots });
});

app.post('/api/scenario-c/book-now', async (req, res) => {
  try {
    const body = req.body || {};
    const reservation = body.reservation || {};
    const contact = body.contact || {};

    const missing = [];
    if (!reservation.partySize) missing.push('reservation.partySize');
    if (!reservation.bookingDate) missing.push('reservation.bookingDate');
    if (!reservation.bookingTime) missing.push('reservation.bookingTime');
    if (!contact.fullName || !String(contact.fullName).trim()) missing.push('contact.fullName');
    if (!contact.phone || !String(contact.phone).trim()) missing.push('contact.phone');
    if (!contact.email || !String(contact.email).trim()) missing.push('contact.email');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields.',
        missing
      });
    }

    const partySize = Number(reservation.partySize);
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) {
      return res.status(400).json({
        success: false,
        message: 'Invalid party size. Expected integer between 1 and 20.'
      });
    }

    if (!isValidDateYYYYMMDD(reservation.bookingDate)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking date. Expected format YYYY-MM-DD.'
      });
    }

    if (!isValidTimeHHMM(reservation.bookingTime)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking time. Expected format HH:MM (24-hour).'
      });
    }

    if (!isValidEmail(contact.email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format.'
      });
    }

    if (!isValidPhone(contact.phone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone format. Please provide a valid phone number.'
      });
    }

    const normalizedPhone = normalizePhone(contact.phone);
    const bookingDate = String(reservation.bookingDate);
    const bookingTime = String(reservation.bookingTime);

    const result = await withBookingsLock(async () => {
      const bookings = await readBookings();

      // ── 動態名額驗證（在 lock 內，確保並發安全）────────────────────────
      try {
        const raw = await fs.readFile(SLOTS_CONFIG_FILE, 'utf8');
        const config = JSON.parse(raw);

        let rawSlots;
        if (config.dateOverrides && config.dateOverrides[bookingDate]) {
          rawSlots = config.dateOverrides[bookingDate];
        } else if (Array.isArray(config.defaultSlots)) {
          rawSlots = config.defaultSlots;
        } else if (Array.isArray(config.slots)) {
          rawSlots = config.slots.map(s => ({ time: s.time, seats: s.available !== false ? null : 0 }));
        }

        if (rawSlots) {
          const computed = computeSlots(rawSlots, bookings, bookingDate);
          const slotInfo = computed.find(s => s.time === bookingTime);
          if (slotInfo) {
            if (!slotInfo.available) {
              return {
                seatError: true,
                message: `Time slot ${bookingTime} is fully booked on ${bookingDate}.`
              };
            }
            if (slotInfo.seats !== null && partySize > slotInfo.seats) {
              return {
                seatError: true,
                message: `Not enough seats: only ${slotInfo.seats} left for ${bookingTime} on ${bookingDate}, but requested party size is ${partySize}.`
              };
            }
          }
        }
      } catch (_) {
        // slots config 讀取失敗，略過名額驗證
      }
      // ─────────────────────────────────────────────────────────────────
      const duplicate = bookings.find((item) => {
        const existingPhone = normalizePhone(item && item.contact ? item.contact.phone : '');
        const existingDate = item && item.reservation ? String(item.reservation.bookingDate || '') : '';
        return existingPhone === normalizedPhone && existingDate === bookingDate;
      });

      if (duplicate) {
        return { duplicate: true, bookingId: duplicate.bookingId };
      }

      const booking = {
        bookingId: generateBookingId(),
        source: 'scenarioC',
        reservation: {
          partySize,
          bookingDate,
          bookingTime,
          occasion: String(reservation.occasion || ''),
          notes: String(reservation.notes || '')
        },
        contact: {
          fullName: String(contact.fullName).trim(),
          phone: normalizedPhone,
          email: normalizeEmail(contact.email)
        },
        sourcePage: String(body.sourcePage || ''),
        submittedAt: body.submittedAt || new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      bookings.push(booking);
      await saveBookings(bookings);

      return { duplicate: false, booking };
    });

    if (result.seatError) {
      return res.status(422).json({ success: false, message: result.message });
    }

    if (result.duplicate) {
      return res.status(409).json({
        success: false,
        message: `Duplicate booking detected: this phone already has a booking on ${bookingDate}.`,
        bookingId: result.bookingId
      });
    }

    return res.status(201).json({
      success: true,
      message: `Booking confirmed. Reference: ${result.booking.bookingId}`,
      bookingId: result.booking.bookingId
    });
  } catch (error) {
    console.error('[Scenario C] Book Now API error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while processing booking.'
    });
  }
});

// ============= Scenario D: User Management API =============

async function ensureScenarioDUsersFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(SCENARIOD_USERS_FILE);
  } catch (_error) {
    const initialUsers = [
      { id: 1, name: 'Alice Johnson', email: 'alice@test.com', role: 'QA', status: 'Active' },
      { id: 2, name: 'Bob Smith', email: 'bob@test.com', role: 'SDET', status: 'Active' },
      { id: 3, name: 'Charlie Brown', email: 'charlie@test.com', role: 'Developer', status: 'Inactive' }
    ];
    await fs.writeFile(SCENARIOD_USERS_FILE, JSON.stringify(initialUsers, null, 2) + '\n', 'utf8');
  }
}

async function readScenarioDUsers() {
  await ensureScenarioDUsersFile();
  const raw = await fs.readFile(SCENARIOD_USERS_FILE, 'utf8');
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (_error) {
    return [];
  }
}

async function saveScenarioDUsers(users) {
  await ensureScenarioDUsersFile();
  await fs.writeFile(SCENARIOD_USERS_FILE, JSON.stringify(users, null, 2) + '\n', 'utf8');
}

async function withScenarioDLock(task) {
  const run = scenarioDWriteQueue.then(task, task);
  scenarioDWriteQueue = run.then(() => undefined, () => undefined);
  return run;
}

// GET /api/users - List users with optional search and pagination
app.get('/api/users', async (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
    const searchName = (req.query.name || '').toLowerCase().trim();
    const searchStatus = (req.query.status || '').trim();

    const allUsers = await readScenarioDUsers();

    // Filter by name and status
    let filtered = allUsers;
    if (searchName) {
      filtered = filtered.filter(u => u.name.toLowerCase().includes(searchName));
    }
    if (searchStatus) {
      filtered = filtered.filter(u => u.status === searchStatus);
    }

    // Pagination
    const total = filtered.length;
    const paginated = filtered.slice(offset, offset + limit);

    return res.status(200).json({
      success: true,
      users: paginated,
      total,
      offset,
      limit
    });
  } catch (error) {
    console.error('[Scenario D] GET users error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching users'
    });
  }
});

// POST /api/users - Add new user
app.post('/api/users', async (req, res) => {
  try {
    const { name, email, role, status } = req.body;

    const missing = [];
    if (!name || !String(name).trim()) missing.push('name');
    if (!email || !String(email).trim()) missing.push('email');
    if (!role || !String(role).trim()) missing.push('role');
    if (!status || !String(status).trim()) missing.push('status');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        missing
      });
    }

    const newUser = await withScenarioDLock(async () => {
      const users = await readScenarioDUsers();
      const newId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
      const user = {
        id: newId,
        name: String(name).trim(),
        email: String(email).trim(),
        role: String(role).trim(),
        status: String(status).trim()
      };
      users.push(user);
      await saveScenarioDUsers(users);
      return user;
    });

    return res.status(201).json({
      success: true,
      message: 'User added successfully',
      user: newUser
    });
  } catch (error) {
    console.error('[Scenario D] POST user error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error adding user'
    });
  }
});

// PUT /api/users/:id - Edit user
app.put('/api/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { name, email, role, status } = req.body;

    const missing = [];
    if (!name || !String(name).trim()) missing.push('name');
    if (!email || !String(email).trim()) missing.push('email');
    if (!role || !String(role).trim()) missing.push('role');
    if (!status || !String(status).trim()) missing.push('status');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        missing
      });
    }

    const updatedUser = await withScenarioDLock(async () => {
      const users = await readScenarioDUsers();
      const index = users.findIndex(u => u.id === userId);
      if (index === -1) {
        throw new Error('User not found');
      }
      users[index] = {
        id: userId,
        name: String(name).trim(),
        email: String(email).trim(),
        role: String(role).trim(),
        status: String(status).trim()
      };
      await saveScenarioDUsers(users);
      return users[index];
    });

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user: updatedUser
    });
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    console.error('[Scenario D] PUT user error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error updating user'
    });
  }
});

// DELETE /api/users/:id - Delete user
app.delete('/api/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);

    const result = await withScenarioDLock(async () => {
      const users = await readScenarioDUsers();
      const index = users.findIndex(u => u.id === userId);
      if (index === -1) {
        throw new Error('User not found');
      }
      const deletedUser = users.splice(index, 1)[0];
      await saveScenarioDUsers(users);
      return deletedUser;
    });

    return res.status(200).json({
      success: true,
      message: 'User deleted successfully',
      user: result
    });
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    console.error('[Scenario D] DELETE user error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error deleting user'
    });
  }
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
  const baseUrl = "https://1bee-2001-b011-980a-1bdf-59a2-9faf-c23c-afbb.ngrok-free.app";
  
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
  const validPassword = 'secret_0612_sauce';
  
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
    } else if (user === 'standard_0612_user') {
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