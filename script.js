// ─── Interactive Light Grey Dot Grid Canvas Background ─────────
(function initDotGrid() {
  const canvas = document.getElementById("dotCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const SPACING = 30;       // Equal spacing between dots in X and Y
  const BASE_RADIUS = 1.75; // Small light grey dot when resting
  const MAX_RADIUS = 5.6;   // Gets distinctly bigger when hovered
  const HOVER_DIST = 90;    // Hover interaction radius around cursor

  let width = 0;
  let height = 0;
  let dpr = 1;
  let dots = [];

  const mouse = {
    x: -9999,
    y: -9999,
    active: false,
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    createDots();
    draw();
  }

  function createDots() {
    dots = [];
    const cols = Math.ceil(width / SPACING) + 1;
    const rows = Math.ceil(height / SPACING) + 1;
    const startX = (width - (cols - 1) * SPACING) / 2;
    const startY = (height - (rows - 1) * SPACING) / 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        dots.push({
          x: Math.round(startX + c * SPACING),
          y: Math.round(startY + r * SPACING),
          r: BASE_RADIUS,
          targetR: BASE_RADIUS,
        });
      }
    }
  }

  let animId = null;
  let isRunning = false;

  function loop() {
    let needsUpdate = false;

    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      let targetR = BASE_RADIUS;

      if (mouse.active) {
        const dx = mouse.x - dot.x;
        const dy = mouse.y - dot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < HOVER_DIST) {
          const power = 1 - dist / HOVER_DIST;
          targetR = BASE_RADIUS + (MAX_RADIUS - BASE_RADIUS) * Math.pow(power, 1.8);
        }
      }

      dot.targetR = targetR;

      const diff = dot.targetR - dot.r;
      if (Math.abs(diff) > 0.02) {
        dot.r += diff * 0.22;
        needsUpdate = true;
      } else {
        dot.r = dot.targetR;
      }
    }

    draw();

    if (needsUpdate || mouse.active) {
      animId = requestAnimationFrame(loop);
    } else {
      isRunning = false;
    }
  }

  function schedule() {
    if (!isRunning) {
      isRunning = true;
      animId = requestAnimationFrame(loop);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      const expansion = (dot.r - BASE_RADIUS) / (MAX_RADIUS - BASE_RADIUS);

      // Light grey resting color: rgba(185, 190, 198, 0.45)
      // When hovered: gets darker and crisper grey: rgba(80, 85, 95, 0.85)
      const alpha = 0.45 + expansion * 0.4;
      const gray = Math.round(185 - expansion * 105);

      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${gray}, ${gray}, ${gray + 6}, ${alpha})`;
      ctx.fill();
    }
  }

  window.addEventListener("pointermove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
    schedule();
  });

  window.addEventListener("pointerdown", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
    schedule();
  });

  window.addEventListener("pointerleave", () => {
    mouse.active = false;
    schedule();
  });

  window.addEventListener("resize", resize);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", resize);
  } else {
    resize();
  }
})();

// ─── Centralized PostgreSQL Client ───────────────────────
const STATE_KEY = "studentExpenseTracker_cache";
const TOKEN_KEY = "studentExpenseTracker_token";

// Automatically target port 3000 if opened via file:// or Live Server (port 5500)
const API_BASE =
  window.location.protocol === "file:" || (window.location.port && window.location.port !== "3000")
    ? "http://localhost:3000"
    : "";

let state = loadLocalCache();
let currentUser = null;
let sseConnection = null;

function loadLocalCache() {
  const raw = localStorage.getItem(STATE_KEY);
  return raw ? JSON.parse(raw) : { transactions: [], budget: 0 };
}

function saveLocalCache(data) {
  localStorage.setItem(STATE_KEY, JSON.stringify(data));
}

function getAuthHeader() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── DOM References ─────────────────────────────────────
const form = document.getElementById("transactionForm");
const descInput = document.getElementById("description");
const amountInput = document.getElementById("amount");
const typeSelect = document.getElementById("type");
const categorySelect = document.getElementById("category");
const dateInput = document.getElementById("date");

const totalIncomeEl = document.getElementById("totalIncome");
const totalExpenseEl = document.getElementById("totalExpense");
const balanceEl = document.getElementById("balance");

const budgetInput = document.getElementById("budgetInput");
const setBudgetBtn = document.getElementById("setBudgetBtn");
const budgetBarFill = document.getElementById("budgetBarFill");
const budgetText = document.getElementById("budgetText");

const transactionList = document.getElementById("transactionList");
const clearAllBtn = document.getElementById("clearAllBtn");

const searchInput = document.getElementById("searchInput");
const filterType = document.getElementById("filterType");
const filterCategory = document.getElementById("filterCategory");
const sortOrder = document.getElementById("sortOrder");

const chartContainer = document.getElementById("chartContainer");
const footerStorageNote = document.getElementById("footerStorageNote");

// Cloud & Auth DOM
const syncBadge = document.getElementById("syncBadge");
const syncText = document.getElementById("syncText");
const userChipArea = document.getElementById("userChipArea");

// Auth Modal DOM
const authModal = document.getElementById("authModal");
const closeAuthModal = document.getElementById("closeAuthModal");
const authModalTitle = document.getElementById("authModalTitle");
const authModalSubtitle = document.getElementById("authModalSubtitle");
const tabSignIn = document.getElementById("tabSignIn");
const tabSignUp = document.getElementById("tabSignUp");
const authForm = document.getElementById("authForm");
const nameGroup = document.getElementById("nameGroup");
const authName = document.getElementById("authName");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const togglePasswordBtn = document.getElementById("togglePasswordBtn");
const passwordHint = document.getElementById("passwordHint");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const guestModeBtn = document.getElementById("guestModeBtn");
const authAlert = document.getElementById("authAlert");

// Toast
const toastEl = document.getElementById("toast");
let authMode = "signin";

// ─── Helpers ────────────────────────────────────────────
function formatCurrency(n) {
  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

let toastTimer = null;
function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 3000);
}

if (dateInput) {
  dateInput.value = new Date().toISOString().slice(0, 10);
}

// ─── Sync Status ────────────────────────────────────────
function updateSyncStatus(status, text) {
  if (!syncBadge || !syncText) return;
  syncBadge.className = `sync-badge ${status}`;
  syncText.textContent = text || status;
}

// ─── Fetch Authenticated User's Data ────────────────────
async function fetchUserData(silent = false) {
  const token = localStorage.getItem(TOKEN_KEY);

  if (!token) {
    updateSyncStatus("guest", "Guest Mode (Local Only - Sign In to Sync)");
    if (footerStorageNote) {
      footerStorageNote.textContent = "Data saved locally in browser";
    }
    renderAll();
    return;
  }

  if (!silent) updateSyncStatus("syncing", "Syncing with PostgreSQL...");

  try {
    const res = await fetch(`${API_BASE}/api/data`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      // Token expired
      localStorage.removeItem(TOKEN_KEY);
      currentUser = null;
      renderLoggedOutChip();
      updateSyncStatus("guest", "Session expired. Please Sign In.");
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    state = {
      transactions: Array.isArray(data.transactions) ? data.transactions : [],
      budget: typeof data.budget === "number" ? data.budget : 0,
    };

    saveLocalCache(state);
    renderAll();
    updateSyncStatus("synced", `🟢 PostgreSQL Synced (${currentUser ? currentUser.email : "Account"})`);
  } catch (err) {
    console.warn("Could not reach PostgreSQL backend:", err);
    updateSyncStatus("error", "Offline / Server Disconnected");
  }
}

// ─── Server-Sent Events (Live Cross-Device Sync) ─────────
function setupSSE() {
  if (typeof EventSource === "undefined") return;

  if (sseConnection) {
    sseConnection.close();
  }

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;

  // Connect SSE
  try {
    sseConnection = new EventSource(`${API_BASE}/api/events`);
    sseConnection.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg && msg.event === "sync") {
          fetchUserData(true);
        }
      } catch (err) {
        // heartbeat or comment
      }
    };
  } catch (e) {
    console.warn("SSE init error", e);
  }
}

// ─── Check Auth Session on Startup ──────────────────────
async function checkAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    renderLoggedOutChip();
    updateSyncStatus("guest", "Guest Mode (Click Sign In)");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      renderUserChip(currentUser);
      if (footerStorageNote) {
        footerStorageNote.textContent = `Synced with account: ${currentUser.email} (PostgreSQL)`;
      }
      setupSSE();
      fetchUserData();
    } else {
      localStorage.removeItem(TOKEN_KEY);
      currentUser = null;
      renderLoggedOutChip();
    }
  } catch (err) {
    console.error("Auth check failed:", err);
    renderLoggedOutChip();
    updateSyncStatus("error", "Backend server not reached (npm start)");
  }
}

function renderUserChip(user) {
  const displayName = user.name || user.email.split("@")[0] || "User";
  const initial = displayName.charAt(0).toUpperCase();

  userChipArea.innerHTML = `
    <div class="user-chip" title="${escapeHtml(user.email)}">
      <div class="user-avatar">${initial}</div>
      <span class="user-name">${escapeHtml(displayName)}</span>
      <button id="logoutBtn" class="btn-logout" title="Sign out">Log out</button>
    </div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    currentUser = null;
    if (sseConnection) {
      sseConnection.close();
      sseConnection = null;
    }
    renderLoggedOutChip();
    showToast("Signed out");
    state = { transactions: [], budget: 0 };
    saveLocalCache(state);
    renderAll();
    updateSyncStatus("guest", "Guest Mode");
    if (footerStorageNote) {
      footerStorageNote.textContent = "Data saved locally";
    }
  });
}

