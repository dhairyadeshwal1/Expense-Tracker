// ═══════════════════════════════════════════════════════════
// BORROW & LEND CONTROLLER · LOCAL STORAGE ARCHITECTURE
// Tesla Minimalist Geometry · Prodtools Native Dues Engine
// ═══════════════════════════════════════════════════════════

const DUES_KEY = "borrow_lend_v1";

// ─── Interactive Light Grey Dot Grid Canvas Background ─────────
(function initDotGrid() {
  const canvas = document.getElementById("dotCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const SPACING = 30;
  const BASE_RADIUS = 1.75;
  const HOVER_MAX_RADIUS = 5.6;
  const INTRO_MAX_RADIUS = 7.0;
  const HOVER_DIST = 90;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let dots = [];

  let introActive = true;
  let introStartTime = null;
  const WAVE_SPREAD = 450;
  const PULSE_DURATION = 600;
  const INTRO_TOTAL = WAVE_SPREAD + PULSE_DURATION + 150;

  const mouse = { x: -9999, y: -9999, active: false };

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
        const normDist = dist / maxDist;

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
          const u = dt / PULSE_DURATION;
          const pulse = Math.sin(u * Math.PI);
          dot.r = BASE_RADIUS + (INTRO_MAX_RADIUS - BASE_RADIUS) * Math.pow(pulse, 1.4);
        } else {
          dot.r = BASE_RADIUS;
        }
      }

      if (introElapsed >= WAVE_SPREAD + PULSE_DURATION * 0.65) {
        document.body.classList.add("page-loaded");
      }

      if (introElapsed >= INTRO_TOTAL) {
        introActive = false;
        document.body.classList.add("page-loaded");
        setTimeout(() => {
          document.body.classList.add("intro-complete");
        }, 500);
      }
    } else {
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

    if (introActive || needsUpdate || mouse.active) {
      animId = requestAnimationFrame(loop);
      isRunning = true;
    } else {
      isRunning = false;
    }
  }

  function startLoop() {
    if (!isRunning) {
      isRunning = true;
      animId = requestAnimationFrame(loop);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#d2d2d4";

    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  window.addEventListener("resize", resize, { passive: true });

  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
    startLoop();
  }, { passive: true });

  document.addEventListener("mouseleave", () => {
    mouse.active = false;
    mouse.x = -9999;
    mouse.y = -9999;
    startLoop();
  });

  resize();
  startLoop();
})();

