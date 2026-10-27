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

// ─── AI Financial Assistant Brain ────────────────────────
function formatInr(num) {
  return "₹" + Number(num || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

const CATEGORY_KEYWORDS = [
  { cat: "Food", rx: /\b(food|pizza|burger|coffee|tea|lunch|dinner|breakfast|snack|snacks|canteen|grocery|groceries|restaurant|swiggy|zomato|domino|starbucks|mcdonald|subway|maggi|chai|eat|eating|meal)\b/i },
  { cat: "Transport", rx: /\b(transport|uber|ola|metro|bus|train|auto|cab|taxi|flight|petrol|fuel|diesel|commute|ride|rapido|rickshaw)\b/i },
  { cat: "Books", rx: /\b(book|books|supplies|stationery|pen|notebook|study|tuition|course|udemy|coursera|exam|notes|textbook|guide|xerox|photocopy)\b/i },
  { cat: "Entertainment", rx: /\b(entertainment|movie|cinema|film|game|gaming|steam|netflix|spotify|party|concert|club|fun|outing|theatre|billiards)\b/i },
  { cat: "Rent", rx: /\b(rent|hostel|pg|room|flat|apartment|landlord|roommate)\b/i },
  { cat: "Utilities", rx: /\b(utility|utilities|bill|wifi|internet|broadband|electricity|water|recharge|mobile|phone\s*bill|dth)\b/i },
  { cat: "Shopping", rx: /\b(shopping|amazon|flipkart|myntra|clothes|shirt|pants|shoes|mall|dress|jacket|tshirt|jeans|hoodie)\b/i },
  { cat: "Health", rx: /\b(health|medicine|doctor|pharmacy|hospital|gym|fitness|clinic|tablet|medical|dentist|eye|checkup)\b/i },
  { cat: "Allowance", rx: /\b(allowance|pocket\s*money|parents|mom|dad|family|stipend)\b/i },
  { cat: "Freelance", rx: /\b(freelance|client|gig|upwork|fiverr|contract|bounty)\b/i },
  { cat: "Part-time", rx: /\b(part-time|job|salary|wage|shift|work|office|internship)\b/i },
  { cat: "Scholarship", rx: /\b(scholarship|grant|fellowship|award|prize)\b/i },
  { cat: "Gift", rx: /\b(gift|birthday|reward|present|cashback)\b/i },
];

function detectCategory(text, defaultType = "expense") {
  for (const { cat, rx } of CATEGORY_KEYWORDS) {
    if (rx.test(text)) return cat;
  }
  return defaultType === "income" ? "Allowance" : "Other";
}

async function handleAiChat(rawMessage, transactions = [], budget = 0, user = null) {
  const msg = rawMessage.toLowerCase().trim();

  // Compute live aggregates
  let totalIncome = 0;
  let totalExpense = 0;
  const catExpenses = {};
  const catIncome = {};
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let monthlyExpenses = 0;
  let monthlyIncome = 0;

  for (const t of transactions) {
    const amt = parseFloat(t.amount) || 0;
    const tDate = new Date(t.date + "T00:00:00");
    const isThisMonth = !isNaN(tDate.getTime()) && tDate.getMonth() === currentMonth && tDate.getFullYear() === currentYear;

    if (t.type === "income") {
      totalIncome += amt;
      catIncome[t.category] = (catIncome[t.category] || 0) + amt;
      if (isThisMonth) monthlyIncome += amt;
    } else {
      totalExpense += amt;
      catExpenses[t.category] = (catExpenses[t.category] || 0) + amt;
      if (isThisMonth) monthlyExpenses += amt;
    }
  }

  // Find biggest expense category
  let topExpenseCat = null;
  let topExpenseAmt = 0;
  for (const [cat, amt] of Object.entries(catExpenses)) {
    if (amt > topExpenseAmt) {
      topExpenseAmt = amt;
      topExpenseCat = cat;
    }
  }

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - now.getDate());

  // ─── 1. Intent: ADD TRANSACTION ───
  // Matches: "add ₹250 for pizza", "spent 120 on coffee", "bought shoes for 1500", "got 2000 allowance"
  const isAddCommand =
    /\b(add|spent|spend|bought|paid|received|earned|got|deposit|expense|income)\b/i.test(msg) &&
    /\d+/.test(msg);

  if (isAddCommand && !/\b(budget|set budget|update budget|budget to)\b/i.test(msg)) {
    // Extract amount
    const amtMatch = msg.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:₹|rs\.?|inr|k)?/i);
    let amount = 0;
    if (amtMatch) {
      let rawVal = amtMatch[1].replace(/,/g, "");
      amount = parseFloat(rawVal);
      if (/k\b/i.test(amtMatch[0]) && amount < 1000) amount *= 1000;
    }

    if (amount > 0) {
      const isIncome = /\b(income|allowance|salary|scholarship|freelance|gift|earned|received|got|deposit|credited)\b/i.test(msg);
      const type = isIncome ? "income" : "expense";
      const category = detectCategory(msg, type);

      // Extract description
      let cleanDesc = rawMessage
        .replace(/(?:₹|rs\.?|inr)\s*\d+(?:,\d+)*(?:\.\d+)?/gi, "")
        .replace(/\b\d+(?:,\d+)*(?:\.\d+)?\s*(?:k)?\b/gi, "")
        .replace(/\b(add|spent|spend|bought|paid|received|earned|got|as|for|on|in|to|today|yesterday|an|a|the|my|expense|income)\b/gi, "")
        .trim();

      if (!cleanDesc || cleanDesc.length < 2) {
        cleanDesc = category;
      } else {
        cleanDesc = cleanDesc.charAt(0).toUpperCase() + cleanDesc.slice(1);
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      const newTxn = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        description: cleanDesc,
        amount,
        type,
        category,
        date: todayStr,
        created_by: user ? (user.name || user.email) : "You",
      };

      const newExpenseTotal = type === "expense" ? totalExpense + amount : totalExpense;
      const remainingBudget = budget > 0 ? budget - (type === "expense" ? monthlyExpenses + amount : monthlyExpenses) : null;

      let reply = `✅ **Transaction Added!**\n\n`;
      reply += `• **${newTxn.description}**: ${formatInr(amount)}\n`;
      reply += `• **Type**: ${type === "income" ? "Income 💰" : "Expense 💳"}\n`;
      reply += `• **Category**: ${category}\n`;
      reply += `• **Date**: ${todayStr}\n\n`;

      if (remainingBudget !== null) {
        reply += `Remaining monthly budget: **${formatInr(remainingBudget)}**`;
      } else {
        reply += `Net balance: **${formatInr(totalIncome - newExpenseTotal)}**`;
      }

      return {
        reply,
        action: {
          type: "add_transaction",
          payload: newTxn,
        },
      };
    }
  }

  // ─── 2. Intent: SET / UPDATE BUDGET ───
  // Matches: "set budget to 15000", "update budget to 20k", "my budget is 12000"
  if (/\b(set|update|change|make)\s*(?:my\s*)?budget\s*(?:to|as)?\s*(?:₹|rs\.?)?\s*(\d+)/i.test(msg) ||
      /\bbudget\s*(?:to|is)\s*(?:₹|rs\.?)?\s*(\d+)/i.test(msg)) {
    const bMatch = msg.match(/(?:budget\s*(?:to|as|is)?\s*(?:₹|rs\.?)?)\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k)?/i) ||
                   msg.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s*(k)?\s*budget/i);

    if (bMatch) {
      let bVal = parseFloat(bMatch[1].replace(/,/g, ""));
      if (bMatch[2] || /k\b/i.test(msg)) {
        if (bVal < 1000) bVal *= 1000;
      }

      if (bVal >= 0) {
        const remaining = bVal - monthlyExpenses;
        const pctUsed = bVal > 0 ? Math.round((monthlyExpenses / bVal) * 100) : 0;

        let reply = `🎯 **Monthly Budget Updated!**\n\n`;
        reply += `Your new monthly budget is **${formatInr(bVal)}**.\n`;
        reply += `• Spent so far: **${formatInr(monthlyExpenses)}** (${pctUsed}%)\n`;
        reply += `• Remaining balance: **${formatInr(remaining)}**\n`;
        reply += `• Safe daily limit for rest of month (${daysLeft} days): **${formatInr(Math.max(0, remaining / daysLeft))}/day**`;

        return {
          reply,
          action: {
            type: "set_budget",
            payload: { budget: bVal },
          },
        };
      }
    }
  }

  // ─── 3. Intent: HOW MUCH MONEY DID I ADD / INCOME INQUIRY ───
  // Matches: "how much money did i add", "how much money added", "what did i add", "total income", "my income"
  if (
    /\b(how\s*much.*(add|added|earn|earned|income|deposit|deposited))\b/i.test(msg) ||
    /\b(total\s*income|what\s*did\s*i\s*(add|earn))\b/i.test(msg) ||
    (msg.includes("money") && msg.includes("add"))
  ) {
    if (totalIncome === 0) {
      return {
        reply: `You haven't added any income transactions yet.\n\nYou can add one right now by saying: **"Add ₹5,000 allowance"** or **"Add ₹2,500 freelance"**!`,
      };
    }

    let reply = `💰 **Total Money Added:**\n\n`;
    reply += `You have added a total of **${formatInr(totalIncome)}** in income across all transactions.\n\n`;

    const incomeCategories = Object.entries(catIncome);
    if (incomeCategories.length > 0) {
      reply += `**Breakdown by Category:**\n`;
      for (const [cat, amt] of incomeCategories) {
        const pct = Math.round((amt / totalIncome) * 100);
        reply += `• **${cat}**: ${formatInr(amt)} (${pct}%)\n`;
      }
      reply += `\n`;
    }

    reply += `• Total expenses so far: **${formatInr(totalExpense)}**\n`;
    reply += `• Net cash in hand: **${formatInr(totalIncome - totalExpense)}**\n\n`;
    reply += `💡 *Tip: Keep track of regular deposits like allowance and freelance to build an emergency fund!*`;

    return { reply };
  }

  // ─── 4. Intent: HOW MUCH DID I SPEND / EXPENSES INQUIRY ───
  if (
    /\b(how\s*much.*(spend|spent|expense|expenses|cost))\b/i.test(msg) ||
    /\b(total\s*expense|where\s*did\s*my\s*money\s*go|spending\s*summary)\b/i.test(msg)
  ) {
    // Check if asking about specific category
    for (const { cat, rx } of CATEGORY_KEYWORDS) {
      if (rx.test(msg)) {
        const amt = catExpenses[cat] || 0;
        return {
          reply: `📊 You have spent **${formatInr(amt)}** on **${cat}** so far.\n\n` +
                 (totalExpense > 0 ? `This represents **${Math.round((amt / totalExpense) * 100)}%** of your total expenses.` : ""),
        };
      }
    }

    if (totalExpense === 0) {
      return {
        reply: `You haven't recorded any expenses yet! You have a clean slate.\n\nTo record an expense, just type: **"Spent ₹150 on Lunch"** or **"Add ₹400 for Uber"**.`,
      };
    }

    let reply = `📊 **Spending Summary:**\n\n`;
    reply += `• Total Expenses: **${formatInr(totalExpense)}**\n`;
    reply += `• This Month's Expenses: **${formatInr(monthlyExpenses)}**\n`;

    if (budget > 0) {
      const remaining = budget - monthlyExpenses;
      const pct = Math.round((monthlyExpenses / budget) * 100);
      reply += `• Monthly Budget: **${formatInr(budget)}** (${pct}% used, **${formatInr(remaining)}** left)\n`;
    }

    if (topExpenseCat) {
      const topPct = Math.round((topExpenseAmt / totalExpense) * 100);
      reply += `\n🔥 **Biggest Expense Area:** ${topExpenseCat} (${formatInr(topExpenseAmt)}, ${topPct}% of all spend)\n`;
    }

    return { reply };
  }

  // ─── 5. Intent: BUDGET STATUS ───
  if (/\b(what.*budget|budget\s*status|how\s*much\s*budget|remaining\s*budget)\b/i.test(msg)) {
    if (budget <= 0) {
      return {
        reply: `You haven't set a monthly budget yet!\n\nSetting a budget helps you track safe spending. You can set it now by telling me: **"Set my budget to ₹15,000"**!`,
      };
    }

    const remaining = budget - monthlyExpenses;
    const pct = Math.round((monthlyExpenses / budget) * 100);

    let reply = `🎯 **Monthly Budget Status:**\n\n`;
    reply += `• Budget Target: **${formatInr(budget)}**\n`;
    reply += `• Spent this month: **${formatInr(monthlyExpenses)}** (${pct}%)\n`;
    reply += `• Remaining: **${formatInr(remaining)}**\n`;
    reply += `• Daily allowance for next ${daysLeft} days: **${formatInr(Math.max(0, remaining / daysLeft))}/day**\n\n`;

    if (remaining < 0) {
      reply += `⚠️ *Alert: You are ${formatInr(Math.abs(remaining))} over budget! Consider freezing non-essential expenses.*`;
    } else if (pct > 80) {
      reply += `⚠️ *Caution: You've used ${pct}% of your budget with ${daysLeft} days remaining.*`;
    } else {
      reply += `🟢 *On Track: Your spending pace is healthy!*`;
    }

    return { reply };
  }

  // ─── 6. Intent: HOW CAN I SAVE / ADVICE & COACHING ───
  if (
    /\b(how.*save|help.*save|tips.*save|save\s*more|reduce\s*expense|cut\s*expense|spending\s*advice|financial\s*advice)\b/i.test(msg) ||
    msg.includes("save")
  ) {
    let reply = `💡 **Personalized Financial Savings Plan:**\n\n`;

    // 1. Budget diagnostic
    if (budget > 0) {
      const remaining = budget - monthlyExpenses;
      const dailySafe = Math.max(0, remaining / daysLeft);
      reply += `1. **Daily Spending Cap:** You have **${formatInr(remaining)}** left for ${daysLeft} days. Stick to **${formatInr(dailySafe)}/day** to finish the month under budget.\n\n`;
    } else {
      reply += `1. **Set a Concrete Budget:** Tell me **"Set budget to ₹12,000"** to cap your monthly outflow.\n\n`;
    }

    // 2. Biggest leak intervention
    if (topExpenseCat) {
      reply += `2. **Tackle Your #1 Leak (${topExpenseCat}):**\n`;
      if (topExpenseCat === "Food") {
        reply += `   • You spent **${formatInr(topExpenseAmt)}** on Food. Cook or eat at the student mess 2 more days/week—saving up to ~₹1,500/month by avoiding food delivery fees and surges.\n\n`;
      } else if (topExpenseCat === "Transport") {
        reply += `   • Transport is taking **${formatInr(topExpenseAmt)}**. Use monthly student metro/bus passes or ride-share instead of solo auto/cabs.\n\n`;
      } else if (topExpenseCat === "Entertainment") {
        reply += `   • Entertainment is at **${formatInr(topExpenseAmt)}**. Share subscription accounts (Spotify, Netflix Family) with flatmates to cut costs in half.\n\n`;
      } else {
        reply += `   • ${topExpenseCat} is your largest expense (${formatInr(topExpenseAmt)}). Audit purchases in this category for any impulse buys.\n\n`;
      }
    }

    // 3. Golden Student Savings Rules
    reply += `3. **The 50/30/20 Rule:** Allocate 50% for Essentials (Rent, Food), 30% for Lifestyle, and automatically transfer **20%** to a separate high-yield student savings account.\n\n`;
    reply += `4. **The 48-Hour Pause:** Before buying non-essentials over ₹500, wait 48 hours. 70% of impulse buying urges disappear after two days!\n\n`;
    reply += `Need to record an expense or update your budget? Just type it here!`;

    return { reply };
  }

  // ─── 7. Greetings & General ───
  if (/^(hi|hello|hey|greetings|hola|yo)\b/i.test(msg)) {
    return {
      reply: `Hey there! 👋 I am your **AI Financial Assistant**.\n\nI can help you with:\n` +
             `• **"How much money did I add?"** — Income and deposit analysis\n` +
             `• **"Add ₹300 for Books"** — Instantly adds transactions\n` +
             `• **"Set my budget to ₹15,000"** — Sets your monthly target\n` +
             `• **"How can I save money?"** — Tailored student financial advice\n\n` +
             `What would you like to check today?`,
    };
  }

  // Default fallback guidance
  return {
    reply: `I can help you manage your student finances and save money! Try asking:\n\n` +
           `• 💰 *"How much money did I add?"*\n` +
           `• ➕ *"Add ₹250 for Pizza"* or *"Add ₹2,000 Allowance"*\n` +
           `• 🎯 *"Set my budget to ₹15,000"*\n` +
           `• 📊 *"How much have I spent so far?"*\n` +
           `• 💡 *"Give me tips to save money"*`,
  };
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

    // ─── AI Financial Assistant Chat Endpoint ───
    if (pathname === "/api/ai/chat" && req.method === "POST") {
      const user = getUserFromReq(req);
      const body = await parseBody(req);
      const message = (body.message || "").trim();

      if (!message) {
        return sendJson(res, 400, { error: "Message is required" });
      }

      // Fetch user's live data if authenticated, else use provided client state
      let txns = Array.isArray(body.transactions) ? body.transactions : [];
      let currentBudget = typeof body.budget === "number" ? body.budget : 0;

      if (user) {
        try {
          const tRes = await pool.query(
            "SELECT id, description, amount::float, type, category, date, created_by FROM public.transactions WHERE user_id = $1 ORDER BY date DESC, created_at DESC",
            [user.id]
          );
          txns = tRes.rows;
          const uRes = await pool.query("SELECT budget::float FROM public.users WHERE id = $1", [user.id]);
          if (uRes.rows.length && uRes.rows[0].budget != null) {
            currentBudget = parseFloat(uRes.rows[0].budget);
          }
        } catch (dbErr) {
          console.warn("AI db lookup fallback to payload:", dbErr.message);
        }
      }

      const response = await handleAiChat(message, txns, currentBudget, user);

      // If an action was executed on the server (like adding a transaction or updating budget)
      if (response.action && user) {
        if (response.action.type === "add_transaction") {
          try {
            const t = response.action.payload;
            const insertRes = await pool.query(
              `INSERT INTO public.transactions (id, user_id, created_by, description, amount, type, category, date)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id, user_id, created_by, description, amount::float, type, category, date, created_at`,
              [t.id, user.id, user.name || user.email, t.description, t.amount, t.type, t.category, t.date]
            );
            response.action.payload = insertRes.rows[0];
            broadcastSync(user.id);
          } catch (e) {
            console.error("AI auto-insert txn error:", e);
          }
        } else if (response.action.type === "set_budget") {
          try {
            const newBudget = response.action.payload.budget;
            await pool.query("UPDATE public.users SET budget = $1 WHERE id = $2", [newBudget, user.id]);
            broadcastSync(user.id);
          } catch (e) {
            console.error("AI auto-set budget error:", e);
          }
        }
      }

      return sendJson(res, 200, response);
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
