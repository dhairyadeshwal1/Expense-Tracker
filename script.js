// ─── State & Storage ─────────────────────────────────────
const STATE_KEY = "studentExpenseTracker";

function loadLocalState() {
  const raw = localStorage.getItem(STATE_KEY);
  return raw ? JSON.parse(raw) : { transactions: [], budget: 0 };
}

function saveLocalState(newState) {
  localStorage.setItem(STATE_KEY, JSON.stringify(newState));
}

let state = loadLocalState();
let currentUser = null;
let unsubscribeFirestore = null;
let isFirebaseActive = false;

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
const cloudSettingsBtn = document.getElementById("cloudSettingsBtn");
const userChipArea = document.getElementById("userChipArea");
const openAuthBtn = document.getElementById("openAuthBtn");

// Auth Modal DOM
const authModal = document.getElementById("authModal");
const closeAuthModal = document.getElementById("closeAuthModal");
const authModalTitle = document.getElementById("authModalTitle");
const authModalSubtitle = document.getElementById("authModalSubtitle");
const tabSignIn = document.getElementById("tabSignIn");
const tabSignUp = document.getElementById("tabSignUp");
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const togglePasswordBtn = document.getElementById("togglePasswordBtn");
const passwordHint = document.getElementById("passwordHint");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const googleSignInBtn = document.getElementById("googleSignInBtn");
const guestModeBtn = document.getElementById("guestModeBtn");
const authAlert = document.getElementById("authAlert");

// Cloud Setup Modal DOM
const cloudModal = document.getElementById("cloudModal");
const closeCloudModal = document.getElementById("closeCloudModal");
const firebaseConfigInput = document.getElementById("firebaseConfigInput");
const saveCloudConfigBtn = document.getElementById("saveCloudConfigBtn");
const resetCloudConfigBtn = document.getElementById("resetCloudConfigBtn");
const cloudConfigStatus = document.getElementById("cloudConfigStatus");

// Toast
const toastEl = document.getElementById("toast");

let authMode = "signin"; // "signin" | "signup"

// ─── Toast Helper ───────────────────────────────────────
let toastTimer = null;
function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 3200);
}

// ─── Format Currency & Helpers ──────────────────────────
function formatCurrency(n) {
  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Set today as default date
if (dateInput) {
  dateInput.value = new Date().toISOString().slice(0, 10);
}

// ─── Firebase Initialization ────────────────────────────
let auth = null;
let db = null;

function initFirebase() {
  try {
    if (typeof firebase === "undefined") {
      console.warn("Firebase SDK script not loaded.");
      updateSyncStatus("guest", "Offline Mode");
      return;
    }

    const config = typeof getFirebaseConfig === "function" ? getFirebaseConfig() : null;

    if (!config || !config.apiKey || config.apiKey === "YOUR_API_KEY" || !config.projectId) {
      updateSyncStatus("guest", "Local Only (Click Cloud Setup to Sync)");
      if (footerStorageNote) {
        footerStorageNote.textContent = "Data saved in local browser (offline)";
      }
      return;
    }

    // Initialize or get app
    let app;
    if (!firebase.apps.length) {
      app = firebase.initializeApp(config);
    } else {
      app = firebase.app();
    }

    auth = firebase.auth();
    db = firebase.firestore();

    // Enable offline persistence in Firestore
    db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
      console.log("Firestore offline persistence:", err.code);
    });

    isFirebaseActive = true;
    updateSyncStatus("synced", "Cloud Ready");

    // Listen for Auth changes
    auth.onAuthStateChanged(handleAuthStateChanged);
  } catch (error) {
    console.error("Firebase init failed:", error);
    updateSyncStatus("error", "Cloud Init Error");
  }
}

// ─── Sync Status Indicator ──────────────────────────────
function updateSyncStatus(status, text) {
  if (!syncBadge || !syncText) return;
  syncBadge.className = `sync-badge ${status}`;
  syncText.textContent = text || status;
}

// ─── Auth State Handler ─────────────────────────────────
function handleAuthStateChanged(user) {
  currentUser = user;

  if (user) {
    // User is logged in
    renderUserChip(user);
    if (footerStorageNote) {
      footerStorageNote.textContent = `Synced with cloud account (${user.email || "Google Account"})`;
    }
    closeAuthModalFn();

    // Start listening to the user's Firestore document
    subscribeToUserData(user.uid);
  } else {
    // User is logged out
    renderLoggedOutChip();
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
      unsubscribeFirestore = null;
    }
    if (footerStorageNote) {
      footerStorageNote.textContent = "Data saved in local browser";
    }
    updateSyncStatus("guest", "Guest Mode");
    state = loadLocalState();
    renderAll();
  }
}

