# 🎓 Student Expense Tracker (Centralized PostgreSQL)

A clean, minimal, and beautifully designed expense tracker built for students with **Centralized PostgreSQL Storage & Real-Time Sync**. Powered by Node.js, Express, PostgreSQL, HTML5, CSS3, and JavaScript.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat&logo=supabase&logoColor=white)

---

## ✨ Features

- **🐘 Centralized PostgreSQL Logs** — All transactions are recorded in the central PostgreSQL database. Wherever you host the app and open the website (on your phone, laptop, or any device), you will see the exact same centralized data.
- **👤 Author Tracking** — Each expense logs the user who created it (e.g. `🍕 Food · 26 Oct · 👤 Alex`).
- **⚡ Real-Time Sync** — Built with Server-Sent Events (SSE). When an expense is added from any device, all open tabs and devices update live without refreshing.
- **🔐 User Accounts & Login** — Secure JWT authentication with bcrypt password hashing.
- **Monthly Budget** — Set a budget and visualize spending with an animated progress bar.
- **Dashboard Summary** — View total income and expenses, plus the current month's remaining budget.
- **Category Breakdown** — Visual bar chart of expenses by category.
- **Filter & Search** — Search by description, filter by type/category, sort by date or amount.

---

## 🚀 Running Locally

```bash
npm install
npm start
```

Open **`http://localhost:3000`** in your browser.

---

## 🌐 Deploying to the Web (Access from Anywhere on Phone & Laptop)

Because the app is backed by a cloud Supabase PostgreSQL database, deploying it takes just 1 click to get a public URL:

### Deploy to Render (Free)
1. Push this repository to GitHub.
2. Go to [Render Dashboard](https://dashboard.render.com/) → **New Web Service** → Select your repo.
3. Configure:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. In **Environment Variables**, add:
   - `DATABASE_URL`: `postgresql://postgres.qmpfbgdcxuinrvpgnxju:expensetracker12312@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`
   - `JWT_SECRET`: `your_random_secret_string`
5. Click **Create Web Service**.

Once deployed (e.g. `https://student-expense-tracker.onrender.com`), open that URL on your phone, laptop, or share it with others — everyone accesses the exact same centralized PostgreSQL database live from anywhere!

---

## 🛠 PostgreSQL Database Architecture

The backend connects directly to the Supabase PostgreSQL database and manages the following schema:

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
├── server.js       → Express API server, PostgreSQL pool & live SSE broadcast
├── script.js       → Client app, auth manager, live sync & rendering
├── index.html      → Responsive dashboard layout & auth modal
├── style.css       → Styling, design system & animations
├── .env            → PostgreSQL connection string & secrets
└── package.json    → Dependencies & start scripts
```

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

## 📝 License

This project is [MIT](LICENSE) licensed — free to use, modify, and distribute.

---

<p align="center">Made with ❤️ for students</p>
