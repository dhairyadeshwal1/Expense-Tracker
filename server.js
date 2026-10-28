try { require("dotenv").config(); } catch (e) {}
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
  console.warn("⚠️ WARNING: DATABASE_URL is not set. Check your .env file.");
}

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn("⚠️ WARNING: JWT_SECRET not found in environment. Generating an ephemeral cryptographic secret.");
  return crypto.randomBytes(32).toString("hex");
})();

// ─── Security Headers & CORS ─────────────────────────────
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' http: https: ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function getCorsHeaders(req) {
  const origin = req && req.headers ? req.headers["origin"] || "*" : "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

// ─── Rate Limiter (In-Memory Sliding Window) ─────────────
const rateLimits = new Map();

function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  let record = rateLimits.get(key);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs };
    rateLimits.set(key, record);
    return { allowed: true, remaining: maxRequests - 1, resetIn: Math.ceil(windowMs / 1000) };
  }
  record.count++;
  if (record.count > maxRequests) {
    return { allowed: false, remaining: 0, resetIn: Math.ceil((record.resetTime - now) / 1000) };
  }
  return { allowed: true, remaining: maxRequests - record.count, resetIn: Math.ceil((record.resetTime - now) / 1000) };
}

// Purge expired rate-limit records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimits.entries()) {
    if (now > record.resetTime) rateLimits.delete(key);
  }
}, 5 * 60 * 1000).unref();

function getClientIp(req) {
  const forwarded = req && req.headers ? req.headers["x-forwarded-for"] : null;
  if (typeof forwarded === "string" && forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return (req && req.socket && req.socket.remoteAddress) ? req.socket.remoteAddress : "127.0.0.1";
}

// ─── Constant-Time Comparison (Timing Attack Protection) ──
function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

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
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  if (!timingSafeEqualStr(signature, expected)) return null;
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
  if (!stored || typeof stored !== "string") return false;
  if (stored.startsWith("scrypt:")) {
    const parts = stored.split(":");
    if (parts.length !== 3) return false;
    const [, salt, key] = parts;
    if (!salt || !key) return false;
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return timingSafeEqualStr(hash, key);
  }
  return false;
}

// ─── PostgreSQL Database ─────────────────────────────────
const pool = new Pool(
  DB_URL
    ? {
        connectionString: DB_URL,
        ssl: { rejectUnauthorized: false },
      }
    : {}
);

pool.on("error", (err) => {
  console.error("Database idle client error:", err.message);
});

async function initDb() {
  if (!DB_URL) return;
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
      try { client.write(payload); } catch (e) {}
    }
  }
}

