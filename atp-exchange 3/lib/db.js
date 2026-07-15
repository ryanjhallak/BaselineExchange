import Database from "better-sqlite3";
import path from "path";

// Cache the connection across Next.js hot reloads in dev.
function createDb() {
  const db = new Database(path.join(process.cwd(), "data.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      cash INTEGER NOT NULL DEFAULT 30000,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS holdings (
      user_id INTEGER NOT NULL,
      sym TEXT NOT NULL,
      qty INTEGER NOT NULL,
      cost_basis INTEGER NOT NULL,
      PRIMARY KEY (user_id, sym),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS players (
      sym TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country TEXT,
      rank INTEGER,
      pts INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      history TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return db;
}

const db = globalThis.__atpDb || createDb();
if (process.env.NODE_ENV !== "production") globalThis.__atpDb = db;

export default db;

// ---- meta ----
export function getMeta(key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
}
export function setMeta(key, value) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

// ---- users ----
export function createUser({ username, display, passHash }) {
  const info = db
    .prepare("INSERT INTO users (username, display, pass_hash, created) VALUES (?, ?, ?, ?)")
    .run(username, display, passHash, Date.now());
  return getUserById(info.lastInsertRowid);
}
export function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}
export function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

// ---- players ----
export function getPlayers() {
  return db
    .prepare("SELECT * FROM players ORDER BY (rank IS NULL), rank ASC")
    .all()
    .map((p) => ({ ...p, active: !!p.active, history: JSON.parse(p.history) }));
}
export function getPlayer(sym) {
  const p = db.prepare("SELECT * FROM players WHERE sym = ?").get(sym);
  return p ? { ...p, active: !!p.active, history: JSON.parse(p.history) } : null;
}
export function upsertPlayer(p) {
  db.prepare(
    `INSERT INTO players (sym, name, country, rank, pts, active, history)
     VALUES (@sym, @name, @country, @rank, @pts, @active, @history)
     ON CONFLICT(sym) DO UPDATE SET
       name = excluded.name, country = excluded.country, rank = excluded.rank,
       pts = excluded.pts, active = excluded.active, history = excluded.history`
  ).run({ ...p, active: p.active ? 1 : 0, history: JSON.stringify(p.history) });
}
export function deactivatePlayersNotIn(syms) {
  if (syms.length === 0) return;
  const placeholders = syms.map(() => "?").join(",");
  db.prepare(`UPDATE players SET active = 0, rank = NULL WHERE sym NOT IN (${placeholders})`).run(...syms);
}

// ---- holdings & trading ----
export function getHoldings(userId) {
  return db
    .prepare(
      `SELECT h.sym, h.qty, h.cost_basis AS costBasis, p.name, p.pts
       FROM holdings h JOIN players p ON p.sym = h.sym
       WHERE h.user_id = ?`
    )
    .all(userId);
}

export const buyShares = db.transaction((userId, sym, qty) => {
  const user = getUserById(userId);
  const player = db.prepare("SELECT * FROM players WHERE sym = ?").get(sym);
  if (!player) throw new Error("Unknown player");
  const cost = player.pts * qty;
  if (qty < 1 || !Number.isInteger(qty)) throw new Error("Invalid quantity");
  if (cost > user.cash) throw new Error("Not enough cash");
  db.prepare("UPDATE users SET cash = cash - ? WHERE id = ?").run(cost, userId);
  db.prepare(
    `INSERT INTO holdings (user_id, sym, qty, cost_basis) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, sym) DO UPDATE SET qty = qty + excluded.qty, cost_basis = cost_basis + excluded.cost_basis`
  ).run(userId, sym, qty, cost);
  return { cost };
});

export const sellShares = db.transaction((userId, sym, qty) => {
  const holding = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND sym = ?").get(userId, sym);
  if (!holding) throw new Error("You don't own this player");
  if (qty < 1 || !Number.isInteger(qty) || qty > holding.qty) throw new Error("Invalid quantity");
  const player = db.prepare("SELECT * FROM players WHERE sym = ?").get(sym);
  const proceeds = player.pts * qty;
  const remaining = holding.qty - qty;
  if (remaining === 0) {
    db.prepare("DELETE FROM holdings WHERE user_id = ? AND sym = ?").run(userId, sym);
  } else {
    const newBasis = Math.round(holding.cost_basis * (remaining / holding.qty));
    db.prepare("UPDATE holdings SET qty = ?, cost_basis = ? WHERE user_id = ? AND sym = ?").run(
      remaining, newBasis, userId, sym
    );
  }
  db.prepare("UPDATE users SET cash = cash + ? WHERE id = ?").run(proceeds, userId);
  return { proceeds };
});

// ---- leaderboard ----
export function getLeaderboard(limit = 10) {
  return db
    .prepare(
      `SELECT u.username, u.display,
              u.cash + COALESCE(SUM(h.qty * p.pts), 0) AS netWorth
       FROM users u
       LEFT JOIN holdings h ON h.user_id = u.id
       LEFT JOIN players p ON p.sym = h.sym
       GROUP BY u.id
       ORDER BY netWorth DESC
       LIMIT ?`
    )
    .all(limit);
}