function renderLoggedOutChip() {
  userChipArea.innerHTML = `
    <button id="openAuthBtn" class="btn btn-login btn-sm">Sign In</button>
  `;
  document.getElementById("openAuthBtn").addEventListener("click", openAuthModalFn);
}

// ─── Compute Totals ─────────────────────────────────────
function computeTotals() {
  let income = 0;
  let expense = 0;
  state.transactions.forEach((t) => {
    if (t.type === "income") income += Number(t.amount);
    else expense += Number(t.amount);
  });
  return { income, expense };
}

function computeMonthlyExpenses() {
  const now = new Date();
  return state.transactions.reduce((total, transaction) => {
    const date = new Date(transaction.date + "T00:00:00");
    if (
      transaction.type === "expense" &&
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth()
    ) {
      return total + Number(transaction.amount);
    }
    return total;
  }, 0);
}

// ─── Render Summary ─────────────────────────────────────
function renderSummary() {
  const { income, expense } = computeTotals();
  totalIncomeEl.textContent = formatCurrency(income);
  totalExpenseEl.textContent = formatCurrency(expense);
  const remainingBudget =
    state.budget > 0 ? state.budget - computeMonthlyExpenses() : 0;
  balanceEl.textContent = formatCurrency(remainingBudget);
  balanceEl.classList.toggle("over", remainingBudget < 0);
}

