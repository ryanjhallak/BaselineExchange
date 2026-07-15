# Baseline Exchange

A stock market for ATP tennis players. Every player's share price is their real ATP ranking-point total — buy low before a big tournament run, sell high after the points land.

Built with Next.js (App Router), SQLite, and real account auth.

## Quick start

```bash
npm install
cp .env.example .env.local   # then edit it
npm run dev
```

Open http://localhost:3000, create an account, and start trading.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUTH_SECRET` | Yes (in production) | Signs session cookies. Generate with `openssl rand -hex 32`. |
| `ANTHROPIC_API_KEY` | No | Enables live ATP rankings. Each "Sync now" asks Claude (with web search) for the current official top 16 and stores the result. Without a key, the app runs on built-in seed data so everything still works locally. |

## How it works

- **Auth** — username + password. Passwords are hashed with bcrypt; sessions are HMAC-signed httpOnly cookies (`lib/auth.js`). No plaintext secrets ever touch the database or the client.
- **Database** — SQLite via better-sqlite3 (`lib/db.js`), auto-created as `data.sqlite` on first run. Tables: `users`, `holdings`, `players` (with per-date price history as JSON), `meta`.
- **Rankings** — `lib/rankings.js` fetches the live ATP top 16 server-side through the Anthropic API with web search (your API key never reaches the browser), merges it into the players table, and appends one history point per date. Live fetches are rate-limited to once per hour. Rankings officially update on Mondays, so expect one real price move per week.
- **Trading** — `POST /api/trade` runs buys/sells as SQLite transactions, so cash and holdings can never drift out of sync.
- **Leaderboard** — computed live with a SQL join: cash + sum of holdings at current prices, top 10.

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/auth/register` | POST | Create account, start session |
| `/api/auth/login` | POST | Sign in |
| `/api/auth/logout` | POST | Sign out |
| `/api/auth/me` | GET | Current session user |
| `/api/rankings` | GET | Players + price history + last sync time |
| `/api/rankings/sync` | POST | Pull fresh rankings (auth required) |
| `/api/portfolio` | GET | Your cash + holdings |
| `/api/trade` | POST | `{ action: "buy"|"sell", sym, qty }` |
| `/api/leaderboard` | GET | Top 10 traders by net worth |

## Deploying

SQLite needs a persistent disk, so deploy to a host with one: **Railway, Render, Fly.io, or any VPS** all work out of the box (`npm run build && npm start`).

Vercel's serverless filesystem is ephemeral, so SQLite won't persist there. To deploy on Vercel, swap `lib/db.js` for a hosted database (Vercel Postgres, Neon, Turso, or Supabase) — the query layer is isolated in that one file to make the swap straightforward.

## Ideas for next steps

- A weekly cron job hitting `/api/rankings/sync` so prices update without anyone clicking Sync
- Transaction history per user
- Limit orders ("buy Fonseca if he drops below 2,000")
- WTA roster alongside ATP
