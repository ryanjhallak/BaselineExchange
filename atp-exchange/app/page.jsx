"use client";

import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const C = {
  bg: "var(--bg)", panel: "var(--panel)", panelHi: "var(--panel-hi)", line: "var(--line)",
  text: "var(--text)", muted: "var(--muted)", yellow: "var(--yellow)", up: "var(--up)", down: "var(--down)",
};
const mono = "var(--mono)";
const disp = "var(--disp)";

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
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
      <polyline points={pts} fill="none" stroke={up ? "#3DDC84" : "#FF6B5E"} strokeWidth="1.5" />
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
    primary: { background: "#D8F435", color: "#0A1626" },
    ghost: { background: "transparent", color: "#D8F435", border: `1px solid #D8F435` },
    sell: { background: "#FF6B5E", color: "#20110F" },
  };
  return (
    <button type={type} style={{ ...base, ...kinds[kind] }} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

const inputStyle = {
  background: C.bg, color: C.text, border: `1px solid #22406A`, borderRadius: 4,
  padding: "8px 10px", fontFamily: mono, fontSize: 14, width: "100%",
};
const labelStyle = {
  fontSize: 12, color: C.muted, display: "block", marginBottom: 4,
  fontFamily: disp, textTransform: "uppercase", letterSpacing: "0.08em",
};
const panelStyle = { background: C.panel, border: `1px solid #22406A`, borderRadius: 6 };
const headingStyle = {
  fontFamily: disp, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 13, color: C.muted,
};

// ---------- auth screen ----------
function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [display, setDisplay] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const path = mode === "create" ? "/api/auth/register" : "/api/auth/login";
      const { user } = await api(path, {
        method: "POST",
        body: JSON.stringify({ username, display, password }),
      });
      onLogin(user);
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <form onSubmit={submit} style={{ ...panelStyle, padding: 24, width: "100%", maxWidth: 380 }}>
        <h1 style={{ fontFamily: disp, fontWeight: 700, fontSize: 30, margin: "0 0 2px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Baseline <span style={{ color: C.yellow }}>Exchange</span>
        </h1>
        <p style={{ color: C.muted, fontSize: 13, margin: "0 0 18px" }}>
          {mode === "create" ? "Set up a trading account to start your portfolio." : "Sign in to your trading account."}
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={labelStyle}>Username</label>
            <input style={inputStyle} value={username} autoComplete="username"
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20))}
              placeholder="e.g. clay_court_carl" />
          </div>
          {mode === "create" && (
            <div>
              <label style={labelStyle}>Display name (shown on the leaderboard)</label>
              <input style={inputStyle} value={display} onChange={(e) => setDisplay(e.target.value.slice(0, 24))} placeholder="Carl" />
            </div>
          )}
          <div>
            <label style={labelStyle}>Password (6+ characters)</label>
            <input style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)}
              type="password" autoComplete={mode === "create" ? "new-password" : "current-password"} placeholder="••••••" />
          </div>
          {err && <div style={{ color: C.down, fontSize: 13 }}>{err}</div>}
          <Btn type="submit" disabled={busy}>
            {busy ? "Working…" : mode === "create" ? "Create account" : "Sign in"}
          </Btn>
          <button type="button" onClick={() => { setMode(mode === "create" ? "login" : "create"); setErr(""); }}
            style={{ background: "none", border: "none", color: C.yellow, fontSize: 13, cursor: "pointer", padding: 0, textAlign: "left" }}>
            {mode === "create" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </div>
        <p style={{ color: C.muted, fontSize: 11, marginTop: 16, lineHeight: 1.5 }}>
          Passwords are hashed server-side and sessions use httpOnly cookies. Your display name and net worth
          appear on the public leaderboard.
        </p>
      </form>
    </div>
  );
}

