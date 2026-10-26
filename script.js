// ─── Centralized PostgreSQL Client ───────────────────────
const STATE_KEY = "studentExpenseTracker_cache";
const TOKEN_KEY = "studentExpenseTracker_token";

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
const phoneGuideBtn = document.getElementById("phoneGuideBtn");
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

// Phone Guide Modal DOM
const phoneModal = document.getElementById("phoneModal");
const closePhoneModal = document.getElementById("closePhoneModal");
const mobileUrlDisplay = document.getElementById("mobileUrlDisplay");
const copyPhoneUrlBtn = document.getElementById("copyPhoneUrlBtn");

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

// ─── Fetch Centralized PostgreSQL Data ───────────────────
async function fetchCentralizedData(silent = false) {
  if (!silent) updateSyncStatus("syncing", "Syncing with PostgreSQL...");

  try {
    const res = await fetch("/api/data");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    state = {
      transactions: Array.isArray(data.transactions) ? data.transactions : [],
      budget: typeof data.budget === "number" ? data.budget : 0,
    };
    saveLocalCache(state);
    renderAll();
    updateSyncStatus("synced", "🐘 Centralized PostgreSQL Synced");
  } catch (err) {
    console.warn("Could not reach PostgreSQL backend:", err);
    updateSyncStatus("error", "Database Disconnected (Using Local Cache)");
  }
}

// ─── Server-Sent Events (Live Cross-Device Sync) ─────────
function setupSSE() {
  if (typeof EventSource === "undefined") return;

  if (sseConnection) {
    sseConnection.close();
  }

  sseConnection = new EventSource("/api/events");

  sseConnection.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg && msg.event) {
        fetchCentralizedData(true);
      }
    } catch (err) {
      // heartbeat
    }
  };
}

// ─── Check Current Auth User ────────────────────────────
async function checkAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    renderLoggedOutChip();
    return;
  }

  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      renderUserChip(currentUser);
      if (footerStorageNote) {
        footerStorageNote.textContent = `Logged in as ${currentUser.name || currentUser.email} · Centralized PostgreSQL`;
      }
    } else {
      localStorage.removeItem(TOKEN_KEY);
      currentUser = null;
      renderLoggedOutChip();
    }
  } catch (err) {
    console.error("Auth check failed:", err);
    renderLoggedOutChip();
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
    renderLoggedOutChip();
    showToast("Logged out");
    if (footerStorageNote) {
      footerStorageNote.textContent = "Centralized PostgreSQL Storage";
    }
  });
}

