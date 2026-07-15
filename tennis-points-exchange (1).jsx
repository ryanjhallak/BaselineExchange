import React, { useState, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// ---------- theme ----------
const C = {
  bg: "#081426", panel: "#0F2138", panelHi: "#152B47", line: "#22406A",
  text: "#E9F0FA", muted: "#8CA3C0", yellow: "#D8F435", up: "#3DDC84", down: "#FF6B5E",
};
const mono = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const disp = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const body = "'Barlow', system-ui, sans-serif";

const START_CASH = 30000;
const STALE_MS = 24 * 60 * 60 * 1000;
const LEGACY_KEY = "tennis-exchange-live-v2";

// storage keys
const metaKey = (u) => `acct-meta:${u}`;
const stateKey = (u) => `acct-state:${u}`;
const SESSION_KEY = "session-current";
const lbKey = (u) => `lb:${u}`;

// ---------- helpers ----------
const norm = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, "").trim();

const sameName = (a, b) => {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  const la = na.split(" ").pop(), lb = nb.split(" ").pop();
  return la === lb && na[0] === nb[0];
};

const cleanUsername = (s) => (s || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20);

async function hashPin(uname, pin) {
  const data = new TextEncoder().encode(`${uname}:${pin}:baseline-exchange`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function makeSym(name, players) {
  const last = norm(name).split(" ").pop() || "plr";
  let sym = last.slice(0, 3).toUpperCase();
  let i = 3;
  while (players.some((p) => p.sym === sym) && i < last.length) {
    sym = (last.slice(0, 2) + last[i]).toUpperCase();
    i++;
  }
  while (players.some((p) => p.sym === sym)) sym = sym.slice(0, 2) + Math.floor(Math.random() * 10);
  return sym;
}

function freshState() {
  return { cash: START_CASH, players: [], holdings: {}, news: [], lastSync: 0 };
}

// ---------- live rankings via the Anthropic API + web search ----------
async function fetchRankings() {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content:
            'Search the web for the current official ATP men\'s singles tennis rankings (the live points from atptour.com or a reliable mirror). Then respond with ONLY a raw JSON array of the top 16 players and nothing else — no markdown fences, no commentary. Format: [{"rank":1,"name":"Full Name","country":"3-letter IOC code","points":12345}]. "points" must be the integer ATP ranking points total.',
        },
      ],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "API error");
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .replace(/```json|```/g, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No rankings found in response");
  const arr = JSON.parse(text.slice(start, end + 1));
  const clean = arr.filter((p) => p && p.name && Number(p.points) > 0);
  if (clean.length < 8) throw new Error("Rankings came back incomplete");
  return clean.map((p) => ({ ...p, points: Math.round(Number(p.points)) }));
}

function mergeRankings(state, rankings) {
  const today = new Date().toISOString().slice(0, 10);
  const players = state.players.map((p) => ({ ...p, active: false }));
  const moves = [];

  rankings.forEach((r) => {
    const idx = players.findIndex((p) => sameName(p.name, r.name));
    if (idx >= 0) {
      const p = players[idx];
      const delta = r.points - p.pts;
      if (delta !== 0) moves.push({ name: p.name, delta });
      const last = p.history[p.history.length - 1];
      const history =
        last && last.date === today
          ? [...p.history.slice(0, -1), { date: today, pts: r.points }]
          : [...p.history.slice(-59), { date: today, pts: r.points }];
      players[idx] = { ...p, pts: r.points, rank: r.rank, country: r.country || p.country, active: true, history };
    } else {
      players.push({
        sym: makeSym(r.name, players), name: r.name, country: r.country || "",
        pts: r.points, rank: r.rank, active: true, history: [{ date: today, pts: r.points }],
      });
    }
  });

  moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const moverLine = moves.length
    ? "Movers: " + moves.slice(0, 3).map((m) => `${m.name} ${m.delta > 0 ? "+" : ""}${m.delta.toLocaleString()}`).join(", ")
    : "No point changes since last sync.";
  const news = [`Rankings synced ${today}. ${moverLine}`, ...state.news].slice(0, 8);

  return { ...state, players, news, lastSync: Date.now() };
}

