import { getPlayers, upsertPlayer, deactivatePlayersNotIn, getMeta, setMeta } from "./db";

const MIN_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour between live fetches

// Fallback data so the app works with no API key configured (approximate snapshot).
const SEED = [
  { rank: 1, name: "Carlos Alcaraz", country: "ESP", points: 12050 },
  { rank: 2, name: "Jannik Sinner", country: "ITA", points: 11480 },
  { rank: 3, name: "Alexander Zverev", country: "GER", points: 4830 },
  { rank: 4, name: "Taylor Fritz", country: "USA", points: 4695 },
  { rank: 5, name: "Jack Draper", country: "GBR", points: 4580 },
  { rank: 6, name: "Ben Shelton", country: "USA", points: 4210 },
  { rank: 7, name: "Novak Djokovic", country: "SRB", points: 4030 },
  { rank: 8, name: "Lorenzo Musetti", country: "ITA", points: 3925 },
  { rank: 9, name: "Casper Ruud", country: "NOR", points: 3785 },
  { rank: 10, name: "Alex de Minaur", country: "AUS", points: 3610 },
  { rank: 11, name: "Holger Rune", country: "DEN", points: 3120 },
  { rank: 12, name: "Daniil Medvedev", country: "RUS", points: 2980 },
  { rank: 13, name: "Tommy Paul", country: "USA", points: 2905 },
  { rank: 14, name: "Andrey Rublev", country: "RUS", points: 2610 },
  { rank: 15, name: "Jakub Mensik", country: "CZE", points: 2440 },
  { rank: 16, name: "Joao Fonseca", country: "BRA", points: 2280 },
];

const norm = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, "").trim();

const sameName = (a, b) => {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  const la = na.split(" ").pop(), lb = nb.split(" ").pop();
  return la === lb && na[0] === nb[0];
};

function makeSym(name, taken) {
  const last = norm(name).split(" ").pop() || "plr";
  let sym = last.slice(0, 3).toUpperCase();
  let i = 3;
  while (taken.has(sym) && i < last.length) {
    sym = (last.slice(0, 2) + last[i]).toUpperCase();
    i++;
  }
  while (taken.has(sym)) sym = sym.slice(0, 2) + Math.floor(Math.random() * 10);
  return sym;
}

async function fetchViaAnthropic() {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
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
  if (data.error) throw new Error(data.error.message || "Anthropic API error");
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .replace(/```json|```/g, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No rankings found in model response");
  const arr = JSON.parse(text.slice(start, end + 1));
  const clean = arr.filter((p) => p && p.name && Number(p.points) > 0);
  if (clean.length < 8) throw new Error("Rankings came back incomplete");
  return clean.map((p) => ({ ...p, points: Math.round(Number(p.points)) }));
}

export async function syncRankings({ force = false } = {}) {
  const last = Number(getMeta("lastSync") || 0);
  const hasKey = !!process.env.ANTHROPIC_API_KEY;

  if (hasKey && !force && Date.now() - last < MIN_SYNC_INTERVAL) {
    return { synced: false, reason: "recent", lastSync: last };
  }

  const rankings = hasKey ? await fetchViaAnthropic() : SEED;
  const today = new Date().toISOString().slice(0, 10);
  const existing = getPlayers();
  const taken = new Set(existing.map((p) => p.sym));
  const activeSyms = [];

  for (const r of rankings) {
    const match = existing.find((p) => sameName(p.name, r.name));
    let sym, history;
    if (match) {
      sym = match.sym;
      const lastPoint = match.history[match.history.length - 1];
      history =
        lastPoint && lastPoint.date === today
          ? [...match.history.slice(0, -1), { date: today, pts: r.points }]
          : [...match.history.slice(-119), { date: today, pts: r.points }];
    } else {
      sym = makeSym(r.name, taken);
      taken.add(sym);
      history = [{ date: today, pts: r.points }];
    }
    activeSyms.push(sym);
    upsertPlayer({
      sym,
      name: r.name,
      country: r.country || (match ? match.country : ""),
      rank: r.rank,
      pts: r.points,
      active: true,
      history,
    });
  }

  deactivatePlayersNotIn(activeSyms);
  setMeta("lastSync", Date.now());
  setMeta("lastSyncSource", hasKey ? "live" : "seed");
  return { synced: true, source: hasKey ? "live" : "seed", count: rankings.length };
}

export async function ensureSeeded() {
  if (getPlayers().length === 0) {
    await syncRankings({ force: true });
  }
}