function renderLoggedOutChip() {
  userChipArea.innerHTML = `
    <button id="openAuthBtn" class="btn btn-login btn-sm">🔑 Sign In</button>
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

// ─── Render Chart ───────────────────────────────────────
const BAR_COLORS = [
  "#6c5ce7", "#00b894", "#e17055", "#0984e3",
  "#fdcb6e", "#e84393", "#00cec9", "#d63031",
  "#a29bfe", "#55efc4", "#fab1a0", "#74b9ff",
  "#ffeaa7", "#fd79a8",
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

// ─── Render Transaction List (Centralized Logs) ─────────
function renderTransactions(animate = false) {
  const list = getFilteredTransactions();

  if (list.length === 0) {
    transactionList.innerHTML =
      '<li class="empty-msg">No transactions in centralized logs yet. Add one above!</li>';
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
            ${t.created_by ? `· <span class="txn-author">👤 ${escapeHtml(t.created_by)}</span>` : ""}
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
    created_by: currentUser ? (currentUser.name || currentUser.email) : "Shared User",
  });
  renderAll(true);

  form.reset();
  dateInput.value = new Date().toISOString().slice(0, 10);

  try {
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
      },
      body: JSON.stringify(txn),
    });

    if (!res.ok) throw new Error("Failed to save to PostgreSQL");
    showToast("Saved to Centralized PostgreSQL!");
  } catch (err) {
    console.error("Save error:", err);
    showToast("Error saving to database. Stored locally.");
  }
});

// ─── Delete Transaction ─────────────────────────────────
transactionList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-delete");
  if (!btn) return;

  const id = btn.dataset.id;
  state.transactions = state.transactions.filter((t) => t.id !== id);
  renderAll();

  try {
    await fetch(`/api/transactions/${id}`, {
      method: "DELETE",
      headers: getAuthHeader(),
    });
    showToast("Transaction deleted from centralized logs");
  } catch (err) {
    console.error("Delete error:", err);
  }
});

// ─── Clear All ──────────────────────────────────────────
clearAllBtn.addEventListener("click", async () => {
  if (!confirm("Are you sure you want to clear ALL centralized transactions?")) return;
  state.transactions = [];
  renderAll();

  try {
    await fetch("/api/transactions", {
      method: "DELETE",
      headers: getAuthHeader(),
    });
    showToast("Centralized logs cleared");
  } catch (err) {
    console.error("Clear error:", err);
  }
});

// ─── Budget ─────────────────────────────────────────────
setBudgetBtn.addEventListener("click", async () => {
  const val = parseFloat(budgetInput.value);
  if (isNaN(val) || val < 0) return;

  state.budget = val;
  budgetInput.value = "";
  renderSummary();
  renderBudget();

  try {
    await fetch("/api/budget", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
      },
      body: JSON.stringify({ budget: val }),
    });
    showToast(`Centralized budget updated to ${formatCurrency(val)}`);
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
    authModalSubtitle.textContent = "Sign in to log expenses with your account name";
    authSubmitBtn.textContent = "Sign In";
    passwordHint.style.display = "none";
  } else {
    tabSignUp.classList.add("active");
    tabSignIn.classList.remove("active");
    nameGroup.classList.remove("hidden");
    authModalTitle.textContent = "Create Account";
    authModalSubtitle.textContent = "Log centralized expenses with your name attached";
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
  showToast("Using Shared / Guest Mode");
});

togglePasswordBtn.addEventListener("click", () => {
  const isPw = authPassword.type === "password";
  authPassword.type = isPw ? "text" : "password";
  togglePasswordBtn.textContent = isPw ? "🙈" : "👁";
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = authEmail.value.trim();
  const password = authPassword.value;
  const name = authName.value.trim();

  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = "Please wait…";
  clearAuthAlert();

  const endpoint = authMode === "signup" ? "/api/auth/register" : "/api/auth/login";
  const payload = authMode === "signup" ? { email, password, name } : { email, password };

  try {
    const res = await fetch(endpoint, {
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
    showToast(authMode === "signup" ? "Account created!" : "Signed in!");
    fetchCentralizedData(true);
  } catch (err) {
    showAuthAlert(err.message, "error");
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = authMode === "signin" ? "Sign In" : "Create Account";
  }
});

// ─── Phone Guide Modal ──────────────────────────────────
function openPhoneModalFn() {
  const port = window.location.port ? `:${window.location.port}` : "";
  const host = window.location.hostname;
  const url = `http://${host}${port}`;
  mobileUrlDisplay.textContent = url;
  phoneModal.classList.remove("hidden");
}

function closePhoneModalFn() {
  phoneModal.classList.add("hidden");
}

phoneGuideBtn.addEventListener("click", openPhoneModalFn);
closePhoneModal.addEventListener("click", closePhoneModalFn);

copyPhoneUrlBtn.addEventListener("click", () => {
  const text = mobileUrlDisplay.textContent.trim();
  navigator.clipboard.writeText(text).then(() => {
    showToast("Link copied to clipboard!");
  }).catch(() => {
    showToast("Please copy the URL manually");
  });
});

[authModal, phoneModal].forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.classList.add("hidden");
    }
  });
});

// ─── Initial Startup ────────────────────────────────────
renderAll();
fetchCentralizedData();
setupSSE();
checkAuth();
