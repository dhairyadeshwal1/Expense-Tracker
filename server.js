const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "student_expense_tracker_secret_2026";
const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres.qmpfbgdcxuinrvpgnxju:expensetracker12312@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres";

// ─── Native JWT ──────────────────────────────────────────
function base64Url(str) {
  return Buffer.from(str).toString("base64url");
}

function signJwt(payload, expiresInDays = 60) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const expPayload = base64Url(
    JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + expiresInDays * 86400,
    })
  );
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${expPayload}`)
    .digest("base64url");
  return `${header}.${expPayload}.${signature}`;
}

function verifyJwt(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  if (signature !== expected) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch (e) {
    return null;
  }
}

// ─── Native Password Hashing ─────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith("scrypt:")) {
    const [, salt, key] = stored.split(":");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return hash === key;
  }
  return false;
}

// ─── PostgreSQL Database ─────────────────────────────────
const pool = new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Database idle client error:", err.message);
});

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
    console.log("PostgreSQL schema ready.");
  } catch (err) {
    console.error("Error setting up database tables:", err.message);
  }
}

// ─── Server-Sent Events (SSE) ───────────────────────────
const sseClients = new Map(); // userId -> Set of res objects

function broadcastSync(userId) {
  if (sseClients.has(userId)) {
    const payload = `data: ${JSON.stringify({ event: "sync", timestamp: Date.now() })}\n\n`;
    for (const client of sseClients.get(userId)) {
      client.write(payload);
    }
  }
}

// ─── Request Body Helper ─────────────────────────────────
function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(data));
}

function getUserFromReq(req) {
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) {
    return verifyJwt(authHeader.split(" ")[1]);
  }
  return null;
}

// ─── HTTP Server ─────────────────────────────────────────
const MIME_TYPES = {
  ".html": "text/html; charset=UTF-8",
  ".css": "text/css; charset=UTF-8",
  ".js": "application/javascript; charset=UTF-8",
  ".json": "application/json; charset=UTF-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ─── SSE Stream ───
  if (pathname === "/api/events" && req.method === "GET") {
    const user = getUserFromReq(req);
    const userId = user ? user.id : "guest";

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("data: connected\n\n");

    if (!sseClients.has(userId)) sseClients.set(userId, new Set());
    sseClients.get(userId).add(res);

    const hb = setInterval(() => res.write(": heartbeat\n\n"), 25000);
    req.on("close", () => {
      clearInterval(hb);
      if (sseClients.has(userId)) {
        sseClients.get(userId).delete(res);
        if (sseClients.get(userId).size === 0) sseClients.delete(userId);
      }
    });
    return;
  }

  // ─── API Routes ───
  if (pathname.startsWith("/api/")) {
    // Register
    if (pathname === "/api/auth/register" && req.method === "POST") {
      const { email, password, name, initialTransactions, initialBudget } = await parseBody(req);
      if (!email || !password || password.length < 4) {
        return sendJson(res, 400, { error: "Valid email and password (min 4 chars) required." });
      }

      const normalizedEmail = email.toLowerCase().trim();
      try {
        const existing = await pool.query("SELECT id FROM public.users WHERE email = $1", [
          normalizedEmail,
        ]);
        if (existing.rows.length > 0) {
          return sendJson(res, 409, { error: "Account with this email already exists. Please Sign In." });
        }

        const passwordHash = hashPassword(password);
        const displayName = name && name.trim() ? name.trim() : normalizedEmail.split("@")[0];
        const budgetVal = typeof initialBudget === "number" ? initialBudget : 0;

        const result = await pool.query(
          `INSERT INTO public.users (name, email, password_hash, budget)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, email, budget, created_at`,
          [displayName, normalizedEmail, passwordHash, budgetVal]
        );
        const user = result.rows[0];

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
        return sendJson(res, 201, {
          token,
          user: { id: user.id, email: user.email, name: user.name, budget: Number(user.budget) || 0 },
        });
      } catch (err) {
        console.error("Register error:", err);
        return sendJson(res, 500, { error: "Failed to create account." });
      }
    }

    // Login
    if (pathname === "/api/auth/login" && req.method === "POST") {
      const { email, password } = await parseBody(req);
      if (!email || !password) {
        return sendJson(res, 400, { error: "Email and password are required." });
      }

      const normalizedEmail = email.toLowerCase().trim();
      try {
        const result = await pool.query(
          "SELECT id, name, email, password_hash, budget FROM public.users WHERE email = $1",
          [normalizedEmail]
        );
        if (result.rows.length === 0) {
          return sendJson(res, 401, { error: "No account found with this email." });
        }
        const user = result.rows[0];
        if (!verifyPassword(password, user.password_hash)) {
          return sendJson(res, 401, { error: "Incorrect password." });
        }

        const token = signJwt({ id: user.id, email: user.email, name: user.name });
        return sendJson(res, 200, {
          token,
          user: { id: user.id, email: user.email, name: user.name, budget: Number(user.budget) || 0 },
        });
      } catch (err) {
        console.error("Login error:", err);
        return sendJson(res, 500, { error: "Server error during login." });
      }
    }

    // Auth Me
    if (pathname === "/api/auth/me" && req.method === "GET") {
      const user = getUserFromReq(req);
      if (!user) return sendJson(res, 401, { error: "Unauthorized" });

      try {
        const userRes = await pool.query("SELECT id, name, email, budget FROM public.users WHERE id = $1", [
          user.id,
        ]);
        if (userRes.rows.length === 0) return sendJson(res, 404, { error: "User not found" });
        const dbUser = userRes.rows[0];
        return sendJson(res, 200, {
          user: { id: dbUser.id, name: dbUser.name, email: dbUser.email, budget: Number(dbUser.budget) || 0 },
        });
      } catch (err) {
        return sendJson(res, 500, { error: "Failed to fetch user" });
      }
    }

    // Data (Per-User Centralized Transactions & Budget)
    if (pathname === "/api/data" && req.method === "GET") {
      const user = getUserFromReq(req);
      if (!user) {
        return sendJson(res, 200, { transactions: [], budget: 0, guest: true });
      }

      try {
        const txnResult = await pool.query(
          `SELECT id, user_id, created_by, description, amount::float, type, category, date, created_at
           FROM public.transactions
           WHERE user_id = $1
           ORDER BY date DESC, created_at DESC`,
          [user.id]
        );
        const userResult = await pool.query("SELECT budget FROM public.users WHERE id = $1", [user.id]);
        const budget = userResult.rows.length > 0 && userResult.rows[0].budget != null ? Number(userResult.rows[0].budget) : 0;
        return sendJson(res, 200, { transactions: txnResult.rows, budget, guest: false });
      } catch (err) {
        console.error("Data error:", err);
        return sendJson(res, 500, { error: "Failed to load transactions" });
      }
    }

    // Add Transaction
    if (pathname === "/api/transactions" && req.method === "POST") {
      const user = getUserFromReq(req);
      if (!user) return sendJson(res, 401, { error: "Please sign in to add transactions" });

      const { id, description, amount, type, category, date } = await parseBody(req);
      if (!description || !amount || !type || !category || !date) {
        return sendJson(res, 400, { error: "All fields are required" });
      }

      const txnId = id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      try {
        const result = await pool.query(
          `INSERT INTO public.transactions (id, user_id, created_by, description, amount, type, category, date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, user_id, created_by, description, amount::float, type, category, date, created_at`,
          [txnId, user.id, user.name || user.email, description, amount, type, category, date]
        );
        broadcastSync(user.id);
        return sendJson(res, 201, result.rows[0]);
      } catch (err) {
        console.error("Add transaction error:", err);
        return sendJson(res, 500, { error: "Failed to save transaction" });
      }
    }

    // Delete Single Transaction
    if (pathname.startsWith("/api/transactions/") && req.method === "DELETE") {
      const user = getUserFromReq(req);
      if (!user) return sendJson(res, 401, { error: "Unauthorized" });

      const txnId = pathname.replace("/api/transactions/", "");
      try {
        await pool.query("DELETE FROM public.transactions WHERE id = $1 AND user_id = $2", [txnId, user.id]);
        broadcastSync(user.id);
        return sendJson(res, 200, { success: true });
      } catch (err) {
        return sendJson(res, 500, { error: "Failed to delete" });
      }
    }

    // Clear All Transactions
    if (pathname === "/api/transactions" && req.method === "DELETE") {
      const user = getUserFromReq(req);
      if (!user) return sendJson(res, 401, { error: "Unauthorized" });

      try {
        await pool.query("DELETE FROM public.transactions WHERE user_id = $1", [user.id]);
        broadcastSync(user.id);
        return sendJson(res, 200, { success: true });
      } catch (err) {
        return sendJson(res, 500, { error: "Failed to clear" });
      }
    }

    // Update Budget
    if (pathname === "/api/budget" && req.method === "POST") {
      const user = getUserFromReq(req);
      if (!user) return sendJson(res, 401, { error: "Unauthorized" });

      const { budget } = await parseBody(req);
      if (budget == null || isNaN(budget) || budget < 0) {
        return sendJson(res, 400, { error: "Invalid budget value" });
      }

      try {
        await pool.query("UPDATE public.users SET budget = $1 WHERE id = $2", [budget, user.id]);
        broadcastSync(user.id);
        return sendJson(res, 200, { success: true, budget });
      } catch (err) {
        return sendJson(res, 500, { error: "Failed to update budget" });
      }
    }

    return sendJson(res, 404, { error: "Endpoint not found" });
  }

  // ─── Static File Serving ───
  let filePath = path.join(__dirname, pathname === "/" ? "index.html" : pathname);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // Fallback to index.html for client routing
      fs.readFile(path.join(__dirname, "index.html"), (err2, fallback) => {
        if (err2) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        } else {
          res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" });
          res.end(fallback);
        }
      });
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    }
  });
});

// ─── Start Immediately ───────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
  initDb();
});