// ─── User Chip Render ───────────────────────────────────
function renderUserChip(user) {
  const displayName = user.displayName || user.email || "Student";
  const initial = displayName.charAt(0).toUpperCase();

  userChipArea.innerHTML = `
    <div class="user-chip" title="${displayName}">
      <div class="user-avatar">${initial}</div>
      <span class="user-name">${escapeHtml(displayName)}</span>
      <button id="logoutBtn" class="btn-logout" title="Sign out">Log out</button>
    </div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", () => {
    if (auth) {
      auth.signOut().then(() => {
        showToast("Signed out successfully");
      });
    }
  });
}

function renderLoggedOutChip() {
  userChipArea.innerHTML = `
    <button id="openAuthBtn" class="btn btn-login btn-sm">🔑 Sign In / Register</button>
  `;
  document.getElementById("openAuthBtn").addEventListener("click", openAuthModalFn);
}

// ─── Real-time Firestore Sync ───────────────────────────
function subscribeToUserData(uid) {
  if (!db) return;
  updateSyncStatus("syncing", "Connecting...");

  const userDocRef = db.collection("users").doc(uid);

  if (unsubscribeFirestore) {
    unsubscribeFirestore();
  }

  unsubscribeFirestore = userDocRef.onSnapshot(
    (doc) => {
      if (doc.exists) {
        const cloudData = doc.data();
        state = {
          transactions: Array.isArray(cloudData.transactions) ? cloudData.transactions : [],
          budget: typeof cloudData.budget === "number" ? cloudData.budget : 0,
        };
        saveLocalState(state);
        renderAll();
        updateSyncStatus("synced", "Synced with Phone & Laptop");
      } else {
        // First login: Migrate local storage data into cloud account
        const localData = loadLocalState();
        if (localData.transactions && localData.transactions.length > 0) {
          saveState(localData);
          showToast(`Migrated ${localData.transactions.length} local transactions to your cloud account!`);
        } else {
          saveState(state);
        }
      }
    },
    (err) => {
      console.error("Firestore sync error:", err);
      updateSyncStatus("error", "Sync Error");
    }
  );
}

// ─── Unified State Persistence ──────────────────────────
function saveState(newState) {
  state = newState;
  saveLocalState(state);

  if (currentUser && db && isFirebaseActive) {
    updateSyncStatus("syncing", "Syncing to cloud...");
    db.collection("users")
      .doc(currentUser.uid)
      .set(
        {
          transactions: state.transactions,
          budget: state.budget,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      .then(() => {
        updateSyncStatus("synced", "Synced");
      })
      .catch((err) => {
        console.error("Error writing to cloud:", err);
        updateSyncStatus("error", "Cloud Save Failed");
        showToast("Cloud sync failed. Data saved locally.");
      });
  }
}

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
  showToast("Transaction added!");
});

// ─── Delete Transaction ─────────────────────────────────
transactionList.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-delete");
  if (!btn) return;

  const id = btn.dataset.id;
  state.transactions = state.transactions.filter((t) => t.id !== id);
  saveState(state);
  renderAll();
  showToast("Transaction deleted");
});

// ─── Clear All ──────────────────────────────────────────
clearAllBtn.addEventListener("click", () => {
  if (!confirm("Are you sure you want to delete ALL transactions?")) return;
  state.transactions = [];
  saveState(state);
  renderAll();
  showToast("All transactions cleared");
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
  showToast(`Monthly budget set to ${formatCurrency(val)}`);
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

// ─── Auth Modal Logic ───────────────────────────────────
function openAuthModalFn() {
  if (!isFirebaseActive) {
    // If Firebase isn't configured yet, prompt Cloud Setup first
    openCloudModalFn();
    return;
  }
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
    authModalTitle.textContent = "Welcome Back";
    authModalSubtitle.textContent = "Sign in to sync your expenses between phone and laptop";
    authSubmitBtn.textContent = "Sign In";
    passwordHint.style.display = "none";
  } else {
    tabSignUp.classList.add("active");
    tabSignIn.classList.remove("active");
    authModalTitle.textContent = "Create Account";
    authModalSubtitle.textContent = "Sync expenses seamlessly on both phone and laptop";
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

function friendlyAuthError(err) {
  switch (err.code) {
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in.";
    case "auth/weak-password":
      return "Password is too weak. Please use at least 6 characters.";
    case "auth/popup-closed-by-user":
      return "Sign in popup closed before finishing.";
    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";
    default:
      return err.message || "An authentication error occurred.";
  }
}

// Tab Switches
tabSignIn.addEventListener("click", () => setAuthMode("signin"));
tabSignUp.addEventListener("click", () => setAuthMode("signup"));

// Close buttons
closeAuthModal.addEventListener("click", closeAuthModalFn);
guestModeBtn.addEventListener("click", () => {
  closeAuthModalFn();
  showToast("Continuing in Guest Mode (Offline)");
});

// Toggle Password Visibility
togglePasswordBtn.addEventListener("click", () => {
  const isPw = authPassword.type === "password";
  authPassword.type = isPw ? "text" : "password";
  togglePasswordBtn.textContent = isPw ? "🙈" : "👁";
});

// Auth Form Submit (Email/Password)
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!auth) {
    showAuthAlert("Firebase is not initialized yet. Please check Cloud Setup.");
    return;
  }

  const email = authEmail.value.trim();
  const password = authPassword.value;

  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = "Please wait…";
  clearAuthAlert();

  try {
    if (authMode === "signup") {
      await auth.createUserWithEmailAndPassword(email, password);
      showToast("Account created successfully!");
    } else {
      await auth.signInWithEmailAndPassword(email, password);
      showToast("Signed in successfully!");
    }
  } catch (err) {
    console.error("Auth error:", err);
    showAuthAlert(friendlyAuthError(err), "error");
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = authMode === "signin" ? "Sign In" : "Create Account";
  }
});

// Google Sign-In
googleSignInBtn.addEventListener("click", async () => {
  if (!auth) {
    showAuthAlert("Firebase is not initialized yet. Please check Cloud Setup.");
    return;
  }

  googleSignInBtn.disabled = true;
  clearAuthAlert();

  const provider = new firebase.auth.GoogleAuthProvider();

  try {
    await auth.signInWithPopup(provider);
    showToast("Signed in with Google!");
  } catch (err) {
    console.error("Google sign-in error:", err);
    showAuthAlert(friendlyAuthError(err), "error");
  } finally {
    googleSignInBtn.disabled = false;
  }
});

// ─── Cloud Setup Modal Logic ────────────────────────────
function openCloudModalFn() {
  cloudConfigStatus.classList.add("hidden");
  const currentConfig = localStorage.getItem("firebase_user_config");
  if (currentConfig) {
    firebaseConfigInput.value = currentConfig;
  } else if (typeof DEFAULT_FIREBASE_CONFIG !== "undefined" && DEFAULT_FIREBASE_CONFIG.apiKey) {
    firebaseConfigInput.value = JSON.stringify(DEFAULT_FIREBASE_CONFIG, null, 2);
  }
  cloudModal.classList.remove("hidden");
}

function closeCloudModalFn() {
  cloudModal.classList.add("hidden");
}

cloudSettingsBtn.addEventListener("click", openCloudModalFn);
closeCloudModal.addEventListener("click", closeCloudModalFn);

saveCloudConfigBtn.addEventListener("click", () => {
  const raw = firebaseConfigInput.value.trim();
  if (!raw) {
    cloudConfigStatus.textContent = "Please paste your Firebase configuration.";
    cloudConfigStatus.className = "auth-alert error";
    cloudConfigStatus.classList.remove("hidden");
    return;
  }

  try {
    let parsed;
    // Extract JSON or object if user pasted "const firebaseConfig = { ... };"
    if (raw.includes("{")) {
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      const cleaned = raw
        .slice(jsonStart, jsonEnd + 1)
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // Quote unquoted keys
        .replace(/'/g, '"') // Single to double quotes
        .replace(/,\s*}/g, "}"); // Remove trailing commas
      parsed = JSON.parse(cleaned);
    } else {
      parsed = JSON.parse(raw);
    }

    if (!parsed.apiKey || !parsed.projectId) {
      throw new Error("Missing apiKey or projectId in config.");
    }

    localStorage.setItem("firebase_user_config", JSON.stringify(parsed, null, 2));

    cloudConfigStatus.textContent = "Configuration saved! Reloading to connect...";
    cloudConfigStatus.className = "auth-alert success";
    cloudConfigStatus.classList.remove("hidden");

    setTimeout(() => {
      window.location.reload();
    }, 1200);
  } catch (err) {
    console.error("Config parse error:", err);
    cloudConfigStatus.textContent = "Invalid format. Please paste a valid firebaseConfig object.";
    cloudConfigStatus.className = "auth-alert error";
    cloudConfigStatus.classList.remove("hidden");
  }
});

resetCloudConfigBtn.addEventListener("click", () => {
  if (confirm("Reset cloud configuration to defaults?")) {
    localStorage.removeItem("firebase_user_config");
    firebaseConfigInput.value = "";
    showToast("Cloud configuration reset");
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  }
});

// Close modals on clicking overlay outside card
[authModal, cloudModal].forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.classList.add("hidden");
    }
  });
});

// ─── Initial Render & Init ──────────────────────────────
renderAll();
initFirebase();