// ---------- main page ----------
export default function Page() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const [players, setPlayers] = useState([]);
  const [lastSync, setLastSync] = useState(0);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [holdings, setHoldings] = useState([]);
  const [cash, setCash] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [selected, setSelected] = useState(null);
  const [qty, setQty] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const loadMarket = useCallback(async () => {
    const d = await api("/api/rankings");
    setPlayers(d.players);
    setLastSync(d.lastSync);
    setLiveEnabled(d.liveEnabled);
  }, []);

  const loadPortfolio = useCallback(async () => {
    const d = await api("/api/portfolio");
    setCash(d.cash);
    setHoldings(d.holdings);
  }, []);

  const loadLeaderboard = useCallback(async () => {
    const d = await api("/api/leaderboard");
    setLeaderboard(d.leaderboard);
  }, []);

  // session check + initial data
  useEffect(() => {
    (async () => {
      try {
        const { user: u } = await api("/api/auth/me");
        setUser(u);
        if (u) await Promise.all([loadMarket(), loadPortfolio(), loadLeaderboard()]);
      } catch {
        setUser(null);
      }
    })();
  }, [loadMarket, loadPortfolio, loadLeaderboard]);

  const onLogin = async (u) => {
    setUser(u);
    setError("");
    await Promise.all([loadMarket(), loadPortfolio(), loadLeaderboard()]);
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setHoldings([]);
  };

  const sync = async () => {
    setSyncing(true);
    setError("");
    try {
      await api("/api/rankings/sync?force=1", { method: "POST" });
      await Promise.all([loadMarket(), loadPortfolio(), loadLeaderboard()]);
    } catch (e) {
      setError(`Couldn't sync rankings: ${e.message}`);
    }
    setSyncing(false);
  };

  const trade = async (action, sym, quantity) => {
    setError("");
    try {
      const d = await api("/api/trade", { method: "POST", body: JSON.stringify({ action, sym, qty: quantity }) });
      setCash(d.cash);
      setHoldings(d.holdings);
      loadLeaderboard();
    } catch (e) {
      setError(e.message);
    }
  };

  if (user === undefined)
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: C.muted }}>Checking your session…</div>;
  if (user === null) return <AuthScreen onLogin={onLogin} />;

  const sorted = players;
  const player = players.find((p) => p.sym === selected) || sorted[0];
  const holdingsMap = Object.fromEntries(holdings.map((h) => [h.sym, h]));
  const holding = player && holdingsMap[player.sym];
  const portfolioValue = holdings.reduce((sum, h) => sum + h.pts * h.qty, 0);
  const netWorth = cash + portfolioValue;

  const lastDelta = (p) => {
    const h = p.history;
    return h.length > 1 ? h[h.length - 1].pts - h[h.length - 2].pts : 0;
  };

  const chartData = player ? player.history.map((x) => ({ date: x.date.slice(5), pts: x.pts })) : [];
  const lastSyncLabel = lastSync ? new Date(lastSync).toLocaleString() : "never";

  return (
    <>
      {/* ticker tape */}
      <div style={{ overflow: "hidden", borderBottom: `1px solid #22406A`, background: "#050D1A", whiteSpace: "nowrap", minHeight: 27 }}>
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
        <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 12, background: C.panelHi, border: `1px solid #22406A`, borderRadius: 20, padding: "4px 12px" }}>
          {user.display}
        </span>
        <Btn kind="ghost" small onClick={logout}>Sign out</Btn>
      </header>

      {error && (
        <div style={{ margin: "0 22px 12px", padding: "8px 12px", border: `1px solid #FF6B5E`, borderRadius: 6, color: C.down, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* stat strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "0 22px 16px" }}>
        {[["Cash", cash], ["Portfolio", portfolioValue], ["Net worth", netWorth]].map(([label, v]) => (
          <div key={label} style={{ ...panelStyle, padding: "10px 16px", minWidth: 140 }}>
            <div style={{ ...headingStyle, fontSize: 12 }}>{label}</div>
            <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 600 }}>
              {v.toLocaleString()} <span style={{ fontSize: 12, color: C.muted }}>pts</span>
            </div>
          </div>
        ))}
        <div style={{ ...panelStyle, padding: "10px 16px", flex: 1, minWidth: 240, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ ...headingStyle, fontSize: 12 }}>
              Rankings {liveEnabled ? "· live" : "· seed data (add ANTHROPIC_API_KEY for live)"}
            </div>
            <div style={{ fontSize: 12, color: C.muted, fontFamily: mono }}>last sync: {lastSyncLabel}</div>
          </div>
          <Btn onClick={sync} disabled={syncing}>{syncing ? "Syncing…" : "Sync now"}</Btn>
        </div>
      </div>

      <main className="layout">
        {/* market table */}
        <section style={{ ...panelStyle, overflow: "hidden" }}>
          <div style={{ ...headingStyle, padding: "10px 14px", borderBottom: `1px solid #22406A` }}>
            The market · ATP top {sorted.filter((p) => p.active).length || "—"}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <tbody>
                {sorted.map((p) => {
                  const d = lastDelta(p);
                  const prev = p.history.length > 1 ? p.history[p.history.length - 2].pts : p.pts;
                  const isSel = player && p.sym === player.sym;
                  return (
                    <tr key={p.sym} className="row" onClick={() => { setSelected(p.sym); setQty(1); }}
                      style={{ cursor: "pointer", borderBottom: `1px solid #22406A`, background: isSel ? C.panelHi : "transparent", opacity: p.active ? 1 : 0.55 }}>
                      <td style={{ padding: "9px 0 9px 14px", fontFamily: mono, color: C.muted, width: 34, fontSize: 12 }}>{p.rank ? `#${p.rank}` : "—"}</td>
                      <td style={{ padding: "9px 8px", fontFamily: mono, color: C.yellow, fontWeight: 600, width: 52 }}>{p.sym}</td>
                      <td style={{ padding: "9px 6px" }}>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>
                          {p.country}{holdingsMap[p.sym] ? ` · you own ${holdingsMap[p.sym].qty}` : ""}{p.active ? "" : " · out of top 16"}
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
        </section>

        {/* right column */}
        <div style={{ display: "grid", gap: 16 }}>
          {player && (
            <section style={{ ...panelStyle, padding: 14 }}>
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
                      <XAxis dataKey="date" tick={{ fill: "#8CA3C0", fontSize: 10 }} stroke="#22406A" />
                      <YAxis domain={["auto", "auto"]} tick={{ fill: "#8CA3C0", fontSize: 10 }} stroke="#22406A" />
                      <Tooltip contentStyle={{ background: "#152B47", border: `1px solid #22406A`, borderRadius: 4, fontSize: 12 }}
                        formatter={(v) => [`${v.toLocaleString()} pts`, "price"]} />
                      <Line type="monotone" dataKey="pts" stroke="#D8F435" strokeWidth={2} dot={{ r: 2, fill: "#D8F435" }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: "100%", display: "grid", placeItems: "center", color: C.muted, fontSize: 12, border: `1px dashed #22406A`, borderRadius: 4, textAlign: "center", padding: "0 12px" }}>
                    Price history builds one point per weekly sync — check back after the next rankings update.
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, color: C.muted }}>
                  Shares{" "}
                  <input type="number" min="1" value={qty}
                    onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ ...inputStyle, width: 62, padding: "6px 8px" }} />
                </label>
                <span style={{ fontFamily: mono, fontSize: 13, color: C.muted }}>cost {(player.pts * qty).toLocaleString()} pts</span>
                <Btn onClick={() => trade("buy", player.sym, qty)} disabled={player.pts * qty > cash}>Buy</Btn>
                {holding && <Btn kind="sell" onClick={() => trade("sell", player.sym, 1)}>Sell 1</Btn>}
              </div>
              {player.pts * qty > cash && (
                <div style={{ fontSize: 12, color: C.down, marginTop: 6 }}>Not enough cash — sell a holding or lower the share count.</div>
              )}
            </section>
          )}

          {/* portfolio */}
          <section style={{ ...panelStyle, padding: 14 }}>
            <div style={{ ...headingStyle, marginBottom: 8 }}>{user.display}&apos;s locker room</div>
            {holdings.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13 }}>No players yet. Pick one from the market and buy your first share.</div>
            ) : (
              holdings.map((h) => {
                const value = h.pts * h.qty;
                const pl = value - h.costBasis;
                return (
                  <div key={h.sym} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid #22406A` }}>
                    <span style={{ fontFamily: mono, color: C.yellow, fontWeight: 600, width: 42 }}>{h.sym}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{h.name} × {h.qty}</div>
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
                        value {value.toLocaleString()} · <Delta value={pl} pct={(pl / h.costBasis) * 100} />
                      </div>
                    </div>
                    <Btn kind="sell" small onClick={() => trade("sell", h.sym, h.qty)}>Sell all</Btn>
                  </div>
                );
              })
            )}
          </section>

          {/* leaderboard */}
          <section style={{ ...panelStyle, padding: 14 }}>
            <div style={{ ...headingStyle, marginBottom: 8 }}>Leaderboard</div>
            {leaderboard.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13 }}>No traders yet.</div>
            ) : (
              leaderboard.map((r, i) => (
                <div key={r.username} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: `1px solid #22406A`, alignItems: "baseline" }}>
                  <span style={{ fontFamily: mono, color: C.muted, width: 22, fontSize: 12 }}>#{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: r.username === user.username ? C.yellow : C.text }}>
                    {r.display}{r.username === user.username ? " (you)" : ""}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 13 }}>{Number(r.netWorth).toLocaleString()} pts</span>
                </div>
              ))
            )}
          </section>
        </div>
      </main>

      <footer style={{ padding: "0 22px 20px", color: C.muted, fontSize: 11 }}>
        Prices are ATP ranking-point totals. With an Anthropic API key configured, each sync fetches the real live
        rankings via web search; official rankings update on Mondays. All portfolios and the leaderboard live in the app&apos;s database.
      </footer>
    </>
  );
}