// ─── State & Storage Management ─────────────────────────
function loadDues() {
  try {
    const raw = localStorage.getItem(DUES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Failed to load dues:", e);
    return [];
  }
}

function saveDues(dues) {
  try {
    localStorage.setItem(DUES_KEY, JSON.stringify(dues));
  } catch (e) {
    console.error("Failed to save dues:", e);
  }
}

let duesState = loadDues();

// ─── Currency Formatter ─────────────────────────────────
function formatCurrency(num) {
  return "₹" + Number(num || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
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

function getInitials(name) {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(name) {
  const colors = [
    "#3e6ae1", "#12bb7b", "#8b5cf6", "#f59e0b",
    "#ec4899", "#06b6d4", "#10b981", "#6366f1"
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// ─── DOM Elements ───────────────────────────────────────
const duesForm = document.getElementById("duesForm");
const dueTypeInput = document.getElementById("dueType");
const btnTypeLent = document.getElementById("btnTypeLent");
const btnTypeBorrowed = document.getElementById("btnTypeBorrowed");
const personNameInput = document.getElementById("personName");
const dueAmountInput = document.getElementById("dueAmount");
const dueDescriptionInput = document.getElementById("dueDescription");
const dueDateGivenInput = document.getElementById("dueDateGiven");
const dueDatePromisedInput = document.getElementById("dueDatePromised");
const submitDueBtn = document.getElementById("submitDueBtn");
const contactsDatalist = document.getElementById("contactsDatalist");

const totalLentEl = document.getElementById("totalLentEl");
const totalBorrowedEl = document.getElementById("totalBorrowedEl");
const netDuesEl = document.getElementById("netDuesEl");
const lentCountEl = document.getElementById("lentCountEl");
const borrowedCountEl = document.getElementById("borrowedCountEl");
const netDuesStatusEl = document.getElementById("netDuesStatusEl");

const searchDuesInput = document.getElementById("searchDuesInput");
const filterDueType = document.getElementById("filterDueType");
const filterDueStatus = document.getElementById("filterDueStatus");
const sortDuesOrder = document.getElementById("sortDuesOrder");

const peopleSection = document.getElementById("peopleSection");
const peopleList = document.getElementById("peopleList");
const peopleCountBadge = document.getElementById("peopleCountBadge");

const duesList = document.getElementById("duesList");
const duesFilteredCount = document.getElementById("duesFilteredCount");
const clearAllDuesBtn = document.getElementById("clearAllDuesBtn");
const toastEl = document.getElementById("toast");
const pendingDuesBadge = document.getElementById("pendingDuesBadge");

// Set default date to today
if (dueDateGivenInput) {
  dueDateGivenInput.value = new Date().toISOString().slice(0, 10);
}

// ─── Toast System ───────────────────────────────────────
let toastTimer = null;
function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 2800);
}

// ─── Type Segmented Toggle (Lent vs Borrowed) ────────────
function setDueType(type) {
  if (type === "lent") {
    dueTypeInput.value = "lent";
    btnTypeLent.classList.add("active-lent");
    btnTypeBorrowed.classList.remove("active-borrowed");
    btnTypeLent.setAttribute("aria-checked", "true");
    btnTypeBorrowed.setAttribute("aria-checked", "false");
    submitDueBtn.textContent = "Record Lent Money (+₹)";
    submitDueBtn.style.background = "var(--tesla-black)";
  } else {
    dueTypeInput.value = "borrowed";
    btnTypeBorrowed.classList.add("active-borrowed");
    btnTypeLent.classList.remove("active-lent");
    btnTypeLent.setAttribute("aria-checked", "false");
    btnTypeBorrowed.setAttribute("aria-checked", "true");
    submitDueBtn.textContent = "Record Borrowed Money (-₹)";
    submitDueBtn.style.background = "#2b303a";
  }
}

if (btnTypeLent && btnTypeBorrowed) {
  btnTypeLent.addEventListener("click", () => setDueType("lent"));
  btnTypeBorrowed.addEventListener("click", () => setDueType("borrowed"));
}

// ─── Form Submission ────────────────────────────────────
duesForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const person = personNameInput.value.trim();
  const amount = parseFloat(dueAmountInput.value);
  const description = dueDescriptionInput.value.trim();
  const type = dueTypeInput.value;
  const dateGiven = dueDateGivenInput.value || new Date().toISOString().slice(0, 10);
  const datePromised = dueDatePromisedInput.value || "";

  if (!person || isNaN(amount) || amount <= 0 || !description) return;

  const newRecord = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    person,
    amount,
    description,
    type,
    dateGiven,
    datePromised,
    settled: false,
    settledAt: null,
    createdAt: new Date().toISOString(),
  };

  duesState.unshift(newRecord);
  saveDues(duesState);

  duesForm.reset();
  setDueType("lent");
  dueDateGivenInput.value = new Date().toISOString().slice(0, 10);

  renderAll();
  showToast(`Recorded ${formatCurrency(amount)} ${type === "lent" ? "lent to" : "borrowed from"} ${person}`);
});

// ─── Settle / Delete Action Listener ─────────────────────
duesList.addEventListener("click", (e) => {
  const settleBtn = e.target.closest(".btn-action-settle");
  if (settleBtn) {
    const id = settleBtn.dataset.id;
    const item = duesState.find((d) => d.id === id);
    if (!item) return;

    item.settled = !item.settled;
    item.settledAt = item.settled ? new Date().toISOString() : null;
    saveDues(duesState);
    renderAll();

    showToast(item.settled
      ? `Marked as settled with ${item.person} ✓`
      : `Reopened dues with ${item.person} ⏳`
    );
    return;
  }

  const remindBtn = e.target.closest(".btn-action-remind");
  if (remindBtn) {
    const id = remindBtn.dataset.id;
    const item = duesState.find((d) => d.id === id);
    if (!item) return;

    const reminderMsg =
      item.type === "lent"
        ? `Hey ${item.person}! Friendly reminder about the ${formatCurrency(item.amount)} for "${item.description}". Whenever you get a chance! Thanks! 😊`
        : `Hey ${item.person}! I have noted the ${formatCurrency(item.amount)} for "${item.description}". I'll settle it with you soon! 👍`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(reminderMsg);
      showToast(`📋 Polite reminder copied to clipboard!`);
    } else {
      const ta = document.createElement("textarea");
      ta.value = reminderMsg;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast(`📋 Polite reminder copied to clipboard!`);
    }

    // Also offer direct WhatsApp sharing if mobile/desktop supports it
    const encoded = encodeURIComponent(reminderMsg);
    window.open(`https://wa.me/?text=${encoded}`, "_blank");
    return;
  }

  const deleteBtn = e.target.closest(".btn-action-delete");
  if (deleteBtn) {
    const id = deleteBtn.dataset.id;
    const item = duesState.find((d) => d.id === id);
    if (!item) return;

    if (!confirm(`Delete this ${item.type} record with ${item.person}?`)) return;

    duesState = duesState.filter((d) => d.id !== id);
    saveDues(duesState);
    renderAll();
    showToast(`Dues record removed`);
  }
});