// ---------- small components ----------
function Spark({ history, w = 96, h = 28 }) {
  const vals = history.map((x) => x.pts);
  if (vals.length < 2)
    return (
      <svg width={w} height={h} style={{ display: "block" }}>
        <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke={C.line} strokeDasharray="3 3" />
      </svg>
    );
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={up ? C.up : C.down} strokeWidth="1.5" />
    </svg>
  );
}

function Delta({ value, pct }) {
  const up = value >= 0;
  return (
    <span style={{ color: up ? C.up : C.down, fontFamily: mono, fontSize: 12 }}>
      {up ? "▲" : "▼"} {Math.abs(value).toLocaleString()}
      {pct !== undefined && isFinite(pct) ? ` (${Math.abs(pct).toFixed(1)}%)` : ""}
    </span>
  );
}

function Btn({ children, onClick, kind = "primary", disabled, small, type = "button" }) {
  const base = {
    fontFamily: disp, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
    border: "none", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1,
    borderRadius: 4, padding: small ? "5px 12px" : "9px 18px", fontSize: small ? 13 : 15,
  };
  const kinds = {
    primary: { background: C.yellow, color: "#0A1626" },
    ghost: { background: "transparent", color: C.yellow, border: `1px solid ${C.yellow}` },
    sell: { background: C.down, color: "#20110F" },
  };
  return (
    <button type={type} style={{ ...base, ...kinds[kind] }} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

const inputStyle = {
  background: C.bg, color: C.text, border: `1px solid ${C.line}`, borderRadius: 4,
  padding: "8px 10px", fontFamily: mono, fontSize: 14, width: "100%", boxSizing: "border-box",
};
const labelStyle = { fontSize: 12, color: C.muted, display: "block", marginBottom: 4, fontFamily: disp, textTransform: "uppercase", letterSpacing: "0.08em" };

// ---------- auth screen ----------
function AuthScreen({ onLogin }) {
  const [accounts, setAccounts] = useState(null);
  const [mode, setMode] = useState("login"); // login | create
  const [uname, setUname] = useState("");
  const [display, setDisplay] = useState("");
  const [pin, setPin] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.list("acct-meta:");
        const keys = (res && res.keys) || [];
        const metas = [];
        for (const k of keys.slice(0, 20)) {
          try {
            const m = await window.storage.get(k);
            if (m && m.value) metas.push(JSON.parse(m.value));
          } catch {}
        }
        setAccounts(metas);
        if (metas.length === 0) setMode("create");
      } catch {
        setAccounts([]);
        setMode("create");
      }
    })();
  }, []);

  const submit = async () => {
    setErr("");
    const u = cleanUsername(uname);
    if (!u) return setErr("Pick a username (letters, numbers, - or _).");
    if (!/^\d{4,8}$/.test(pin)) return setErr("PIN must be 4–8 digits.");
    setBusy(true);
    try {
      if (mode === "create") {
        let exists = false;
        try {
          const m = await window.storage.get(metaKey(u));
          exists = !!(m && m.value);
        } catch {}
        if (exists) { setErr("That username is taken on this device."); setBusy(false); return; }
        const meta = { uname: u, display: display.trim() || u, pinHash: await hashPin(u, pin), created: Date.now() };
        await window.storage.set(metaKey(u), JSON.stringify(meta));
        // adopt a pre-accounts save if one exists, so nothing is lost
        let initial = freshState();
        try {
          const legacy = await window.storage.get(LEGACY_KEY);
          if (legacy && legacy.value) {
            initial = JSON.parse(legacy.value);
            await window.storage.delete(LEGACY_KEY);
          }
        } catch {}
        await window.storage.set(stateKey(u), JSON.stringify(initial));
        if (remember) await window.storage.set(SESSION_KEY, u);
        onLogin(meta);
      } else {
        let meta = null;
        try {
          const m = await window.storage.get(metaKey(u));
          if (m && m.value) meta = JSON.parse(m.value);
        } catch {}
        if (!meta) { setErr("No account with that username. Create one?"); setBusy(false); return; }
        const h = await hashPin(u, pin);
        if (h !== meta.pinHash) { setErr("Wrong PIN."); setBusy(false); return; }
        if (remember) await window.storage.set(SESSION_KEY, u);
        onLogin(meta);
      }
    } catch (e) {
      setErr("Something went wrong saving the account. Try again.");
    }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 24, width: "100%", maxWidth: 380 }}>
        <h1 style={{ fontFamily: disp, fontWeight: 700, fontSize: 30, margin: "0 0 2px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Baseline <span style={{ color: C.yellow }}>Exchange</span>
        </h1>
        <p style={{ color: C.muted, fontSize: 13, margin: "0 0 18px" }}>
          {mode === "create" ? "Set up a trading account to start your portfolio." : "Sign in to your trading account."}
        </p>

        {accounts && accounts.length > 0 && mode === "login" && (
          <div style={{ marginBottom: 14 }}>
            <span style={labelStyle}>Profiles on this device</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {accounts.map((a) => (
                <button key={a.uname} onClick={() => setUname(a.uname)}
                  style={{
                    fontFamily: mono, fontSize: 12, padding: "5px 10px", borderRadius: 20, cursor: "pointer",
                    background: uname === a.uname ? C.yellow : "transparent",
                    color: uname === a.uname ? "#0A1626" : C.text, border: `1px solid ${uname === a.uname ? C.yellow : C.line}`,
                  }}>
                  {a.display}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={labelStyle}>Username</label>
            <input style={inputStyle} value={uname} onChange={(e) => setUname(cleanUsername(e.target.value))}
              placeholder="e.g. clay_court_carl" autoComplete="off" />
          </div>
          {mode === "create" && (
            <div>
              <label style={labelStyle}>Display name (shown on the leaderboard)</label>
              <input style={inputStyle} value={display} onChange={(e) => setDisplay(e.target.value.slice(0, 24))} placeholder="Carl" />
            </div>
          )}
          <div>
            <label style={labelStyle}>PIN (4–8 digits)</label>
            <input style={inputStyle} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              type="password" inputMode="numeric" placeholder="••••"
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>
          <label style={{ fontSize: 12, color: C.muted, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Keep me signed in on this device
          </label>
          {err && <div style={{ color: C.down, fontSize: 13 }}>{err}</div>}
          <Btn onClick={submit} disabled={busy}>
            {busy ? "Working…" : mode === "create" ? "Create account" : "Sign in"}
          </Btn>
          <button onClick={() => { setMode(mode === "create" ? "login" : "create"); setErr(""); }}
            style={{ background: "none", border: "none", color: C.yellow, fontSize: 13, cursor: "pointer", padding: 0, textAlign: "left" }}>
            {mode === "create" ? "Already have a profile? Sign in" : "New here? Create an account"}
          </button>
        </div>

        <p style={{ color: C.muted, fontSize: 11, marginTop: 16, lineHeight: 1.5 }}>
          Profiles live in your Claude storage on this account — this is game-level protection, not real security, so don't reuse a
          sensitive PIN. Your display name and net worth are published to a leaderboard visible to other players of this app.
        </p>
      </div>
    </div>
  );
}

// ---------- leaderboard ----------
function Leaderboard({ me, refreshFlag }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.list("lb:", true);
        const keys = ((res && res.keys) || []).slice(0, 25);
        const entries = [];
        for (const k of keys) {
          try {
            const r = await window.storage.get(k, true);
            if (r && r.value) entries.push(JSON.parse(r.value));
          } catch {}
        }
        entries.sort((a, b) => b.netWorth - a.netWorth);
        setRows(entries.slice(0, 10));
      } catch {
        setRows([]);
      }
    })();
  }, [refreshFlag]);

  return (
    <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, padding: 14 }}>
      <div style={{ fontFamily: disp, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 13, color: C.muted, marginBottom: 8 }}>
        Leaderboard · all players
      </div>
      {!rows ? (
        <div style={{ color: C.muted, fontSize: 13 }}>Loading standings…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13 }}>No entries yet — your net worth will post here after your first trade.</div>
      ) : (
        rows.map((r, i) => (
          <div key={r.uname || i} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: `1px solid ${C.line}`, alignItems: "baseline" }}>
            <span style={{ fontFamily: mono, color: C.muted, width: 22, fontSize: 12 }}>#{i + 1}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: r.uname === me ? C.yellow : C.text }}>
              {r.display}{r.uname === me ? " (you)" : ""}
            </span>
            <span style={{ fontFamily: mono, fontSize: 13 }}>{Number(r.netWorth).toLocaleString()} pts</span>
          </div>
        ))
      )}
      <p style={{ color: C.muted, fontSize: 10, margin: "8px 0 0" }}>Shared across everyone using this app.</p>
    </section>
  );
}

