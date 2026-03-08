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

When running locally with `make up`, the control panel is at **http://localhost:3333** (via `docker-compose.override.yml`). Ensure port **3333** is free.

---

### Preview / multiple deployments

The main **docker-compose.yaml** publishes the app as **`0:80`** (random host port), so multiple stacks (e.g. production and preview) never conflict on a fixed port. Your host or proxy can route by domain to the app on the internal network.

- **Hosted / PaaS**: Use **docker-compose.yaml** only (no override). Set required env vars in your platform (DB_*, SESSION_SECRET, etc.). The app listens on container port 80; set `PORT` if your platform expects it.
- **Local / clone repo**: `make up` merges **docker-compose.override.yml**, which binds **3333:80**, so the panel is at http://localhost:3333.

---

### How to run (first time)

**Step 1 – Clone the repo**

```bash
git clone https://github.com/YOUR_USERNAME/Dansday-Discord-Bot.git
cd Dansday-Discord-Bot
```

**Step 2 – Configure environment**

Copy `.env.example` to `.env` and set your values. Required: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SESSION_SECRET`. Optional: `REDIS_URL`, `TIMEZONE`, `MAIL_*`.

**Step 3 – Database**

Ensure MySQL is running and run the schema once: execute `database/schema.sql` in your MySQL client.

**Step 4 – Start**

```bash
make up
```

Then open the control panel at **http://localhost:3333**.

**Stop:** `make down`

### Running without Docker (optional)

Only if you run the app directly on your machine (no Docker): copy `.env.example` to `.env`, fill in your database and optional Redis/mail settings, then `npm install` and `node index.js`.

### What’s running (services)

- **app**
  - Node.js control panel + official bot + self-bot logic
  - Runs in Docker; local access at **http://localhost:3333** (app listens on port 80 inside container)
  - Connects to MySQL (and optionally Redis) via env vars

- **MySQL**
  - External; set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` in `.env`

- **Redis** (optional)
  - External; set `REDIS_URL` (full URL with password) for sessions and rate limiting

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
