// ─── State ──────────────────────────────────────────────
const STATE_KEY = "studentExpenseTracker";

function loadState() {
  const raw = localStorage.getItem(STATE_KEY);
  return raw
    ? JSON.parse(raw)
    : { transactions: [], budget: 0 };
}

function saveState(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

let state = loadState();

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

// ─── Helpers ────────────────────────────────────────────
function formatCurrency(n) {
  return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Set today as default date
dateInput.value = new Date().toISOString().slice(0, 10);

// ─── Compute Totals ─────────────────────────────────────
function computeTotals() {
  let income = 0;
  let expense = 0;
  state.transactions.forEach((t) => {
    if (t.type === "income") income += t.amount;
    else expense += t.amount;
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
      return total + transaction.amount;
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
  // Aggregate expenses by category
  const catTotals = {};
  state.transactions.forEach((t) => {
    if (t.type === "expense") {
      catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
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
      list.sort((a, b) => b.amount - a.amount);
      break;
    case "lowest":
      list.sort((a, b) => a.amount - b.amount);
      break;
  }

  return list;
}

// ─── Render Transaction List ────────────────────────────
function renderTransactions(animate = false) {
  const list = getFilteredTransactions();

  if (list.length === 0) {
    transactionList.innerHTML =
      '<li class="empty-msg">No transactions match your filters.</li>';
    return;
  }

  transactionList.innerHTML = list
    .map(
      (t, i) => `
      <li class="${animate && i === 0 ? "animate-in" : ""}">
        <div class="txn-left">
          <span class="txn-desc">${escapeHtml(t.description)}</span>
          <span class="txn-meta">${t.category} · ${formatDate(t.date)}</span>
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
  div.textContent = str;
  return div.innerHTML;
}

// ─── Add Transaction ────────────────────────────────────
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const txn = {
    id: generateId(),
    description: descInput.value.trim(),
    amount: parseFloat(amountInput.value),
    type: typeSelect.value,
    category: categorySelect.value,
    date: dateInput.value,
  };

  state.transactions.unshift(txn);
  saveState(state);

  form.reset();
  dateInput.value = new Date().toISOString().slice(0, 10);

  renderAll(true);
});

// ─── Delete Transaction ─────────────────────────────────
transactionList.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-delete");
  if (!btn) return;

  const id = btn.dataset.id;
  state.transactions = state.transactions.filter((t) => t.id !== id);
  saveState(state);
  renderAll();
});

// ─── Clear All ──────────────────────────────────────────
clearAllBtn.addEventListener("click", () => {
  if (!confirm("Are you sure you want to delete ALL transactions?")) return;
  state.transactions = [];
  saveState(state);
  renderAll();
});

// ─── Budget ─────────────────────────────────────────────
setBudgetBtn.addEventListener("click", () => {
  const val = parseFloat(budgetInput.value);
  if (isNaN(val) || val < 0) return;
  state.budget = val;
  saveState(state);
  budgetInput.value = "";
  renderSummary();
  renderBudget();
});

// ─── Filters ────────────────────────────────────────────
searchInput.addEventListener("input", () => renderTransactions());
filterType.addEventListener("change", () => renderTransactions());
filterCategory.addEventListener("change", () => renderTransactions());
sortOrder.addEventListener("change", () => renderTransactions());

// ─── Render Everything ──────────────────────────────────
function renderAll(animateLatest = false) {
  renderSummary();
  renderBudget();
  renderChart();
  renderTransactions(animateLatest);
}

// ─── Initial Render ─────────────────────────────────────
renderAll();
