require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "student_expense_tracker_secret_2026";

// ─── Native JWT (Zero dependency, ultra-fast) ───────────
function base64Url(str) {
  return Buffer.from(str).toString("base64url");
}

function signJwt(payload, secret = JWT_SECRET, expiresInDays = 60) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const expPayload = base64Url(
    JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + expiresInDays * 86400,
    })
  );
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${expPayload}`)
    .digest("base64url");
  return `${header}.${expPayload}.${signature}`;
}

function verifyJwt(token, secret = JWT_SECRET) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");
  const [header, payload, signature] = parts;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  if (signature !== expectedSignature) throw new Error("Invalid token signature");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }
  return decoded;
}

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
      CREATE TABLE IF NOT EXISTS public.users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        budget NUMERIC(12, 2) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS budget NUMERIC(12, 2) DEFAULT 0;

      CREATE TABLE IF NOT EXISTS public.transactions (
        id VARCHAR(64) PRIMARY KEY,
        user_id INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
        created_by VARCHAR(255),
        description VARCHAR(255) NOT NULL,
        amount NUMERIC(12, 2) NOT NULL,
        type VARCHAR(32) NOT NULL,
        category VARCHAR(64) NOT NULL,
        date VARCHAR(32) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log("PostgreSQL database ready.");
  } catch (err) {
    console.error("Error initializing PostgreSQL database:", err.message);
  }
}

// ─── Middleware ──────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Start listening immediately
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
  initDb();
});

// JWT Middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const decoded = verifyJwt(token);
      req.user = decoded;
    } catch (err) {
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
      return res.status(401).json({ error: "Please sign in to access your data." });
    }
    next();
  });
}

// ─── Real-Time Sync (Server-Sent Events) ─────────────────
const sseClients = new Map(); // userId -> Set of res objects

app.get("/api/events", authMiddleware, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("data: connected\n\n");

  const userId = req.user ? req.user.id : "guest";
  if (!sseClients.has(userId)) {
    sseClients.set(userId, new Set());
  }
  sseClients.get(userId).add(res);

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    if (sseClients.has(userId)) {
      sseClients.get(userId).delete(res);
      if (sseClients.get(userId).size === 0) {
        sseClients.delete(userId);
      }
    }
  });
});

function broadcastUserSync(userId) {
  if (sseClients.has(userId)) {
    const payload = `data: ${JSON.stringify({ event: "sync", timestamp: Date.now() })}\n\n`;
    for (const client of sseClients.get(userId)) {
      client.write(payload);
    }
  }
}

// ─── Authentication Endpoints ───────────────────────────

// Register
app.post("/api/auth/register", async (req, res) => {
  const { email, password, name, initialTransactions, initialBudget } = req.body;

  if (!email || !password || password.length < 4) {
    return res.status(400).json({
      error: "Please enter a valid email and a password of at least 4 characters.",
    });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const existing = await pool.query(
      "SELECT id FROM public.users WHERE email = $1",
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: "An account with this email already exists. Please Sign In.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const displayName = name && name.trim() ? name.trim() : normalizedEmail.split("@")[0];
    const budgetVal = typeof initialBudget === "number" ? initialBudget : 0;

    const result = await pool.query(
      `INSERT INTO public.users (name, email, password_hash, budget)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, budget, created_at`,
      [displayName, normalizedEmail, passwordHash, budgetVal]
    );

    const user = result.rows[0];

    // Migrate any initial guest transactions into the new account
    if (Array.isArray(initialTransactions) && initialTransactions.length > 0) {
      for (const t of initialTransactions) {
        if (t.description && t.amount && t.type && t.category && t.date) {
          const txnId = t.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
          await pool.query(
            `INSERT INTO public.transactions (id, user_id, created_by, description, amount, type, category, date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO NOTHING`,
            [txnId, user.id, user.name, t.description, t.amount, t.type, t.category, t.date]
          );
        }
      }
    }

    const token = signJwt({ id: user.id, email: user.email, name: user.name });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        budget: Number(user.budget) || 0,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Failed to create account. Please try again." });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const result = await pool.query(
      "SELECT id, name, email, password_hash, budget FROM public.users WHERE email = $1",
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "No account found with this email. Please create one." });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    const token = signJwt({ id: user.id, email: user.email, name: user.name });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        budget: Number(user.budget) || 0,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login." });
  }
});

// Check current user session
app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const userRes = await pool.query(
      "SELECT id, name, email, budget FROM public.users WHERE id = $1",
      [req.user.id]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = userRes.rows[0];
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        budget: Number(user.budget) || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// ─── Data Endpoints (Strictly Per-User Sync) ─────────────

// Fetch User's Centralized Transactions & Budget
app.get("/api/data", authMiddleware, async (req, res) => {
  if (!req.user) {
    // If not logged in, return empty (frontend uses local cache)
    return res.json({ transactions: [], budget: 0, guest: true });
  }

  try {
    const txnResult = await pool.query(
      `SELECT id, user_id, created_by, description, amount::float, type, category, date, created_at
       FROM public.transactions
       WHERE user_id = $1
       ORDER BY date DESC, created_at DESC`,
      [req.user.id]
    );

    const userResult = await pool.query(
      "SELECT budget FROM public.users WHERE id = $1",
      [req.user.id]
    );

    const budget =
      userResult.rows.length > 0 && userResult.rows[0].budget != null
        ? Number(userResult.rows[0].budget)
        : 0;

    res.json({
      transactions: txnResult.rows,
      budget,
      guest: false,
    });
  } catch (err) {
    console.error("Error fetching user data:", err);
    res.status(500).json({ error: "Failed to load transactions" });
  }
});

// Add Transaction (Linked to Authenticated User)
app.post("/api/transactions", requireAuth, async (req, res) => {
  const { id, description, amount, type, category, date } = req.body;

  if (!description || !amount || !type || !category || !date) {
    return res.status(400).json({ error: "All transaction fields are required." });
  }

  const txnId = id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const userId = req.user.id;
  const createdBy = req.user.name || req.user.email;

  try {
    const result = await pool.query(
      `INSERT INTO public.transactions (id, user_id, created_by, description, amount, type, category, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id, created_by, description, amount::float, type, category, date, created_at`,
      [txnId, userId, createdBy, description, amount, type, category, date]
    );

    broadcastUserSync(userId);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error adding transaction:", err);
    res.status(500).json({ error: "Failed to save transaction." });
  }
});

// Delete Transaction (Only User's Own Transaction)
app.delete("/api/transactions/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      "DELETE FROM public.transactions WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );
    broadcastUserSync(req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting transaction:", err);
    res.status(500).json({ error: "Failed to delete transaction." });
  }
});

// Clear All Transactions for Current User
app.delete("/api/transactions", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM public.transactions WHERE user_id = $1", [
      req.user.id,
    ]);
    broadcastUserSync(req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error("Error clearing transactions:", err);
    res.status(500).json({ error: "Failed to clear transactions." });
  }
});

// Update User's Monthly Budget
app.post("/api/budget", requireAuth, async (req, res) => {
  const { budget } = req.body;
  if (budget == null || isNaN(budget) || budget < 0) {
    return res.status(400).json({ error: "Invalid budget value." });
  }

  try {
    await pool.query(
      "UPDATE public.users SET budget = $1 WHERE id = $2",
      [budget, req.user.id]
    );

    broadcastUserSync(req.user.id);
    res.json({ success: true, budget });
  } catch (err) {
    console.error("Error updating budget:", err);
    res.status(500).json({ error: "Failed to update budget." });
  }
});

// Fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
