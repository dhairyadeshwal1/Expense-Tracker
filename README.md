# 🎓 Student Expense Tracker

A clean, minimal, and beautifully designed expense tracker built for students — powered by pure **HTML5**, **CSS3**, and **JavaScript** with optional **Firebase Authentication & Real-Time Cloud Sync**. No backend server needed. Just elegance.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat&logo=firebase&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-green.svg)

---

## ✨ Features

- **🔐 User Login & Accounts** — Sign In with Email/Password or 1-Click Google Sign-In
- **📱 Real-Time Cross-Device Sync** — Add an expense on your phone and watch it update live on your laptop screen!
- **📦 Offline & Guest Mode** — Works out-of-the-box even without logging in or without internet via `localStorage`
- **Track Income & Expenses** — Add transactions with description, amount, date, and category
- **Monthly Budget** — Set a budget and visualize spending with an animated progress bar
- **Dashboard Summary** — View total income and expenses, plus the current month's remaining budget
- **Category Breakdown** — Visual bar chart of expenses by category
- **Filter & Search** — Search by description, filter by type/category, sort by date or amount
- **14 Built-in Categories** — Food, Transport, Books, Rent, Freelance, Scholarship & more
- **Fully Responsive** — Optimized thumb-friendly UI for iPhone, Android, tablets, and desktop
- **No Build Tools** — Runs directly in any browser with zero node_modules or dependencies

---

## 🎨 Design

Minimal and modern with an Apple-inspired premium feel:
- **Font** — Plus Jakarta Sans
- **Palette** — Clean light surface, deep navy accents, subtle glassmorphism modals
- **Style** — Clean geometry, subtle shadows, generous whitespace, uppercase micro-labels

---

## 📁 Project Structure

```
student expense/
├── index.html          → Main HTML layout & modals
├── style.css           → Responsive styles & design system
├── script.js           → App logic, auth state & Firestore sync
├── firebase-config.js  → Firebase project configuration
└── README.md           → Documentation & setup guide
```

---

## 🚀 Getting Started

### 1. Instant Local Use (No Setup Needed)
Simply double click **`index.html`** or open it with Live Server. You can immediately track expenses in **Guest Mode** (stored in your browser).

---

## ☁️ How to Sync Between Phone and Laptop (2-Minute Setup)

To use your account and have your data synced between your phone and laptop:

### Step 1: Create a Free Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/) and click **Add Project**.
2. Name your project (e.g. `my-student-expenses`) and click Continue.

### Step 2: Enable Authentication
1. In the Firebase console left menu, click **Build** → **Authentication** → **Get Started**.
2. Under Sign-in method, enable:
   - **Email/Password**
   - **Google** (optional, recommended for 1-click mobile sign in)

### Step 3: Enable Cloud Firestore
1. In the left menu, click **Build** → **Firestore Database** → **Create database**.
2. Select **Start in test mode** and choose your nearest region. Click Create.

### Step 4: Add Your Keys to the App
1. In Project Settings (gear icon at top left), scroll to **Your apps**, click the Web icon (**`</>`**), and register the app.
2. Copy the `firebaseConfig` object shown on the screen.
3. Either:
   - **Paste it directly in the app**: Click the **☁️ Cloud Setup** button in the top navigation bar and paste your config.
   - **Or edit `firebase-config.js`**: Paste your keys in `firebase-config.js`.

---

## 📱 How to Open on Your Phone

Once your Firebase is set up, you can access your tracker on your phone in either of these ways:

1. **GitHub Pages (Recommended & Free forever)**:
   - Push this repo to GitHub.
   - Go to your repository **Settings** → **Pages** → Branch: `main` → Save.
   - Open your GitHub Pages URL on Safari or Chrome on your phone.
   - (Optional) Tap **"Add to Home Screen"** on your phone to use it like a native mobile app!

2. **Local Wi-Fi Network**:
   - If using VS Code Live Server or `npx serve`, open `http://<your-laptop-ip>:5500/` on your phone connected to the same Wi-Fi.

---

## 🛠 How It Works

| Feature | Implementation |
|---------|---------------|
| Cross-Device Sync | Cloud Firestore real-time listener (`onSnapshot`) |
| User Accounts | Firebase Authentication (Email/Password + Google Sign-In) |
| Offline Fallback | Firestore offline persistence & browser `localStorage` |
| Budget Tracker | Progress bar updates dynamically; turns red when over budget |
| Filtering | Real-time search and multi-filter with sort options |
| Chart | Pure CSS horizontal bar chart — zero external charting libraries |
| Responsiveness | Mobile-first CSS flexbox and grid layouts |

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to open an issue or submit a pull request.

## 📝 License

This project is [MIT](LICENSE) licensed — free to use, modify, and distribute.

---

<p align="center">Made with ❤️ for students</p>
