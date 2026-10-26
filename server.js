require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const os = require("os");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "student_expense_tracker_secret_2026";

// ─── Database Connection ─────────────────────────────────
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres.qmpfbgdcxuinrvpgnxju:expensetracker12312@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});

// ─── Database Initialization ─────────────────────────────
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(64) PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by VARCHAR(255),
        description VARCHAR(255) NOT NULL,
        amount NUMERIC(12, 2) NOT NULL,
        type VARCHAR(32) NOT NULL,
        category VARCHAR(64) NOT NULL,
        date VARCHAR(32) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(64) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log(" PostgreSQL database initialized successfully.");
  } catch (err) {
    console.error("Error initializing PostgreSQL database:", err);
  }
}

initDb();

// ─── Middleware ──────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Optional / Required JWT Middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (err) {
      // Invalid token, proceed as unauthenticated
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
}

function requireAuth(req, res, next) {
  authMiddleware(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    next();
  });
}

// ─── Server-Sent Events (Real-Time Sync) ─────────────────
const sseClients = new Set();

function broadcastSync(event = "sync") {
  const payload = `data: ${JSON.stringify({ event, timestamp: Date.now() })}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("data: connected\n\n");

  sseClients.add(res);

  // Heartbeat to keep connection alive across mobile networks
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ─── Auth Endpoints ─────────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || password.length < 6) {
    return res.status(400).json({
      error: "Valid email and a password of at least 6 characters are required.",
    });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [
      normalizedEmail,
    ]);
    if (existing.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists." });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const displayName = name ? name.trim() : normalizedEmail.split("@")[0];

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [displayName, normalizedEmail, passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.status(201).json({ token, user });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const result = await pool.query(
      "SELECT id, name, email, password_hash FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ─── Centralized Expenses & Data ────────────────────────
app.get("/api/data", async (req, res) => {
  try {
    const txnResult = await pool.query(
      `SELECT id, user_id, created_by, description, amount::float, type, category, date, created_at
       FROM transactions
       ORDER BY date DESC, created_at DESC`
    );

    const budgetResult = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'monthly_budget'`
    );

    const budget =
      budgetResult.rows.length > 0 && budgetResult.rows[0].value != null
        ? Number(budgetResult.rows[0].value)
        : 0;

    res.json({
      transactions: txnResult.rows,
      budget,
    });
  } catch (err) {
    console.error("Error fetching data:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// Add a Transaction
app.post("/api/transactions", authMiddleware, async (req, res) => {
  const { id, description, amount, type, category, date } = req.body;

  if (!description || !amount || !type || !category || !date) {
    return res.status(400).json({ error: "All transaction fields are required." });
  }

  const txnId = id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const userId = req.user ? req.user.id : null;
  const createdBy = req.user ? (req.user.name || req.user.email) : "Guest / Shared";

  try {
    const result = await pool.query(
      `INSERT INTO transactions (id, user_id, created_by, description, amount, type, category, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id, created_by, description, amount::float, type, category, date, created_at`,
      [txnId, userId, createdBy, description, amount, type, category, date]
    );

    broadcastSync("transaction_added");
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error adding transaction:", err);
    res.status(500).json({ error: "Failed to save transaction to database." });
  }
});

// Delete a Transaction
app.delete("/api/transactions/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM transactions WHERE id = $1", [id]);
    broadcastSync("transaction_deleted");
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting transaction:", err);
    res.status(500).json({ error: "Failed to delete transaction." });
  }
});

// Clear All Transactions
app.delete("/api/transactions", async (req, res) => {
  try {
    await pool.query("TRUNCATE TABLE transactions");
    broadcastSync("transactions_cleared");
    res.json({ success: true });
  } catch (err) {
    console.error("Error clearing transactions:", err);
    res.status(500).json({ error: "Failed to clear transactions." });
  }
});

// Set Centralized Monthly Budget
app.post("/api/budget", async (req, res) => {
  const { budget } = req.body;
  if (budget == null || isNaN(budget) || budget < 0) {
    return res.status(400).json({ error: "Invalid budget value." });
  }

  try {
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('monthly_budget', $1, NOW())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(budget)]
    );

    broadcastSync("budget_updated");
    res.json({ success: true, budget });
  } catch (err) {
    console.error("Error setting budget:", err);
    res.status(500).json({ error: "Failed to update budget." });
  }
});

// Helper to find local IPv4 for easy mobile phone access
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

// Fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ─── Start Server ────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  const localIp = getLocalIp();
  console.log(`\n======================================================`);
  console.log(` Student Expense Tracker Backend is Running!`);
  console.log(` Database: Supabase PostgreSQL (Centralized Logs)`);
  console.log(` Laptop access: http://localhost:${PORT}`);
  console.log(` Phone access:  http://${localIp}:${PORT}`);
  console.log(`======================================================\n`);
});
