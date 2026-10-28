// ─── Interactive Light Grey Dot Grid Canvas Background ─────────
(function initDotGrid() {
  const canvas = document.getElementById("dotCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const SPACING = 30;           // Equal spacing between dots in X and Y
  const BASE_RADIUS = 1.75;     // Resting light grey dot radius
  const HOVER_MAX_RADIUS = 5.6; // Gets distinctly bigger when hovered
  const INTRO_MAX_RADIUS = 7.0; // Big prominent dots during opening animation
  const HOVER_DIST = 90;        // Hover interaction radius around cursor

  let width = 0;
  let height = 0;
  let dpr = 1;
  let dots = [];

  // Opening animation states
  let introActive = true;
  let introStartTime = null;
  const WAVE_SPREAD = 450;      // ms delay from center to furthest corner
  const PULSE_DURATION = 600;   // ms for each dot to grow big and return to small
  const INTRO_TOTAL = WAVE_SPREAD + PULSE_DURATION + 150; // Total intro duration (~1200ms)

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
    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.hypot(cx, cy) || 1;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = Math.round(startX + c * SPACING);
        const y = Math.round(startY + r * SPACING);
        const dist = Math.hypot(x - cx, y - cy);
        const normDist = dist / maxDist; // 0 at center, 1 at furthest corner

        dots.push({
          x,
          y,
          r: BASE_RADIUS,
          targetR: BASE_RADIUS,
          normDist,
        });
      }
    }
  }

  let animId = null;
  let isRunning = false;

  function loop(timestamp) {
    if (!introStartTime) introStartTime = timestamp;
    const introElapsed = timestamp - introStartTime;
    let needsUpdate = false;

    if (introActive) {
      needsUpdate = true;

      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];
        const dotStart = dot.normDist * WAVE_SPREAD;
        const dt = introElapsed - dotStart;

        if (dt >= 0 && dt <= PULSE_DURATION) {
          const u = dt / PULSE_DURATION; // 0 to 1
          // Smooth sine curve: starts at 0, peaks at 1, drops back to 0
          const pulse = Math.sin(u * Math.PI);
          dot.r = BASE_RADIUS + (INTRO_MAX_RADIUS - BASE_RADIUS) * Math.pow(pulse, 1.4);
        } else {
          dot.r = BASE_RADIUS;
        }
      }

      // When the wave finishes sweeping across the screen, trigger page content start
      if (introElapsed >= WAVE_SPREAD + PULSE_DURATION * 0.65) {
        document.body.classList.add("page-loaded");
      }

      // Complete opening animation and switch to hover mode
      if (introElapsed >= INTRO_TOTAL) {
        introActive = false;
        document.body.classList.add("page-loaded");
        setTimeout(() => {
          document.body.classList.add("intro-complete");
        }, 500);
      }
    } else {
      // Normal Interactive Hover Mode
      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];
        let targetR = BASE_RADIUS;

        if (mouse.active) {
          const dx = mouse.x - dot.x;
          const dy = mouse.y - dot.y;
          const dist = Math.hypot(dx, dy);

          if (dist < HOVER_DIST) {
            const power = 1 - dist / HOVER_DIST;
            targetR = BASE_RADIUS + (HOVER_MAX_RADIUS - BASE_RADIUS) * Math.pow(power, 1.8);
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
    }

    draw();

    if (needsUpdate || mouse.active || introActive) {
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

    const maxR = introActive ? INTRO_MAX_RADIUS : HOVER_MAX_RADIUS;

    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      const expansion = Math.max(0, Math.min(1, (dot.r - BASE_RADIUS) / (maxR - BASE_RADIUS)));

      // Light grey resting color: rgba(185, 190, 198, 0.45)
      // When expanding (wave or hover): gets darker and crisper: rgba(70, 75, 85, 0.9)
      const alpha = 0.45 + expansion * 0.45;
      const gray = Math.round(185 - expansion * 115);

      ctx.beginPath();
      ctx.arc(dot.x, dot.y, Math.max(0.5, dot.r), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${gray}, ${gray}, ${gray + 6}, ${alpha})`;
      ctx.fill();
    }
  }

  window.addEventListener("pointermove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
    if (!introActive) schedule();
  });

  window.addEventListener("pointerdown", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
    if (!introActive) schedule();
  });

  window.addEventListener("pointerleave", () => {
    mouse.active = false;
    if (!introActive) schedule();
  });

  // Re-trigger the dot wave anytime brand is clicked
  const brandEl = document.querySelector(".nav-brand");
  if (brandEl) {
    brandEl.style.cursor = "pointer";
    brandEl.addEventListener("click", (e) => {
      e.preventDefault();
      introActive = true;
      introStartTime = null;
      schedule();
    });
  }

  window.addEventListener("resize", resize);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      resize();
      schedule();
    });
  } else {
    resize();
    schedule();
  }

  // Safety fallback so UI always displays even in low-power or slow devices
  setTimeout(() => {
    document.body.classList.add("page-loaded", "intro-complete");
  }, 1600);
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

// Local Storage Status DOM
const storageBadge = document.getElementById("storageBadge");
const storageText = document.getElementById("storageText");

// Toast
const toastEl = document.getElementById("toast");

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
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

// ─── Local Device Storage Initialization ─────────────────
function initLocalStorage() {
  if (footerStorageNote) {
    footerStorageNote.textContent = "Storing locally on your device";
  }
  if (storageText) {
    storageText.textContent = "Storing locally on your device";
  }

  // Update Pending Dues badge on Borrow & Lend tab
  updatePendingDuesBadge();
}

function updatePendingDuesBadge() {
  const pendingDuesBadge = document.getElementById("pendingDuesBadge");
  if (!pendingDuesBadge) return;
  try {
    const duesRaw = localStorage.getItem("borrow_lend_v1");
    const dues = duesRaw ? JSON.parse(duesRaw) : [];
    const pendingCount = dues.filter((d) => !d.settled).length;
    if (pendingCount > 0) {
      pendingDuesBadge.textContent = pendingCount;
      pendingDuesBadge.style.display = "inline-flex";
    } else {
      pendingDuesBadge.style.display = "none";
    }
  } catch (e) {}
}

window.addEventListener("focus", updatePendingDuesBadge);
window.addEventListener("storage", (e) => {
  if (e.key === "borrow_lend_v1") {
    updatePendingDuesBadge();
  }
});

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
      '<tr><td colspan="6" class="empty-msg">No transactions yet. Add one above!</td></tr>';
    return;
  }

  transactionList.innerHTML = list
    .map(
      (t, i) => `
      <tr class="${animate && i === 0 ? "animate-in" : ""}">
        <td class="col-date">
          <span class="table-date">${formatDate(t.date)}</span>
        </td>
        <td class="col-desc">
          <div class="table-cell-desc">
            <span class="txn-desc">${escapeHtml(t.description)}</span>
            ${t.created_by ? `<span class="txn-author">by ${escapeHtml(t.created_by)}</span>` : ""}
          </div>
        </td>
        <td class="col-category">
          <span class="category-pill">${escapeHtml(t.category)}</span>
        </td>
        <td class="col-type">
          <span class="type-pill ${t.type}">
            ${t.type === "income" ? "Income" : "Expense"}
          </span>
        </td>
        <td class="col-amount text-right">
          <span class="txn-amount ${t.type}">
            ${t.type === "income" ? "+" : "−"}${formatCurrency(t.amount)}
          </span>
        </td>
        <td class="col-actions text-right">
          <button class="btn btn-delete btn-row-action" data-id="${escapeHtml(t.id)}" title="Delete transaction" aria-label="Delete">✕</button>
        </td>
      </tr>`
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
  showToast("Transaction added (stored locally on your device)");
});

// ─── Delete Transaction ─────────────────────────────────
transactionList.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-delete");
  if (!btn) return;

  const id = btn.dataset.id;
  state.transactions = state.transactions.filter((t) => t.id !== id);
  saveLocalCache(state);
  renderAll();
  showToast("Transaction deleted (stored locally on your device)");
});

// ─── Clear All ──────────────────────────────────────────
clearAllBtn.addEventListener("click", () => {
  if (!confirm("Are you sure you want to clear ALL your transactions?")) return;
  state.transactions = [];
  saveLocalCache(state);
  renderAll();
  showToast("Transactions cleared (stored locally on your device)");
});

// ─── Budget ─────────────────────────────────────────────
setBudgetBtn.addEventListener("click", () => {
  const val = parseFloat(budgetInput.value);
  if (isNaN(val) || val < 0) return;

  state.budget = val;
  saveLocalCache(state);
  budgetInput.value = "";
  renderSummary();
  renderBudget();
  showToast(`Monthly budget set to ${formatCurrency(val)} (stored locally on your device)`);
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

// ─── Initial Startup ────────────────────────────────────
renderAll();
initLocalStorage();

// ─── AI Financial Assistant Controller ──────────────────
(function setupAiChat() {
  const aiLauncherBtn = document.getElementById("aiLauncherBtn");
  const aiChatPanel = document.getElementById("aiChatPanel");
  const aiClearBtn = document.getElementById("aiClearBtn");
  const aiCloseBtn = document.getElementById("aiCloseBtn");
  const aiSuggestions = document.getElementById("aiSuggestions");
  const aiMessages = document.getElementById("aiMessages");
  const aiChatForm = document.getElementById("aiChatForm");
  const aiChatInput = document.getElementById("aiChatInput");
  const aiSendBtn = document.getElementById("aiSendBtn");

  if (!aiLauncherBtn || !aiChatPanel || !aiChatForm) return;

  function scrollToBottom() {
    if (aiMessages) {
      aiMessages.scrollTop = aiMessages.scrollHeight;
    }
  }

  aiLauncherBtn.addEventListener("click", () => {
    const isHidden = aiChatPanel.classList.toggle("hidden");
    if (!isHidden) {
      aiChatInput.focus();
      scrollToBottom();
    }
  });

  window.openAiChatWithPrompt = function(promptText) {
    aiChatPanel.classList.remove("hidden");
    if (promptText) {
      aiChatInput.value = promptText;
      handleUserSubmit(promptText);
    } else {
      aiChatInput.focus();
    }
    scrollToBottom();
  };

  aiCloseBtn.addEventListener("click", () => {
    aiChatPanel.classList.add("hidden");
  });

  aiClearBtn.addEventListener("click", () => {
    aiMessages.innerHTML = `
      <div class="ai-msg ai-msg-bot">
        <div class="ai-msg-bubble">
          <p>Chat cleared! How can I help you check your money, log transactions, manage your budget, or save today?</p>
        </div>
        <span class="ai-msg-time">Just now</span>
      </div>
    `;
  });

  if (aiSuggestions) {
    aiSuggestions.addEventListener("click", (e) => {
      const chip = e.target.closest(".ai-chip");
      if (!chip) return;
      const prompt = chip.dataset.prompt;
      if (prompt) {
        aiChatInput.value = prompt;
        handleUserSubmit(prompt);
      }
    });
  }

  aiChatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = aiChatInput.value.trim();
    if (!text) return;
    handleUserSubmit(text);
  });

  function formatAiReply(raw) {
    if (!raw) return "";
    let s = escapeHtml(raw);
    // Bold
    s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    // Italics
    s = s.replace(/\*(.*?)\*/g, "<em>$1</em>");
    // Bullet lines
    s = s.replace(/^•\s+(.*)$/gm, "<li>$1</li>");
    s = s.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");
    // Clean duplicate <ul> wraps
    s = s.replace(/<\/ul>\s*<ul>/g, "");
    // Line breaks
    s = s.replace(/\n\n/g, "<p></p>").replace(/\n/g, "<br>");
    return s;
  }

  function appendUserMessage(text) {
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const msgDiv = document.createElement("div");
    msgDiv.className = "ai-msg ai-msg-user";
    msgDiv.innerHTML = `
      <div class="ai-msg-bubble">${escapeHtml(text)}</div>
      <span class="ai-msg-time">${timeStr}</span>
    `;
    aiMessages.appendChild(msgDiv);
    scrollToBottom();
  }

  function appendBotMessage(replyHtml, actionCard = null) {
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const msgDiv = document.createElement("div");
    msgDiv.className = "ai-msg ai-msg-bot";

    let cardHtml = "";
    if (actionCard && actionCard.type === "add_transaction") {
      const p = actionCard.payload;
      cardHtml = `
        <div class="ai-action-card">
          <div class="ai-action-header">
            <span>${p.type === "income" ? "💰" : "💳"} ${escapeHtml(p.description)}</span>
          </div>
          <div class="ai-action-meta">
            Amount: <strong>${formatCurrency(p.amount)}</strong> &middot; ${escapeHtml(p.category)} &middot; ${p.date}
          </div>
        </div>
      `;
    } else if (actionCard && actionCard.type === "set_budget") {
      cardHtml = `
        <div class="ai-action-card">
          <div class="ai-action-header">
            <span>🎯 Monthly Budget Set</span>
          </div>
          <div class="ai-action-meta">
            Target: <strong>${formatCurrency(actionCard.payload.budget)}</strong>
          </div>
        </div>
      `;
    }

    msgDiv.innerHTML = `
      <div class="ai-msg-bubble">
        ${replyHtml}
        ${cardHtml}
      </div>
      <span class="ai-msg-time">${timeStr}</span>
    `;
    aiMessages.appendChild(msgDiv);
    scrollToBottom();
  }

  let typingEl = null;
  function showTyping() {
    if (typingEl) return;
    typingEl = document.createElement("div");
    typingEl.className = "ai-typing";
    typingEl.innerHTML = `
      <span class="ai-typing-dot"></span>
      <span class="ai-typing-dot"></span>
      <span class="ai-typing-dot"></span>
    `;
    aiMessages.appendChild(typingEl);
    scrollToBottom();
  }

  function hideTyping() {
    if (typingEl && typingEl.parentNode) {
      typingEl.parentNode.removeChild(typingEl);
    }
    typingEl = null;
  }

  async function handleUserSubmit(userText) {
    appendUserMessage(userText);
    aiChatInput.value = "";
    aiSendBtn.disabled = true;
    showTyping();

    const token = localStorage.getItem(TOKEN_KEY);
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: userText,
          transactions: state.transactions,
          budget: state.budget,
        }),
      });

      hideTyping();

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const data = await res.json();
      const replyFormatted = formatAiReply(data.reply);

      // Execute action on client if present
      if (data.action) {
        if (data.action.type === "add_transaction") {
          const newTxn = data.action.payload;
          const exists = state.transactions.some((t) => t.id === newTxn.id);
          if (!exists) {
            state.transactions.unshift(newTxn);
            saveLocalCache(state);
            renderAll(true);
            showToast(`Added: ${formatCurrency(newTxn.amount)} for ${newTxn.description}`);
          }
        } else if (data.action.type === "set_budget") {
          const newBudget = data.action.payload.budget;
          state.budget = newBudget;
          saveLocalCache(state);
          renderSummary();
          renderBudget();
          showToast(`Budget set to ${formatCurrency(newBudget)}`);
        }
      }

      appendBotMessage(replyFormatted, data.action);
    } catch (err) {
      hideTyping();
      console.warn("AI chat API offline, running client fallback:", err);
      // Run intelligent client fallback
      const fallback = runClientAiFallback(userText);
      const replyFormatted = formatAiReply(fallback.reply);

      if (fallback.action) {
        if (fallback.action.type === "add_transaction") {
          const newTxn = fallback.action.payload;
          state.transactions.unshift(newTxn);
          saveLocalCache(state);
          renderAll(true);
          showToast(`Added: ${formatCurrency(newTxn.amount)} for ${newTxn.description}`);

          // Also attempt to sync to backend if token exists
          if (token) {
            fetch(`${API_BASE}/api/transactions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify(newTxn),
            }).catch(() => {});
          }
        } else if (fallback.action.type === "set_budget") {
          const newBudget = fallback.action.payload.budget;
          state.budget = newBudget;
          saveLocalCache(state);
          renderSummary();
          renderBudget();
          showToast(`Budget set to ${formatCurrency(newBudget)}`);

          if (token) {
            fetch(`${API_BASE}/api/budget`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ budget: newBudget }),
            }).catch(() => {});
          }
        }
      }

      appendBotMessage(replyFormatted, fallback.action);
    } finally {
      aiSendBtn.disabled = false;
      aiChatInput.focus();
    }
  }

  // ─── Client-side NLP Fallback Engine (Zero-Latency / Offline) ───
  function runClientAiFallback(message) {
    const msg = message.toLowerCase().trim();
    let totalIncome = 0;
    let totalExpense = 0;
    const catExpenses = {};
    const catIncome = {};
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let monthlyExpenses = 0;

    for (const t of state.transactions) {
      const amt = parseFloat(t.amount) || 0;
      const tDate = new Date(t.date + "T00:00:00");
      const isThisMonth = !isNaN(tDate.getTime()) && tDate.getMonth() === currentMonth && tDate.getFullYear() === currentYear;

      if (t.type === "income") {
        totalIncome += amt;
        catIncome[t.category] = (catIncome[t.category] || 0) + amt;
      } else {
        totalExpense += amt;
        catExpenses[t.category] = (catExpenses[t.category] || 0) + amt;
        if (isThisMonth) monthlyExpenses += amt;
      }
    }

    let topCat = null;
    let topAmt = 0;
    for (const [c, a] of Object.entries(catExpenses)) {
      if (a > topAmt) {
        topAmt = a;
        topCat = c;
      }
    }

    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysLeft = Math.max(1, daysInMonth - now.getDate());

    // 1. Add Transaction
    if (/\b(add|spent|spend|bought|paid|received|earned|got|expense|income)\b/i.test(msg) && /\d+/.test(msg) && !msg.includes("budget")) {
      const amtMatch = msg.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k)?/i);
      let amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, "")) : 0;
      if (amtMatch && (amtMatch[2] || /k\b/i.test(amtMatch[0])) && amount < 1000) amount *= 1000;

      if (amount > 0) {
        const isIncome = /\b(income|allowance|salary|scholarship|freelance|gift|earned|received|got)\b/i.test(msg);
        const type = isIncome ? "income" : "expense";

        let category = "Other";
        if (/food|pizza|burger|coffee|tea|lunch|dinner|snack|canteen|swiggy|zomato/i.test(msg)) category = "Food";
        else if (/transport|uber|ola|metro|bus|train|cab|petrol|fuel/i.test(msg)) category = "Transport";
        else if (/book|books|supplies|stationery|study|course|exam/i.test(msg)) category = "Books";
        else if (/entertainment|movie|game|gaming|netflix|party/i.test(msg)) category = "Entertainment";
        else if (/rent|hostel|pg|room/i.test(msg)) category = "Rent";
        else if (/utility|bill|wifi|electricity|recharge/i.test(msg)) category = "Utilities";
        else if (/shopping|clothes|shoes|amazon|flipkart/i.test(msg)) category = "Shopping";
        else if (/health|medicine|doctor|gym/i.test(msg)) category = "Health";
        else if (/allowance|parents|pocket/i.test(msg)) category = "Allowance";
        else if (/freelance|client|gig/i.test(msg)) category = "Freelance";
        else if (/job|salary|wage/i.test(msg)) category = "Part-time";

        let desc = message
          .replace(/(?:₹|rs\.?|inr)?\s*\d+(?:,\d+)*(?:\.\d+)?\s*(k)?/gi, "")
          .replace(/\b(add|spent|spend|bought|paid|received|earned|got|for|on|in|to|today|as|my|an|a|the|expense|income)\b/gi, "")
          .trim();
        if (!desc || desc.length < 2) desc = category;
        else desc = desc.charAt(0).toUpperCase() + desc.slice(1);

        const newTxn = {
          id: generateId(),
          description: desc,
          amount,
          type,
          category,
          date: new Date().toISOString().slice(0, 10),
          created_by: currentUser ? (currentUser.name || currentUser.email) : "You",
        };

        return {
          reply: `✅ **Transaction Added!**\n\n• **${desc}**: ${formatCurrency(amount)}\n• **Type**: ${type === "income" ? "Income 💰" : "Expense 💳"}\n• **Category**: ${category}`,
          action: { type: "add_transaction", payload: newTxn },
        };
      }
    }

    // 2. Set Budget
    if (/\b(set|update|change|make)\s*(?:my\s*)?budget\s*(?:to|as)?\s*(?:₹|rs\.?)?\s*(\d+)/i.test(msg)) {
      const bMatch = msg.match(/(?:budget\s*(?:to|as)?\s*(?:₹|rs\.?)?)\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k)?/i);
      if (bMatch) {
        let bVal = parseFloat(bMatch[1].replace(/,/g, ""));
        if (bMatch[2] || /k\b/i.test(msg)) { if (bVal < 1000) bVal *= 1000; }
        return {
          reply: `🎯 **Monthly Budget Updated!**\n\nYour monthly budget is now set to **${formatCurrency(bVal)}**.\n• Spent so far: ${formatCurrency(monthlyExpenses)}\n• Remaining: **${formatCurrency(bVal - monthlyExpenses)}**`,
          action: { type: "set_budget", payload: { budget: bVal } },
        };
      }
    }

    // 3. How much did I add
    if (msg.includes("add") || msg.includes("income") || msg.includes("earn")) {
      return {
        reply: `💰 **Total Money Added:**\n\nYou have added a total of **${formatCurrency(totalIncome)}** across your income deposits.\n• Total expenses: ${formatCurrency(totalExpense)}\n• Net balance: **${formatCurrency(totalIncome - totalExpense)}**`,
      };
    }

    // 4. How much did I spend
    if (msg.includes("spend") || msg.includes("spent") || msg.includes("expense")) {
      return {
        reply: `📊 **Spending Summary:**\n\n• Total Expenses: **${formatCurrency(totalExpense)}**\n• This Month: **${formatCurrency(monthlyExpenses)}**\n• Remaining Budget: **${formatCurrency(state.budget - monthlyExpenses)}**`,
      };
    }

    // 5. Help me save
    if (msg.includes("save")) {
      const remaining = state.budget - monthlyExpenses;
      const dailyCap = Math.max(0, remaining / daysLeft);
      return {
        reply: `💡 **Personalized Financial Savings Plan:**\n\n` +
               `1. **Daily Spending Cap:** You have **${formatCurrency(remaining)}** left for ${daysLeft} days. Stick to **${formatCurrency(dailyCap)}/day**.\n` +
               `2. **Top Spending Leak:** Your biggest category is **${topCat || "Expenses"}** (${formatCurrency(topAmt)}). Cook more often or split shared bills to cut costs.\n` +
               `3. **The 50/30/20 Rule:** 50% for Needs, 30% for Wants, 20% to Savings.\n` +
               `4. **48-Hour Rule:** Wait two days before any purchase above ₹500.`,
      };
    }

    // 6. Prodtools Inquiry
    if (msg.includes("prodtools") || msg.includes("company") || msg.includes("dhairya") || msg.includes("who made")) {
      return {
        reply: `✦ **About Prodtools:**\n\n` +
               `**Prodtools** is the native company behind this **Expense Tracker**, building clean, minimalist productivity and finance software with real-time cloud sync.`,
      };
    }

    return {
      reply: `I can help you manage your student finances and save money! Try asking:\n\n• *"How much money did I add?"*\n• *"Add ₹250 for Pizza"*\n• *"Set my budget to ₹15,000"*\n• *"Give me tips to save money"*`,
    };
  }
})();

// ─── Smooth Scrolling for In-Page Anchors ────────────────
(function setupSmoothScrolling() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      const targetId = this.getAttribute("href");
      if (targetId && targetId !== "#") {
        const targetEl = document.querySelector(targetId);
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: "smooth" });
        }
      }
    });
  });
})();
