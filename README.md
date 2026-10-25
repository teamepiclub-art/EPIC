# EPIC CLUB — Official Web Platform & Student Registration System
**Faculty of Medicine of Sétif (Université Ferhat Abbas Sétif 1, Algeria)**

Official web portal and candidate admission management system for **EPIC CLUB** (Exploration · Passion · Innovation · Creativity).

---

## 🏥 Overview

The EPIC CLUB portal connects future medical, pharmacy, and dental students with club departments, scientific congresses, medical simulation workshops, and community health initiatives.

### Key Features
- **Official Public Portal:** Responsive homepage featuring department profiles, verified photo gallery ("A Year of Impact"), and dynamic interactivity.
- **Student Admissions Portal (`/register`):** Multi-step registration capturing academic track, study year, student ID, department choices, and personal motivation.
- **Telegram Bot Integration:** Automated single-use invite generation (`member_limit = 1`), candidate account verification, and onboarding via Telegram bot (`@epicbazbot`).
- **Administrative Console (`/admin.html`):** Role-based admin dashboard with candidate review, batch actions, deep linking, search, audit logs, and delivery tracking.
- **Zero-Dependency Native Architecture:** Runs on native Node.js (v22.5+) utilizing `node:sqlite` for ACID-compliant, SQL-injection-safe data storage.

---

## 🎨 Brand Identity

- **Cyan:** `#00B8D9`
- **Ice Blue:** `#F4FBFD`
- **Mint Green:** `#35BFA3`
- **Cadmium Yellow:** `#FCE445`
- **Midnight:** `#172B4D`
- **Deep Navy:** `#102A43`

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v22.5.0 or later (required for native `node:sqlite`).

### Installation
1. Clone this repository:
   ```bash
   git clone https://github.com/teamepiclub-art/EPIC.git
   cd EPIC
   ```

2. Copy the sample environment file and configure variables:
   ```bash
   cp .env.example .env
   ```

3. Configure your Telegram bot credentials in `.env`:
   ```ini
   PORT=3000
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   TELEGRAM_BOT_USERNAME=your_bot_username
   TELEGRAM_TARGET_CHAT_ID=-100xxxxxxxxxx
   ADMIN_DEFAULT_USERNAME=admin
   ADMIN_DEFAULT_PASSWORD=YourSecurePassword!
   ```

4. Start the server:
   ```bash
   node server.js
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ☁️ Cloud Deployment (Vercel + Neon PostgreSQL)

The project includes ready-to-deploy **Vercel Serverless Functions** (`/api/*`) and a **Neon PostgreSQL** database layer (`lib/db.js`).

For step-by-step instructions on deploying the portal to Vercel with zero server management:
👉 **[Read the Vercel Deployment Guide (VERCEL_DEPLOYMENT.md)](./VERCEL_DEPLOYMENT.md)**


## 📁 Repository Structure

```
├── admin.html                 # Protected administrative dashboard
├── css/
│   ├── gallery.css            # Asymmetric editorial gallery & lightbox styles
│   └── styles.css             # Global design tokens and layout styling
├── data/                      # Initial seeds and storage (database auto-generated)
├── db/
│   ├── index.js               # node:sqlite access layer and parameterized queries
│   └── migrations.js          # Versioned schema migration runner
├── index.html                 # Main landing page
├── js/
│   ├── app.js                 # Global client interactions
│   ├── gallery-data.js        # Verified photo metadata & categories
│   ├── gallery.js             # Dynamic masonry grid & lightbox controller
│   └── register.js            # Frontend registration validation & status check
├── migrations/                # Versioned SQL migrations (001 - 004)
├── photo/                     # High-resolution authentic activity photography
├── register.html              # Candidate admission application page
├── registration-success.html  # Onboarding confirmation & reference card
├── server.js                  # Native HTTP server, Telegram polling & REST APIs
└── utils/                     # Environment, logging, validation & rate limiting
```

---

## 🔒 Security & Privacy

- Parameterized SQL statements exclusively; no dynamic SQL concatenation.
- Rate limiting on sensitive endpoints (login, registration submission, status lookup).
- Passwords hashed using PBKDF2 with unique cryptographic salts.
- Automatic verification of single-use Telegram invite links.

---

## 📜 License
Developed for **EPIC CLUB** — Faculty of Medicine of Sétif (UFAS 1). All rights reserved.