// ---------- game ----------
function Game({ account, onLogout }) {
  const [state, setState] = useState(null);
  const [selected, setSelected] = useState(null);
  const [qty, setQty] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [lbRefresh, setLbRefresh] = useState(0);
  const loaded = useRef(false);
  const syncingRef = useRef(false);

  const sync = async (current) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setError("");
    try {
      const rankings = await fetchRankings();
      setState((s) => mergeRankings(s || current || freshState(), rankings));
    } catch (e) {
      setError(`Couldn't fetch live rankings (${e.message}). Showing last saved prices — try Sync again.`);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  };

  useEffect(() => {
    (async () => {
      let s = freshState();
      try {
        const res = await window.storage.get(stateKey(account.uname));
        if (res && res.value) s = JSON.parse(res.value);
      } catch {}
      setState(s);
      loaded.current = true;
      if (Date.now() - (s.lastSync || 0) > STALE_MS) sync(s);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.uname]);

  // persist + publish leaderboard entry on change
  useEffect(() => {
    if (!loaded.current || !state) return;
    (async () => {
      try {
        setSaving("saving…");
        await window.storage.set(stateKey(account.uname), JSON.stringify(state));
        const pv = Object.entries(state.holdings).reduce((sum, [sym, h]) => {
          const p = state.players.find((x) => x.sym === sym);
          return sum + (p ? p.pts * h.qty : 0);
        }, 0);
        await window.storage.set(
          lbKey(account.uname),
          JSON.stringify({ uname: account.uname, display: account.display, netWorth: state.cash + pv, ts: Date.now() }),
          true
        );
        setSaving("saved");
        setLbRefresh((n) => n + 1);
      } catch {
        setSaving("save failed");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!state)
    return (
      <div style={{ minHeight: "60vh", color: C.muted, display: "grid", placeItems: "center", fontFamily: body }}>
        Loading your portfolio…
      </div>
    );

  const sorted = [...state.players].sort((a, b) => (a.rank || 999) - (b.rank || 999));
  const player = state.players.find((p) => p.sym === selected) || sorted[0];
  const holding = player && state.holdings[player.sym];
  const portfolioValue = Object.entries(state.holdings).reduce((sum, [sym, h]) => {
    const p = state.players.find((x) => x.sym === sym);
    return sum + (p ? p.pts * h.qty : 0);
  }, 0);
  const netWorth = state.cash + portfolioValue;

  const buy = () => {
    if (!player) return;
    const cost = player.pts * qty;
    if (cost > state.cash || qty < 1) return;
    setState((s) => {
      const h = s.holdings[player.sym] || { qty: 0, costBasis: 0 };
      return {
        ...s, cash: s.cash - cost,
        holdings: { ...s.holdings, [player.sym]: { qty: h.qty + qty, costBasis: h.costBasis + cost } },
      };
    });
  };

  const sell = (sym, sellQty) => {
    setState((s) => {
      const h = s.holdings[sym];
      if (!h || sellQty > h.qty) return s;
      const p = s.players.find((x) => x.sym === sym);
      const proceeds = p.pts * sellQty;
      const remaining = h.qty - sellQty;
      const holdings = { ...s.holdings };
      if (remaining === 0) delete holdings[sym];
      else holdings[sym] = { qty: remaining, costBasis: h.costBasis * (remaining / h.qty) };
      return { ...s, cash: s.cash + proceeds, holdings };
    });
  };

  const resetPortfolio = () => {
    setState((s) => ({ ...s, cash: START_CASH, holdings: {}, news: ["Portfolio reset.", ...s.news].slice(0, 8) }));
  };

  const lastDelta = (p) => {
    const h = p.history;
    return h.length > 1 ? h[h.length - 1].pts - h[h.length - 2].pts : 0;
  };

  const chartData = player ? player.history.map((x) => ({ date: x.date.slice(5), pts: x.pts })) : [];
  const lastSyncLabel = state.lastSync ? new Date(state.lastSync).toLocaleString() : "never";

  return (
    <>
      {/* ticker tape */}
      <div style={{ overflow: "hidden", borderBottom: `1px solid ${C.line}`, background: "#050D1A", whiteSpace: "nowrap", minHeight: 27 }}>
        {sorted.length > 0 && (
          <div className="tape" style={{ display: "inline-block", animation: "tickerScroll 40s linear infinite", padding: "6px 0" }}>
            {[...sorted, ...sorted].map((p, i) => {
              const d = lastDelta(p);
              return (
                <span key={i} style={{ fontFamily: mono, fontSize: 12, marginRight: 28 }}>
                  <span style={{ color: C.yellow }}>{p.sym}</span>{" "}
                  <span style={{ color: C.text }}>{p.pts.toLocaleString()}</span>{" "}
                  <span style={{ color: d >= 0 ? C.up : C.down }}>{d >= 0 ? "▲" : "▼"}{Math.abs(d).toLocaleString()}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* header */}
      <header style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "18px 22px 10px" }}>
        <h1 style={{ fontFamily: disp, fontWeight: 700, fontSize: 34, margin: 0, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Baseline <span style={{ color: C.yellow }}>Exchange</span>
        </h1>
        <span style={{ color: C.muted, fontSize: 13 }}>trade players at their real ATP ranking points</span>
        <span style={{ marginLeft: "auto", color: C.muted, fontFamily: mono, fontSize: 11 }}>{saving}</span>
        <span style={{ fontFamily: mono, fontSize: 12, background: C.panelHi, border: `1px solid ${C.line}`, borderRadius: 20, padding: "4px 12px" }}>
          {account.display}
        </span>
        <Btn kind="ghost" small onClick={onLogout}>Sign out</Btn>
      </header>

      {error && (
        <div style={{ margin: "0 22px 12px", padding: "8px 12px", border: `1px solid ${C.down}`, borderRadius: 6, color: C.down, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* stat strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "0 22px 16px" }}>
        {[["Cash", state.cash], ["Portfolio", portfolioValue], ["Net worth", netWorth]].map(([label, v]) => (
          <div key={label} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 16px", minWidth: 140 }}>
            <div style={{ fontFamily: disp, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 12, color: C.muted }}>{label}</div>
            <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 600 }}>
              {v.toLocaleString()} <span style={{ fontSize: 12, color: C.muted }}>pts</span>
            </div>
          </div>
        ))}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 16px", flex: 1, minWidth: 240, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontFamily: disp, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 12, color: C.muted }}>Live rankings</div>
            <div style={{ fontSize: 12, color: C.muted, fontFamily: mono }}>last sync: {lastSyncLabel}</div>
          </div>
          <Btn onClick={() => sync()} disabled={syncing}>{syncing ? "Syncing…" : "Sync now"}</Btn>
        </div>
      </div>

      <main className="layout">
        {/* market table */}
        <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", fontFamily: disp, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 13, color: C.muted, borderBottom: `1px solid ${C.line}` }}>
            The market · ATP top {sorted.filter((p) => p.active !== false).length || "—"}
          </div>
          {sorted.length === 0 ? (
            <div style={{ padding: 20, color: C.muted, fontSize: 13 }}>
              {syncing ? "Fetching the live ATP rankings…" : "No rankings yet. Hit Sync now to pull the live ATP top 16."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <tbody>
                  {sorted.map((p) => {
                    const d = lastDelta(p);
                    const prev = p.history.length > 1 ? p.history[p.history.length - 2].pts : p.pts;
                    const isSel = player && p.sym === player.sym;
                    return (
                      <tr key={p.sym} className="row" onClick={() => { setSelected(p.sym); setQty(1); }}
                        style={{ cursor: "pointer", borderBottom: `1px solid ${C.line}`, background: isSel ? C.panelHi : "transparent", opacity: p.active === false ? 0.55 : 1 }}>
                        <td style={{ padding: "9px 0 9px 14px", fontFamily: mono, color: C.muted, width: 34, fontSize: 12 }}>{p.rank ? `#${p.rank}` : "—"}</td>
                        <td style={{ padding: "9px 8px", fontFamily: mono, color: C.yellow, fontWeight: 600, width: 52 }}>{p.sym}</td>
                        <td style={{ padding: "9px 6px" }}>
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: C.muted }}>
                            {p.country}{state.holdings[p.sym] ? ` · you own ${state.holdings[p.sym].qty}` : ""}{p.active === false ? " · out of top 16" : ""}
                          </div>
                        </td>
                        <td style={{ padding: "9px 6px" }}><Spark history={p.history.slice(-24)} /></td>
                        <td style={{ padding: "9px 6px", textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{p.pts.toLocaleString()}</td>
                        <td style={{ padding: "9px 14px 9px 6px", textAlign: "right", width: 110 }}><Delta value={d} pct={(d / prev) * 100} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* right column */}
        <div style={{ display: "grid", gap: 16 }}>
          {player && (
            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h2 style={{ fontFamily: disp, textTransform: "uppercase", fontSize: 22, margin: 0, letterSpacing: "0.03em" }}>
                  {player.name} <span style={{ color: C.yellow, fontFamily: mono, fontSize: 14 }}>{player.sym}</span>
                </h2>
                <span style={{ fontFamily: mono, fontSize: 18, fontWeight: 600 }}>{player.pts.toLocaleString()}</span>
              </div>
              <div style={{ height: 150, marginTop: 8 }}>
                {chartData.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -14 }}>
                      <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 10, fontFamily: mono }} stroke={C.line} />
                      <YAxis domain={["auto", "auto"]} tick={{ fill: C.muted, fontSize: 10, fontFamily: mono }} stroke={C.line} />
                      <Tooltip contentStyle={{ background: C.panelHi, border: `1px solid ${C.line}`, borderRadius: 4, fontFamily: mono, fontSize: 12 }}
                        formatter={(v) => [`${v.toLocaleString()} pts`, "price"]} />
                      <Line type="monotone" dataKey="pts" stroke={C.yellow} strokeWidth={2} dot={{ r: 2, fill: C.yellow }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: "100%", display: "grid", placeItems: "center", color: C.muted, fontSize: 12, border: `1px dashed ${C.line}`, borderRadius: 4, textAlign: "center", padding: "0 12px" }}>
                    Price history builds one point per weekly sync — check back after the next rankings update.
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, color: C.muted }}>
                  Shares{" "}
                  <input type="number" min="1" value={qty}
                    onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ width: 62, background: C.bg, color: C.text, border: `1px solid ${C.line}`, borderRadius: 4, padding: "6px 8px", fontFamily: mono }} />
                </label>
                <span style={{ fontFamily: mono, fontSize: 13, color: C.muted }}>cost {(player.pts * qty).toLocaleString()} pts</span>
                <Btn onClick={buy} disabled={player.pts * qty > state.cash}>Buy</Btn>
                {holding && <Btn kind="sell" onClick={() => sell(player.sym, 1)}>Sell 1</Btn>}
              </div>
              {player.pts * qty > state.cash && (
                <div style={{ fontSize: 12, color: C.down, marginTop: 6 }}>Not enough cash — sell a holding or lower the share count.</div>
              )}
            </section>
          )}

          {/* portfolio */}
          <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, padding: 14 }}>
            <div style={{ fontFamily: disp, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 13, color: C.muted, marginBottom: 8 }}>
              {account.display}'s locker room
            </div>
            {Object.keys(state.holdings).length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13 }}>No players yet. Pick one from the market and buy your first share.</div>
            ) : (
              Object.entries(state.holdings).map(([sym, h]) => {
                const p = state.players.find((x) => x.sym === sym);
                if (!p) return null;
                const value = p.pts * h.qty;
                const pl = value - h.costBasis;
                return (
                  <div key={sym} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ fontFamily: mono, color: C.yellow, fontWeight: 600, width: 42 }}>{sym}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name} × {h.qty}</div>
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
                        value {value.toLocaleString()} · <Delta value={pl} pct={(pl / h.costBasis) * 100} />
                      </div>
                    </div>
                    <Btn kind="sell" small onClick={() => sell(sym, h.qty)}>Sell all</Btn>
                  </div>
                );
              })
            )}
          </section>

          <Leaderboard me={account.uname} refreshFlag={lbRefresh} />

          {/* news */}
          <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, padding: 14 }}>
            <div style={{ fontFamily: disp, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 13, color: C.muted, marginBottom: 8 }}>
              Tour wire
            </div>
            {state.news.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13 }}>Sync history will show up here after each rankings update.</div>
            ) : (
              state.news.map((n, i) => (
                <div key={i} style={{ fontSize: 13, padding: "5px 0", color: i === 0 ? C.text : C.muted, borderBottom: `1px solid ${C.line}` }}>
                  {n}
                </div>
              ))
            )}
            <div style={{ marginTop: 12 }}>
              <Btn kind="ghost" small onClick={resetPortfolio}>Reset portfolio</Btn>
            </div>
          </section>
        </div>
      </main>

      <footer style={{ padding: "0 22px 20px", color: C.muted, fontSize: 11 }}>
        Prices are the real ATP ranking-point totals, fetched live via web search each sync. Official rankings update on Mondays.
        Your portfolio saves to your account automatically; your display name and net worth appear on the shared leaderboard.
      </footer>
    </>
  );
}