// ─── Render Budget Bar ──────────────────────────────────
function renderBudget() {
  const expense = computeMonthlyExpenses();
  const budget = state.budget;

  if (budget <= 0) {
    budgetBarFill.style.width = "0%";
    budgetText.textContent = "No budget set";
    budgetBarFill.classList.remove("over");
    return;
  }

  const pct = Math.min((expense / budget) * 100, 100);
  budgetBarFill.style.width = pct + "%";
  budgetText.textContent = `${formatCurrency(expense)} / ${formatCurrency(budget)} (${Math.round(pct)}%)`;

  if (expense > budget) {
    budgetBarFill.classList.add("over");
  } else {
    budgetBarFill.classList.remove("over");
  }
}

// ─── Render Chart (Tesla Minimalist Tech Palette) ──────
const BAR_COLORS = [
  "#3e6ae1", "#171a20", "#12bb7b", "#e82127",
  "#5c5e62", "#0091ff", "#faad14", "#722ed1",
  "#13c2c2", "#2f54eb", "#8c8c8c", "#10239e",
];

function renderChart() {
  const catTotals = {};
  state.transactions.forEach((t) => {
    if (t.type === "expense") {
      catTotals[t.category] = (catTotals[t.category] || 0) + Number(t.amount);
    }
  });

  const entries = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    chartContainer.innerHTML = '<p class="empty-msg">Add some expenses to see the breakdown.</p>';
    return;
  }

  const maxVal = entries[0][1];

  chartContainer.innerHTML = entries
    .map(([cat, amt], i) => {
      const pct = (amt / maxVal) * 100;
      const color = BAR_COLORS[i % BAR_COLORS.length];
      return `
        <div class="chart-row">
          <span class="chart-label">${cat}</span>
          <div class="chart-bar-wrapper">
            <div class="chart-bar" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="chart-amount">${formatCurrency(amt)}</span>
        </div>`;
    })
    .join("");
}

