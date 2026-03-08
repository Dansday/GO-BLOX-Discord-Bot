# Dansday – Discord Bot (Docker)

Discord bot management system with a web control panel: self-bot monitoring, official bot forwarding, leveling, giveaways, moderation, and more. Runs with Docker Compose.

### First time? What you need

You only need this on your machine:

| Need | Why |
|------|-----|
| **Git** | To clone the repo |
| **Docker** | To run the app |
| **Docker Compose** | To start the service (included with Docker Desktop) |
| **Make** | To run `make up` / `make down` (built-in on macOS/Linux; on Windows use [Docker Desktop](https://www.docker.com/products/docker-desktop/) and WSL2 or Git Bash) |
| **MySQL** | Database; app connects via env vars |
| **Redis** (optional) | Sessions / rate limit; set `REDIS_*` or `REDIS_URL` to use |

You do **not** need Node.js or npm installed — everything runs inside Docker.

Port **80** (or your `CONTROL_PANEL_PORT`) must be free for the control panel.

---

### How to run (first time)

**Step 1 – Clone the repo**

```bash
git clone https://github.com/YOUR_USERNAME/Dansday-Discord-Bot.git
cd Dansday-Discord-Bot
```

**Step 2 – Configure environment**

Copy `.env.example` to `.env` and set your values. Required: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SESSION_SECRET`. Optional: `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_URL`, `TIMEZONE`, `MAIL_*`.

**Step 3 – Database**

Ensure MySQL is running and run the schema once: execute `database/schema.sql` in your MySQL client.

**Step 4 – Start**

```bash
make up
```

Then open the control panel at **http://localhost** (or your `CONTROL_PANEL_PORT`).

**Stop:** `make down`

### Running without Docker (optional)

Only if you run the app directly on your machine (no Docker): copy `.env.example` to `.env`, fill in your database and optional Redis/mail settings, then `npm install` and `node index.js`.

### What’s running (services)

- **app**
  - Node.js control panel + official bot + self-bot logic
  - Runs in Docker, exposed on port **80** (or `CONTROL_PANEL_PORT`)
  - Connects to MySQL (and optionally Redis) via env vars

- **MySQL**
  - External; set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` in `.env`

- **Redis** (optional)
  - External; set `REDIS_HOST` + `REDIS_PASSWORD` (or `REDIS_URL`) for sessions and rate limiting

### Tech stack

- **Control panel**
  - **Express.js**, session auth (MySQL or Redis)
  - **Node.js 22**

- **Bots**
  - **discord.js** (official bot)
  - **discord.js-selfbot-v13** (self-bot)

- **Database / cache**
  - **MySQL** (mysql2)
  - **Redis** (optional, for sessions + rate limit)

- **Email** (optional)
  - **Nodemailer**

- **Infrastructure / Tooling**
  - **Docker**, **Docker Compose**
  - Make: `up`, `down`, `logs`, `restart`

---

License: MIT · Author: Akbar Yudhanto · Version: 7.8.0