// ---------- root ----------
export default function TennisExchange() {
  const [account, setAccount] = useState(null);
  const [checking, setChecking] = useState(true);

  // resume a remembered session
  useEffect(() => {
    (async () => {
      try {
        const s = await window.storage.get(SESSION_KEY);
        if (s && s.value) {
          const m = await window.storage.get(metaKey(s.value));
          if (m && m.value) setAccount(JSON.parse(m.value));
        }
      } catch {}
      setChecking(false);
    })();
  }, []);

  const logout = async () => {
    try { await window.storage.delete(SESSION_KEY); } catch {}
    setAccount(null);
  };

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;600&family=IBM+Plex+Mono:wght@400;600&display=swap');
        @keyframes tickerScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .tape { animation: none !important; } }
        tr.row:hover { background: ${C.panelHi}; }
        input:focus, button:focus-visible { outline: 2px solid ${C.yellow}; outline-offset: 1px; }
        .layout { display: grid; grid-template-columns: minmax(340px, 1.4fr) minmax(300px, 1fr); gap: 16px; padding: 0 22px 24px; align-items: start; }
        @media (max-width: 760px) { .layout { grid-template-columns: 1fr; padding: 0 12px 20px; } }
      `}</style>
      {checking ? (
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: C.muted }}>Checking your session…</div>
      ) : account ? (
        <Game account={account} onLogout={logout} />
      ) : (
        <AuthScreen onLogin={setAccount} />
      )}
    </div>
  );
}