// ─── Filter & Sort ──────────────────────────────────────
function getFilteredTransactions() {
  let list = [...state.transactions];
  const search = searchInput.value.toLowerCase().trim();
  const type = filterType.value;
  const category = filterCategory.value;
  const sort = sortOrder.value;

  if (search) {
    list = list.filter((t) => t.description.toLowerCase().includes(search));
  }
  if (type !== "all") {
    list = list.filter((t) => t.type === type);
  }
  if (category !== "all") {
    list = list.filter((t) => t.category === category);
  }

  switch (sort) {
    case "oldest":
      list.sort((a, b) => new Date(a.date) - new Date(b.date));
      break;
    case "newest":
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      break;
    case "highest":
      list.sort((a, b) => Number(b.amount) - Number(a.amount));
      break;
    case "lowest":
      list.sort((a, b) => Number(a.amount) - Number(b.amount));
      break;
  }

  return list;
}

// ─── Render Transaction List ────────────────────────────
function renderTransactions(animate = false) {
  const list = getFilteredTransactions();

  if (list.length === 0) {
    transactionList.innerHTML =
      '<li class="empty-msg">No transactions yet. Add one above!</li>';
    return;
  }

  transactionList.innerHTML = list
    .map(
      (t, i) => `
      <li class="${animate && i === 0 ? "animate-in" : ""}">
        <div class="txn-left">
          <span class="txn-desc">${escapeHtml(t.description)}</span>
          <span class="txn-meta">
            ${escapeHtml(t.category)} · ${formatDate(t.date)}
            ${t.created_by ? `· <span class="txn-author">${escapeHtml(t.created_by)}</span>` : ""}
          </span>
        </div>
        <div class="txn-right">
          <span class="txn-amount ${t.type}">
            ${t.type === "income" ? "+" : "−"}${formatCurrency(t.amount)}
          </span>
          <button class="btn btn-delete" data-id="${t.id}" title="Delete">✕</button>
        </div>
      </li>`
    )
    .join("");
}

// ─── Add Transaction ────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const txn = {
    id: generateId(),
    description: descInput.value.trim(),
    amount: parseFloat(amountInput.value),
    type: typeSelect.value,
    category: categorySelect.value,
    date: dateInput.value,
  };

  state.transactions.unshift({
    ...txn,
    created_by: currentUser ? (currentUser.name || currentUser.email) : "You",
  });
  saveLocalCache(state);
  renderAll(true);

  form.reset();
  dateInput.value = new Date().toISOString().slice(0, 10);

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showToast("Added locally (Sign in to sync with your phone)");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(txn),
    });

    if (!res.ok) throw new Error("Failed to save to PostgreSQL");
    showToast("Synced to your PostgreSQL account!");
  } catch (err) {
    console.error("Save error:", err);
    showToast("Saved locally. Will sync when server is reachable.");
  }
});