// ─── Clear All Dues ─────────────────────────────────────
clearAllDuesBtn.addEventListener("click", () => {
  if (!duesState.length) return;
  if (!confirm("Are you sure you want to clear ALL borrow & lend records?")) return;

  duesState = [];
  saveDues(duesState);
  renderAll();
  showToast("All dues records cleared (stored locally on your device)");
});

// ─── Filter & Search Listeners ──────────────────────────
searchDuesInput.addEventListener("input", renderDuesList);
filterDueType.addEventListener("change", renderDuesList);
filterDueStatus.addEventListener("change", renderDuesList);
sortDuesOrder.addEventListener("change", renderDuesList);

// ─── Compute Totals ─────────────────────────────────────
function computeTotals() {
  let lentPending = 0;
  let borrowedPending = 0;
  let lentCount = 0;
  let borrowedCount = 0;

  for (const d of duesState) {
    const amt = Number(d.amount) || 0;
    if (!d.settled) {
      if (d.type === "lent") {
        lentPending += amt;
        lentCount++;
      } else {
        borrowedPending += amt;
        borrowedCount++;
      }
    }
  }

  const net = lentPending - borrowedPending;
  return { lentPending, borrowedPending, net, lentCount, borrowedCount };
}

// ─── Render Summary Cards ───────────────────────────────
function renderSummary() {
  const totals = computeTotals();

  totalLentEl.textContent = formatCurrency(totals.lentPending);
  totalBorrowedEl.textContent = formatCurrency(totals.borrowedPending);

  lentCountEl.textContent = `${totals.lentCount} pending ${totals.lentCount === 1 ? "due" : "dues"}`;
  borrowedCountEl.textContent = `${totals.borrowedCount} pending ${totals.borrowedCount === 1 ? "due" : "dues"}`;

  const absNet = Math.abs(totals.net);
  if (totals.net > 0) {
    netDuesEl.textContent = `+${formatCurrency(absNet)}`;
    netDuesEl.style.color = "var(--tesla-green)";
    netDuesStatusEl.textContent = "You are in the green (Net receivable)";
  } else if (totals.net < 0) {
    netDuesEl.textContent = `-${formatCurrency(absNet)}`;
    netDuesEl.style.color = "var(--tesla-red)";
    netDuesStatusEl.textContent = "You owe more than you are owed (Net payable)";
  } else {
    netDuesEl.textContent = "₹0";
    netDuesEl.style.color = "var(--tesla-black)";
    netDuesStatusEl.textContent = "All settled up!";
  }

  // Update Pending Dues badge in header navigation
  const totalPending = totals.lentCount + totals.borrowedCount;
  if (pendingDuesBadge) {
    if (totalPending > 0) {
      pendingDuesBadge.textContent = totalPending;
      pendingDuesBadge.style.display = "inline-flex";
    } else {
      pendingDuesBadge.style.display = "none";
    }
  }
}

