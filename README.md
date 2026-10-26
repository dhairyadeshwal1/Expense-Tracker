# 🎓 Student Expense Tracker (Centralized PostgreSQL)

A clean, minimal, and beautifully designed expense tracker built for students with **Centralized PostgreSQL Storage & Real-Time Cross-Device Sync**. Powered by Node.js, Express, PostgreSQL, HTML5, CSS3, and JavaScript.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat&logo=supabase&logoColor=white)

---

## ✨ Features

- **🐘 Centralized PostgreSQL Logs** — All transactions are recorded in a central PostgreSQL database. Any phone or laptop sees the shared log of expenses live!
- **👤 Author Tracking** — Each expense logs the user who created it (e.g. `🍕 Food · 26 Oct · 👤 Alex`).
- **⚡ Real-Time Cross-Device Sync** — Built with Server-Sent Events (SSE). Add an expense on your phone and watch it update live on your laptop instantly!
- **🔐 User Accounts & Login** — Secure JWT authentication with bcrypt password hashing.
- **📱 One-Tap Mobile Access** — Works seamlessly across all phones (iOS Safari & Android Chrome).
- **Monthly Budget** — Set a budget and visualize spending with an animated progress bar.
- **Dashboard Summary** — View total income and expenses, plus the current month's remaining budget.
- **Category Breakdown** — Visual bar chart of expenses by category.
- **Filter & Search** — Search by description, filter by type/category, sort by date or amount.

---

## 🚀 Quick Start

### 1. Start the Server
```bash
npm start
```

You will see:
```text
======================================================
 Student Expense Tracker Backend is Running!
 Database: Supabase PostgreSQL (Centralized Logs)
 Laptop access: http://localhost:3000
 Phone access:  http://<your-local-ip>:3000
======================================================
```

### 2. Access on Laptop
Open **`http://localhost:3000`** in any web browser.

### 3. Access on Phone
Make sure your phone is connected to the same Wi-Fi as your laptop. Open your phone's browser and go to:
```text
http://<your-local-ip>:3000
```
*(Tip: In Safari/Chrome, tap **"Add to Home Screen"** to use it like a full-screen mobile app!)*

---

## 🛠 PostgreSQL Database Architecture

The backend automatically connects to the configured Supabase PostgreSQL instance and manages the following schema:

```sql
-- Registered Users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Centralized Expense Transactions
CREATE TABLE transactions (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by VARCHAR(255),
  description VARCHAR(255) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  type VARCHAR(32) NOT NULL,
  category VARCHAR(64) NOT NULL,
  date VARCHAR(32) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Global App Settings (Centralized Monthly Budget)
CREATE TABLE app_settings (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 📁 Project Structure

```
student expense/
├── server.js       → Express API server, PostgreSQL pool & SSE broadcast
├── script.js       → Client app, auth manager, live sync & rendering
├── index.html      → Responsive dashboard layout & modals
├── style.css       → Styling, design system & animations
├── .env            → PostgreSQL connection string & secrets
└── package.json    → Dependencies & scripts
```

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

## 📝 License

This project is [MIT](LICENSE) licensed — free to use, modify, and distribute.

---

<p align="center">Made with ❤️ for students</p>