// ─── Delete Transaction ─────────────────────────────────
transactionList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-delete");
  if (!btn) return;

  const id = btn.dataset.id;
  state.transactions = state.transactions.filter((t) => t.id !== id);
  saveLocalCache(state);
  renderAll();

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showToast("Transaction deleted");
    return;
  }

  try {
    await fetch(`${API_BASE}/api/transactions/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    showToast("Transaction deleted from your account");
  } catch (err) {
    console.error("Delete error:", err);
  }
});

// ─── Clear All ──────────────────────────────────────────
clearAllBtn.addEventListener("click", async () => {
  if (!confirm("Are you sure you want to clear ALL your transactions?")) return;
  state.transactions = [];
  saveLocalCache(state);
  renderAll();

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showToast("Transactions cleared");
    return;
  }

  try {
    await fetch(`${API_BASE}/api/transactions`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    showToast("All transactions cleared from your account");
  } catch (err) {
    console.error("Clear error:", err);
  }
});

// ─── Budget ─────────────────────────────────────────────
setBudgetBtn.addEventListener("click", async () => {
  const val = parseFloat(budgetInput.value);
  if (isNaN(val) || val < 0) return;

  state.budget = val;
  saveLocalCache(state);
  budgetInput.value = "";
  renderSummary();
  renderBudget();

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showToast(`Monthly budget set to ${formatCurrency(val)} (Local)`);
    return;
  }

  try {
    await fetch(`${API_BASE}/api/budget`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ budget: val }),
    });
    showToast(`Monthly budget synced: ${formatCurrency(val)}`);
  } catch (err) {
    console.error("Budget save error:", err);
  }
});

// ─── Filters ────────────────────────────────────────────
searchInput.addEventListener("input", () => renderTransactions());
filterType.addEventListener("change", () => renderTransactions());
filterCategory.addEventListener("change", () => renderTransactions());
sortOrder.addEventListener("change", () => renderTransactions());

// ─── Render All ─────────────────────────────────────────
function renderAll(animateLatest = false) {
  renderSummary();
  renderBudget();
  renderChart();
  renderTransactions(animateLatest);
}

// ─── Auth Modal Logic ───────────────────────────────────
function openAuthModalFn() {
  setAuthMode("signin");
  clearAuthAlert();
  authModal.classList.remove("hidden");
  authEmail.focus();
}

function closeAuthModalFn() {
  authModal.classList.add("hidden");
  authForm.reset();
  clearAuthAlert();
}

function setAuthMode(mode) {
  authMode = mode;
  clearAuthAlert();
  if (mode === "signin") {
    tabSignIn.classList.add("active");
    tabSignUp.classList.remove("active");
    nameGroup.classList.add("hidden");
    authModalTitle.textContent = "Welcome Back";
    authModalSubtitle.textContent = "Sign in to access and sync your expenses";
    authSubmitBtn.textContent = "Sign In";
    passwordHint.style.display = "none";
  } else {
    tabSignUp.classList.add("active");
    tabSignIn.classList.remove("active");
    nameGroup.classList.remove("hidden");
    authModalTitle.textContent = "Create Account";
    authModalSubtitle.textContent = "Create your account to sync between phone and laptop";
    authSubmitBtn.textContent = "Create Account";
    passwordHint.style.display = "block";
  }
}

function showAuthAlert(msg, type = "error") {
  authAlert.textContent = msg;
  authAlert.className = `auth-alert ${type}`;
  authAlert.classList.remove("hidden");
}

function clearAuthAlert() {
  authAlert.textContent = "";
  authAlert.classList.add("hidden");
}

tabSignIn.addEventListener("click", () => setAuthMode("signin"));
tabSignUp.addEventListener("click", () => setAuthMode("signup"));
closeAuthModal.addEventListener("click", closeAuthModalFn);

guestModeBtn.addEventListener("click", () => {
  closeAuthModalFn();
  showToast("Using Guest Mode (Data stored only on this browser)");
});

togglePasswordBtn.addEventListener("click", () => {
  const isPw = authPassword.type === "password";
  authPassword.type = isPw ? "text" : "password";
  togglePasswordBtn.textContent = isPw ? "Hide" : "Show";
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = authEmail.value.trim();
  const password = authPassword.value;
  const name = authName.value.trim();

  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = authMode === "signup" ? "Creating account…" : "Signing in…";
  clearAuthAlert();

  const endpoint = authMode === "signup" ? "/api/auth/register" : "/api/auth/login";
  const payload =
    authMode === "signup"
      ? {
          email,
          password,
          name,
          initialTransactions: state.transactions,
          initialBudget: state.budget,
        }
      : { email, password };

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Authentication failed");
    }

    localStorage.setItem(TOKEN_KEY, data.token);
    currentUser = data.user;
    renderUserChip(currentUser);
    closeAuthModalFn();
    showToast(authMode === "signup" ? "Account created and data synced!" : "Signed in successfully!");

    setupSSE();
    fetchUserData();
  } catch (err) {
    console.error("Auth error:", err);
    if (err.name === "TypeError" && err.message.includes("fetch")) {
      showAuthAlert("Cannot reach server. Make sure 'npm start' is running.", "error");
    } else {
      showAuthAlert(err.message, "error");
    }
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = authMode === "signin" ? "Sign In" : "Create Account";
  }
});

authModal.addEventListener("click", (e) => {
  if (e.target === authModal) {
    authModal.classList.add("hidden");
  }
});

// ─── Initial Startup ────────────────────────────────────
renderAll();
checkAuth();