// ─── Render People Breakdown ────────────────────────────
function renderPeopleSummary() {
  if (!peopleSection || !peopleList) return;

  const peopleMap = new Map();

  for (const d of duesState) {
    const pName = d.person.trim();
    if (!pName) continue;
    const key = pName.toLowerCase();

    if (!peopleMap.has(key)) {
      peopleMap.set(key, {
        name: pName,
        lentPending: 0,
        borrowedPending: 0,
        pendingCount: 0,
        settledCount: 0,
      });
    }

    const entry = peopleMap.get(key);
    const amt = Number(d.amount) || 0;

    if (!d.settled) {
      entry.pendingCount++;
      if (d.type === "lent") entry.lentPending += amt;
      else entry.borrowedPending += amt;
    } else {
      entry.settledCount++;
    }
  }

  if (peopleMap.size === 0) {
    peopleSection.style.display = "none";
    return;
  }

  peopleSection.style.display = "block";
  peopleCountBadge.textContent = `${peopleMap.size} ${peopleMap.size === 1 ? "Contact" : "Contacts"}`;
  peopleList.innerHTML = "";

  // Update datalist for person name input autocomplete
  if (contactsDatalist) {
    contactsDatalist.innerHTML = "";
    for (const [, p] of peopleMap) {
      const opt = document.createElement("option");
      opt.value = p.name;
      contactsDatalist.appendChild(opt);
    }
  }

  peopleMap.forEach((p) => {
    const net = p.lentPending - p.borrowedPending;
    const chip = document.createElement("div");
    chip.className = "person-chip";

    let balanceText = "";
    let chipClass = "settled";

    if (net > 0) {
      chipClass = "receivable";
      balanceText = `Owes you ${formatCurrency(net)}`;
    } else if (net < 0) {
      chipClass = "payable";
      balanceText = `You owe ${formatCurrency(Math.abs(net))}`;
    } else {
      chipClass = "settled";
      balanceText = p.pendingCount > 0 ? "Balanced dues" : "All settled ✓";
    }

    chip.classList.add(chipClass);

    const avatarBg = getAvatarColor(p.name);
    chip.innerHTML = `
      <div class="person-chip-avatar" style="background: ${avatarBg}">${getInitials(p.name)}</div>
      <div class="person-chip-info">
        <span class="person-chip-name">${escapeHtml(p.name)}</span>
        <span class="person-chip-sub">${balanceText}</span>
      </div>
      <span class="person-chip-filter-hint" title="Filter by ${escapeHtml(p.name)}">🔎</span>
    `;

    chip.addEventListener("click", () => {
      searchDuesInput.value = p.name;
      renderDuesList();
      duesList.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    peopleList.appendChild(chip);
  });
}

// ─── Render Dues List ───────────────────────────────────
function renderDuesList() {
  const query = (searchDuesInput.value || "").trim().toLowerCase();
  const typeFilter = filterDueType.value;
  const statusFilter = filterDueStatus.value;
  const sort = sortDuesOrder.value;

  let filtered = duesState.filter((item) => {
    // Search
    if (query) {
      const p = item.person.toLowerCase();
      const d = (item.description || "").toLowerCase();
      if (!p.includes(query) && !d.includes(query)) return false;
    }
    // Type filter
    if (typeFilter !== "all" && item.type !== typeFilter) return false;
    // Status filter
    if (statusFilter === "pending" && item.settled) return false;
    if (statusFilter === "settled" && !item.settled) return false;
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    if (sort === "newest") {
      return (b.dateGiven || b.createdAt).localeCompare(a.dateGiven || a.createdAt);
    }
    if (sort === "oldest") {
      return (a.dateGiven || a.createdAt).localeCompare(b.dateGiven || b.createdAt);
    }
    if (sort === "amount-high") {
      return Number(b.amount) - Number(a.amount);
    }
    if (sort === "amount-low") {
      return Number(a.amount) - Number(b.amount);
    }
    if (sort === "due-date") {
      if (!a.datePromised && !b.datePromised) return 0;
      if (!a.datePromised) return 1;
      if (!b.datePromised) return -1;
      return a.datePromised.localeCompare(b.datePromised);
    }
    return 0;
  });

  duesFilteredCount.textContent = `${filtered.length} ${filtered.length === 1 ? "record" : "records"}`;

  if (filtered.length === 0) {
    duesList.innerHTML = `
      <tr>
        <td colspan="7" class="empty-msg">
          ${query || typeFilter !== "all" || statusFilter !== "all"
            ? "No matching dues records found."
            : "No dues records yet. Add your first borrow or lend record above!"}
        </td>
      </tr>
    `;
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayDate = new Date(todayStr);

  duesList.innerHTML = filtered.map((item) => {
    const isLent = item.type === "lent";
    const amtFormatted = (isLent ? "+" : "−") + formatCurrency(item.amount);
    const avatarBg = getAvatarColor(item.person);
    const initials = getInitials(item.person);

    // Compute deadline/overdue status
    let deadlineBadgeHtml = "";
    if (item.datePromised && !item.settled) {
      const promisedDate = new Date(item.datePromised);
      const diffTime = promisedDate - todayDate;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        const absOver = Math.abs(diffDays);
        deadlineBadgeHtml = `<span class="deadline-pill overdue" title="Overdue">⚠️ Overdue by ${absOver} ${absOver === 1 ? "day" : "days"}</span>`;
      } else if (diffDays === 0) {
        deadlineBadgeHtml = `<span class="deadline-pill today" title="Due today">⚡ Due Today!</span>`;
      } else if (diffDays <= 7) {
        deadlineBadgeHtml = `<span class="deadline-pill soon" title="Settling soon">⏰ In ${diffDays}d</span>`;
      } else {
        deadlineBadgeHtml = `<span class="deadline-pill" title="Settlement deadline">📅 Due: ${item.datePromised}</span>`;
      }
    } else if (item.datePromised && item.settled) {
      deadlineBadgeHtml = `<span class="deadline-pill settled">Promised: ${item.datePromised}</span>`;
    }

    return `
      <tr class="due-row ${item.settled ? "settled-row" : ""}">
        <td class="col-person">
          <div class="due-person-cell">
            <div class="due-avatar" style="background: ${avatarBg}">${initials}</div>
            <span class="due-person">${escapeHtml(item.person)}</span>
          </div>
        </td>
        <td class="col-type">
          <span class="due-type-badge ${isLent ? "lent" : "borrowed"}">
            ${isLent ? "↗ Lent" : "↙ Borrowed"}
          </span>
        </td>
        <td class="col-desc">
          <span class="due-desc">${escapeHtml(item.description)}</span>
        </td>
        <td class="col-dates">
          <div class="due-dates-cell">
            <span class="due-date-given">📅 ${item.dateGiven}</span>
            ${deadlineBadgeHtml ? `<div class="due-deadline-wrap">${deadlineBadgeHtml}</div>` : ""}
            ${item.settled && item.settledAt ? `<span class="settled-date-meta">✓ Settled ${item.settledAt.slice(0, 10)}</span>` : ""}
          </div>
        </td>
        <td class="col-status">
          <span class="due-status-chip ${item.settled ? "settled" : "pending"}">
            ${item.settled ? "✓ Settled" : "⏳ Pending"}
          </span>
        </td>
        <td class="col-amount text-right">
          <div class="due-amount-cell">
            <span class="due-amount ${isLent ? "income" : "expense"}">${amtFormatted}</span>
            <span class="due-amount-sub">${isLent ? "To Receive" : "To Pay"}</span>
          </div>
        </td>
        <td class="col-actions text-right">
          <div class="due-actions">
            <button
              class="btn btn-sm btn-action-settle ${item.settled ? "reopen" : ""}"
              data-id="${item.id}"
              title="${item.settled ? "Mark as unpaid" : "Mark as settled"}"
            >
              ${item.settled ? "↩ Reopen" : "✓ Settle"}
            </button>

            ${!item.settled ? `
              <button
                class="btn btn-sm btn-action-remind"
                data-id="${item.id}"
                title="Copy friendly reminder message & share"
              >
                💬 Remind
              </button>
            ` : ""}

            <button
              class="btn-action-delete"
              data-id="${item.id}"
              title="Delete this record"
              aria-label="Delete"
            >
              &times;
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

// ─── Update Expenses Overview Hub ───────────────────────
function updateHubExpensesStats() {
  const hubTotalIncome = document.getElementById("hubTotalIncome");
  const hubTotalExpense = document.getElementById("hubTotalExpense");
  const hubRemainingBudget = document.getElementById("hubRemainingBudget");

  if (!hubTotalIncome || !hubTotalExpense || !hubRemainingBudget) return;

  try {
    const raw = localStorage.getItem("studentExpenseTracker_cache");
    const data = raw ? JSON.parse(raw) : { transactions: [], budget: 0 };
    let income = 0;
    let expense = 0;

    (data.transactions || []).forEach((t) => {
      const amt = Number(t.amount) || 0;
      if (t.type === "income") income += amt;
      else if (t.type === "expense") expense += amt;
    });

    const budget = Number(data.budget) || 0;
    const remaining = budget > 0 ? budget - expense : income - expense;

    hubTotalIncome.textContent = formatCurrency(income);
    hubTotalExpense.textContent = formatCurrency(expense);
    hubRemainingBudget.textContent = formatCurrency(remaining);
  } catch (e) {
    console.error("Error reading expense cache in borrow-lend:", e);
  }
}

// ─── Render All ─────────────────────────────────────────
function renderAll() {
  renderSummary();
  renderPeopleSummary();
  renderDuesList();
  updateHubExpensesStats();
}

// Initial render
renderAll();

window.addEventListener("focus", () => {
  duesState = loadDues();
  renderAll();
});

window.addEventListener("storage", (e) => {
  if (e.key === DUES_KEY) {
    duesState = loadDues();
    renderAll();
  } else if (e.key === "studentExpenseTracker_cache") {
    updateHubExpensesStats();
  }
});

// ─── AI Financial Assistant Controller (Borrow & Lend) ──
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

  aiCloseBtn.addEventListener("click", () => {
    aiChatPanel.classList.add("hidden");
  });

  aiClearBtn.addEventListener("click", () => {
    aiMessages.innerHTML = `
      <div class="ai-msg ai-msg-bot">
        <div class="ai-msg-bubble">
          <p>Chat cleared! How can I help with your borrowed and lent money today?</p>
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
    s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.*?)\*/g, "<em>$1</em>");
    s = s.replace(/^•\s+(.*)$/gm, "<li>$1</li>");
    s = s.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");
    s = s.replace(/<\/ul>\s*<ul>/g, "");
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

  function appendBotMessage(replyHtml) {
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const msgDiv = document.createElement("div");
    msgDiv.className = "ai-msg ai-msg-bot";
    msgDiv.innerHTML = `
      <div class="ai-msg-bubble">${replyHtml}</div>
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

  function handleUserSubmit(userText) {
    appendUserMessage(userText);
    aiChatInput.value = "";
    aiSendBtn.disabled = true;
    showTyping();

    setTimeout(() => {
      hideTyping();
      aiSendBtn.disabled = false;
      const res = processDuesAiQuery(userText);
      appendBotMessage(formatAiReply(res));
    }, 380);
  }

  function processDuesAiQuery(raw) {
    const msg = raw.toLowerCase().trim();
    const totals = computeTotals();

    // 1. ADD LENT / BORROWED COMMAND
    // e.g. "Lent ₹500 to Rahul for lunch", "Borrowed 300 from Aman"
    const isAdd = /\b(lent|lend|gave|borrowed|borrow|took)\b/i.test(msg) && /\d+/.test(msg);
    if (isAdd) {
      const isLent = /\b(lent|lend|gave|give)\b/i.test(msg);
      const amtMatch = msg.match(/(?:₹|rs\.?)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
      let amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, "")) : 0;
      if (amount > 0) {
        // Extract person name (e.g., "to Rahul", "from Aman")
        let person = "Friend";
        const personMatch = msg.match(/\b(?:to|from)\s+([a-zA-Z]+)/i);
        if (personMatch) {
          person = personMatch[1].charAt(0).toUpperCase() + personMatch[1].slice(1);
        }

        // Description
        let desc = "Shared expense";
        const forMatch = msg.match(/\b(?:for|as)\s+([^.,!]+)/i);
        if (forMatch) {
          desc = forMatch[1].trim();
        }

        const newRec = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          person,
          amount,
          description: desc,
          type: isLent ? "lent" : "borrowed",
          dateGiven: new Date().toISOString().slice(0, 10),
          datePromised: "",
          settled: false,
          settledAt: null,
          createdAt: new Date().toISOString(),
        };

        duesState.unshift(newRec);
        saveDues(duesState);
        renderAll();

        return `✅ **Recorded Successfully!**\n\n` +
               `• **Type**: ${isLent ? "Lent (+₹)" : "Borrowed (-₹)"}\n` +
               `• **Person**: ${person}\n` +
               `• **Amount**: ${formatCurrency(amount)}\n` +
               `• **Reason**: ${desc}\n\n` +
               `Stored safely on your device!`;
      }
    }

    // 2. WHO OWES ME MONEY?
    if (msg.includes("who owes") || msg.includes("owed me") || msg.includes("lent") || msg.includes("receive")) {
      const lentPending = duesState.filter((d) => d.type === "lent" && !d.settled);
      if (lentPending.length === 0) {
        return `🎉 **No one owes you money right now!**\n\nAll lent records are settled. To add a new one, say: *"Lent ₹500 to Rahul for Dinner"*!`;
      }

      let reply = `💰 **People who owe you money (${formatCurrency(totals.lentPending)} total):**\n\n`;
      for (const item of lentPending) {
        reply += `• **${item.person}**: ${formatCurrency(item.amount)} — *${item.description}* (${item.dateGiven})\n`;
      }
      return reply;
    }

    // 3. HOW MUCH DO I OWE? / WHO DO I OWE?
    if (msg.includes("how much do i owe") || msg.includes("who do i owe") || msg.includes("borrowed") || msg.includes("my debts") || msg.includes("pay back")) {
      const borrowedPending = duesState.filter((d) => d.type === "borrowed" && !d.settled);
      if (borrowedPending.length === 0) {
        return `🎉 **You don't owe anyone any money!**\n\nYou have zero active borrowings. Great financial discipline!`;
      }

      let reply = `🔴 **Money you currently owe (${formatCurrency(totals.borrowedPending)} total):**\n\n`;
      for (const item of borrowedPending) {
        reply += `• To **${item.person}**: ${formatCurrency(item.amount)} — *${item.description}* (${item.dateGiven})\n`;
      }
      return reply;
    }

    // 4. NET BALANCE / SUMMARY POSITION
    if (msg.includes("balance") || msg.includes("net") || msg.includes("summary") || msg.includes("total")) {
      return `📊 **Borrow & Lend Position:**\n\n` +
             `• **Money Lent to Others**: ${formatCurrency(totals.lentPending)} (${totals.lentCount} active)\n` +
             `• **Money You Borrowed**: ${formatCurrency(totals.borrowedPending)} (${totals.borrowedCount} active)\n` +
             `• **Net Position**: **${totals.net >= 0 ? "+" : ""}${formatCurrency(totals.net)}**\n\n` +
             (totals.net >= 0
               ? `🟢 You are in the green — you are owed more than you owe!`
               : `🔴 You have a net payable debt. Consider settling with contacts soon!`);
    }

    // 5. SETTLEMENT TIPS
    if (msg.includes("settle") || msg.includes("tip") || msg.includes("advice")) {
      return `💡 **Smart Dues Settlement Strategies:**\n\n` +
             `1. **Same-Day Bill Splits:** Settle split bills within 24 hours while the memory is fresh.\n` +
             `2. **Use Friendly Reminders:** Click the **💬 Remind** button next to any due to copy a polite reminder message for WhatsApp!\n` +
             `3. **Mutual Offsetting:** If you and a friend frequently lend each other small amounts, offset the difference rather than exchanging multiple payments.`;
    }

    // Default Fallback
    return `I can help you keep track of all money borrowed and lent! Try asking:\n\n` +
           `• 💰 *"Who owes me money?"*\n` +
           `• 💸 *"How much money do I owe?"*\n` +
           `• ➕ *"Lent ₹500 to Rahul for lunch"*\n` +
           `• ➕ *"Borrowed ₹300 from Aman for books"*\n` +
           `• 📊 *"What is my net balance?"*`;
  }
})();