// ─── Request Body Helper (Protected against DoS / Memory Bombs) ─
const MAX_BODY_SIZE = 256 * 1024; // 256 KB max payload

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let receivedBytes = 0;

    req.on("data", (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      body += chunk;
    });

    req.on("end", () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error("INVALID_JSON"));
      }
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=UTF-8",
    ...SECURITY_HEADERS,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    ...extraHeaders,
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

  // ─── 7. Intent: ABOUT PRODTOOLS / CREATOR INQUIRY ───
  if (
    /\b(prodtools|prodtool|native company|who made|who created|about prodtools|dhairya)\b/i.test(msg)
  ) {
    return {
      reply: `✦ **About Prodtools:**\n\n` +
             `**Prodtools** is the native company behind **Expense Tracker**, focused on building fast, clean, and minimalist student productivity and finance tools with real-time PostgreSQL cloud sync.`,
    };
  }

  // ─── 8. Greetings & General ───
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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const server = http.createServer(async (req, res) => {
  // Global CORS Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...SECURITY_HEADERS,
      ...getCorsHeaders(req),
    });
    return res.end();
  }

  let url;
  try {
    url = new URL(req.url, `http://localhost:${PORT}`);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    return res.end("Bad Request");
  }

  const pathname = url.pathname;
  const clientIp = getClientIp(req);

  // ─── SSE Stream ───
  if (pathname === "/api/events" && req.method === "GET") {
    const user = getUserFromReq(req);
    const userId = user ? user.id : "guest";

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...SECURITY_HEADERS,
      ...getCorsHeaders(req),
    });
    res.write("data: connected\n\n");

    if (!sseClients.has(userId)) sseClients.set(userId, new Set());
    sseClients.get(userId).add(res);

    const hb = setInterval(() => {
      try { res.write(": heartbeat\n\n"); } catch (e) {}
    }, 25000);

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
    // General API Rate Limit: 180 req / min per IP
    const apiLim = checkRateLimit(`api:${clientIp}`, 180, 60 * 1000);
    if (!apiLim.allowed) {
      return sendJson(res, 429, { error: "Too many API requests. Please slow down." }, { "Retry-After": String(apiLim.resetIn) });
    }

    // Helper to safely parse body
    const getSafeBody = async () => {
      try {
        return await parseBody(req);
      } catch (err) {
        if (err.message === "PAYLOAD_TOO_LARGE") {
          sendJson(res, 413, { error: "Payload too large. Max size is 256KB." });
        } else {
          sendJson(res, 400, { error: "Malformed JSON payload." });
        }
        return null;
      }
    };

    // ─── Register ───
    if (pathname === "/api/auth/register" && req.method === "POST") {
      const authLim = checkRateLimit(`auth:${clientIp}`, 10, 60 * 1000);
      if (!authLim.allowed) {
        return sendJson(res, 429, { error: "Too many registration attempts. Please wait 1 minute." }, { "Retry-After": String(authLim.resetIn) });
      }

      const body = await getSafeBody();
      if (!body) return;

      const { email, password, name, initialTransactions, initialBudget } = body;
      if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim()) || email.length > 255) {
        return sendJson(res, 400, { error: "A valid email address (max 255 characters) is required." });
      }
      if (!password || typeof password !== "string" || password.length < 6 || password.length > 128) {
        return sendJson(res, 400, { error: "Password must be between 6 and 128 characters." });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const sanitizedName = typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : normalizedEmail.split("@")[0].slice(0, 100);
      const budgetVal = typeof initialBudget === "number" && Number.isFinite(initialBudget) && initialBudget >= 0 && initialBudget <= 1000000000 ? initialBudget : 0;

      try {
        const existing = await pool.query("SELECT id FROM public.users WHERE email = $1", [normalizedEmail]);
        if (existing.rows.length > 0) {
          return sendJson(res, 409, { error: "An account with this email already exists. Please Sign In." });
        }

        const passwordHash = hashPassword(password);
        const result = await pool.query(
          `INSERT INTO public.users (name, email, password_hash, budget)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, email, budget, created_at`,
          [sanitizedName, normalizedEmail, passwordHash, budgetVal]
        );
        const user = result.rows[0];

        if (Array.isArray(initialTransactions) && initialTransactions.length > 0) {
          for (const t of initialTransactions.slice(0, 500)) {
            const numAmount = parseFloat(t.amount);
            if (
              t.description &&
              typeof t.description === "string" &&
              Number.isFinite(numAmount) &&
              numAmount > 0 &&
              (t.type === "income" || t.type === "expense") &&
              t.category &&
              t.date &&
              DATE_REGEX.test(String(t.date).slice(0, 10))
            ) {
              const txnId = typeof t.id === "string" && t.id.length <= 64 ? t.id : Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
              await pool.query(
                `INSERT INTO public.transactions (id, user_id, created_by, description, amount, type, category, date)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (id) DO NOTHING`,
                [
                  txnId,
                  user.id,
                  user.name,
                  String(t.description).trim().slice(0, 200),
                  numAmount,
                  t.type,
                  String(t.category).trim().slice(0, 64),
                  String(t.date).slice(0, 10),
                ]
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
        console.error("Register error:", err.message);
        return sendJson(res, 500, { error: "Failed to create account. Please try again." });
      }
    }

    // ─── Login ───
    if (pathname === "/api/auth/login" && req.method === "POST") {
      const authLim = checkRateLimit(`auth:${clientIp}`, 10, 60 * 1000);
      if (!authLim.allowed) {
        return sendJson(res, 429, { error: "Too many login attempts. Please wait 1 minute." }, { "Retry-After": String(authLim.resetIn) });
      }

      const body = await getSafeBody();
      if (!body) return;

      const { email, password } = body;
      if (!email || !password || typeof email !== "string" || typeof password !== "string" || email.length > 255 || password.length > 128) {
        return sendJson(res, 400, { error: "Email and password are required." });
      }

      const normalizedEmail = email.toLowerCase().trim();
      try {
        const result = await pool.query(
          "SELECT id, name, email, password_hash, budget FROM public.users WHERE email = $1",
          [normalizedEmail]
        );
        if (result.rows.length === 0) {
          return sendJson(res, 401, { error: "Invalid email or password." });
        }
        const user = result.rows[0];
        if (!verifyPassword(password, user.password_hash)) {
          return sendJson(res, 401, { error: "Invalid email or password." });
        }

        const token = signJwt({ id: user.id, email: user.email, name: user.name });
        return sendJson(res, 200, {
          token,
          user: { id: user.id, email: user.email, name: user.name, budget: Number(user.budget) || 0 },
        });
      } catch (err) {
        console.error("Login error:", err.message);
        return sendJson(res, 500, { error: "Server error during authentication." });
      }
    }

    // ─── Auth Me ───
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
        return sendJson(res, 500, { error: "Failed to fetch user data" });
      }
    }

    // ─── Data (Centralized Transactions & Budget) ───
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
        console.error("Data error:", err.message);
        return sendJson(res, 500, { error: "Failed to load transactions" });
      }
    }

    // ─── Add Transaction ───
    if (pathname === "/api/transactions" && req.method === "POST") {
      const user = getUserFromReq(req);
      if (!user) return sendJson(res, 401, { error: "Please sign in to add transactions" });

      const body = await getSafeBody();
      if (!body) return;

      const { id, description, amount, type, category, date } = body;
      const numAmount = parseFloat(amount);

      if (!description || typeof description !== "string" || !description.trim() || description.trim().length > 200) {
        return sendJson(res, 400, { error: "Description is required (max 200 characters)" });
      }
      if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > 1000000000) {
        return sendJson(res, 400, { error: "Valid positive amount is required" });
      }
      if (type !== "income" && type !== "expense") {
        return sendJson(res, 400, { error: "Type must be income or expense" });
      }
      if (!category || typeof category !== "string" || category.trim().length > 64) {
        return sendJson(res, 400, { error: "Category is required (max 64 characters)" });
      }
      if (!date || typeof date !== "string" || !DATE_REGEX.test(date.slice(0, 10))) {
        return sendJson(res, 400, { error: "Valid date format (YYYY-MM-DD) is required" });
      }

      const txnId = typeof id === "string" && id.length <= 64 ? id : Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
      try {
        const result = await pool.query(
          `INSERT INTO public.transactions (id, user_id, created_by, description, amount, type, category, date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, user_id, created_by, description, amount::float, type, category, date, created_at`,
          [txnId, user.id, (user.name || user.email).slice(0, 100), description.trim().slice(0, 200), numAmount, type, category.trim().slice(0, 64), date.slice(0, 10)]
        );
        broadcastSync(user.id);
        return sendJson(res, 201, result.rows[0]);
      } catch (err) {
        console.error("Add transaction error:", err.message);
        return sendJson(res, 500, { error: "Failed to save transaction" });
      }
    }

    // ─── Delete Single Transaction ───
    if (pathname.startsWith("/api/transactions/") && req.method === "DELETE") {
      const user = getUserFromReq(req);
      if (!user) return sendJson(res, 401, { error: "Unauthorized" });

      const txnId = pathname.replace("/api/transactions/", "").trim();
      if (!txnId || txnId.length > 64) {
        return sendJson(res, 400, { error: "Invalid transaction ID" });
      }

      try {
        await pool.query("DELETE FROM public.transactions WHERE id = $1 AND user_id = $2", [txnId, user.id]);
        broadcastSync(user.id);
        return sendJson(res, 200, { success: true });
      } catch (err) {
        return sendJson(res, 500, { error: "Failed to delete transaction" });
      }
    }

    // ─── Clear All Transactions ───
    if (pathname === "/api/transactions" && req.method === "DELETE") {
      const user = getUserFromReq(req);
      if (!user) return sendJson(res, 401, { error: "Unauthorized" });

      try {
        await pool.query("DELETE FROM public.transactions WHERE user_id = $1", [user.id]);
        broadcastSync(user.id);
        return sendJson(res, 200, { success: true });
      } catch (err) {
        return sendJson(res, 500, { error: "Failed to clear transactions" });
      }
    }

    // ─── Update Budget ───
    if (pathname === "/api/budget" && req.method === "POST") {
      const user = getUserFromReq(req);
      if (!user) return sendJson(res, 401, { error: "Unauthorized" });

      const body = await getSafeBody();
      if (!body) return;

      const numBudget = parseFloat(body.budget);
      if (!Number.isFinite(numBudget) || numBudget < 0 || numBudget > 1000000000) {
        return sendJson(res, 400, { error: "Valid non-negative budget value is required" });
      }

      try {
        await pool.query("UPDATE public.users SET budget = $1 WHERE id = $2", [numBudget, user.id]);
        broadcastSync(user.id);
        return sendJson(res, 200, { success: true, budget: numBudget });
      } catch (err) {
        return sendJson(res, 500, { error: "Failed to update budget" });
      }
    }

    // ─── AI Financial Assistant Chat Endpoint ───
    if (pathname === "/api/ai/chat" && req.method === "POST") {
      const aiLim = checkRateLimit(`ai:${clientIp}`, 30, 60 * 1000);
      if (!aiLim.allowed) {
        return sendJson(res, 429, { error: "AI rate limit reached. Please wait a moment." }, { "Retry-After": String(aiLim.resetIn) });
      }

      const user = getUserFromReq(req);
      const body = await getSafeBody();
      if (!body) return;

      const rawMsg = typeof body.message === "string" ? body.message.trim() : "";
      if (!rawMsg || rawMsg.length > 1500) {
        return sendJson(res, 400, { error: "A message under 1500 characters is required" });
      }

      let txns = Array.isArray(body.transactions) ? body.transactions : [];
      let currentBudget = typeof body.budget === "number" && Number.isFinite(body.budget) ? body.budget : 0;

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

      const response = await handleAiChat(rawMsg, txns, currentBudget, user);

      // Execute action on server if user is logged in
      if (response.action && user) {
        if (response.action.type === "add_transaction") {
          try {
            const t = response.action.payload;
            const insertRes = await pool.query(
              `INSERT INTO public.transactions (id, user_id, created_by, description, amount, type, category, date)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id, user_id, created_by, description, amount::float, type, category, date, created_at`,
              [t.id, user.id, (user.name || user.email).slice(0, 100), t.description.slice(0, 200), t.amount, t.type, t.category.slice(0, 64), t.date.slice(0, 10)]
            );
            response.action.payload = insertRes.rows[0];
            broadcastSync(user.id);
          } catch (e) {
            console.error("AI auto-insert txn error:", e.message);
          }
        } else if (response.action.type === "set_budget") {
          try {
            const newBudget = response.action.payload.budget;
            await pool.query("UPDATE public.users SET budget = $1 WHERE id = $2", [newBudget, user.id]);
            broadcastSync(user.id);
          } catch (e) {
            console.error("AI auto-set budget error:", e.message);
          }
        }
      }

      return sendJson(res, 200, response);
    }

    return sendJson(res, 404, { error: "Endpoint not found" });
  }

  // ─── Static File Serving with Path Traversal & Leakage Protection ───
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    return res.end("Method Not Allowed");
  }

  const safePathname = path.normalize(decodeURIComponent(pathname.replace(/\0/g, ""))).replace(/^(\.\.[\/\\])+/, "");
  const targetFile = safePathname === "/" || safePathname === "" ? "index.html" : safePathname.replace(/^\//, "");
  const resolvedPath = path.resolve(__dirname, targetFile);
  const rootDir = path.resolve(__dirname);
  const baseName = path.basename(resolvedPath).toLowerCase();
  const ext = path.extname(resolvedPath).toLowerCase();

  // 1. Strict root directory jail (prevent directory traversal out of project)
  if (!resolvedPath.startsWith(rootDir)) {
    res.writeHead(403, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    return res.end("Forbidden");
  }

  // 2. Block hidden files (.env, .git, .DS_Store, etc.)
  if (baseName.startsWith(".")) {
    res.writeHead(403, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    return res.end("Forbidden");
  }

  // 3. Block sensitive server files & logs from direct browser download
  const SENSITIVE_BLOCKED_FILES = new Set([
    "server.js",
    "package.json",
    "package-lock.json",
    "server.log",
    ".env",
    ".gitignore",
    "readme.md",
  ]);
  if (SENSITIVE_BLOCKED_FILES.has(baseName)) {
    res.writeHead(403, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    return res.end("Forbidden");
  }

  // 4. Block arbitrary scripts (only allow client bundle JS)
  const ALLOWED_JS_FILES = new Set(["script.js", "borrow-lend.js"]);
  if (ext === ".js" && !ALLOWED_JS_FILES.has(baseName)) {
    res.writeHead(403, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    return res.end("Forbidden");
  }

  // 5. Allowed MIME extensions
  const contentType = MIME_TYPES[ext];
  if (!contentType) {
    res.writeHead(404, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    return res.end("Not Found");
  }

  fs.readFile(resolvedPath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        const acceptHeader = req.headers["accept"] || "";
        if (acceptHeader.includes("text/html")) {
          fs.readFile(path.join(__dirname, "index.html"), (err2, fallback) => {
            if (err2) {
              res.writeHead(404, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
              return res.end("Not Found");
            }
            res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8", ...SECURITY_HEADERS });
            return res.end(fallback);
          });
          return;
        }
      }
      res.writeHead(404, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
      return res.end("Not Found");
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      ...SECURITY_HEADERS,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(content);
  });
});

// ─── Process Exception Handling (Crash Prevention) ───────
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err && err.message ? err.message : err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err && err.message ? err.message : err);
});

// ─── Start Server ────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening securely on port ${PORT}`);
  initDb();
});
