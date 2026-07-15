import { NextResponse } from "next/server";
import { getSessionUser } from "../../../lib/auth";
import { buyShares, sellShares, getUserById, getHoldings } from "../../../lib/db";

export async function POST(req) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { action, sym, qty } = await req.json().catch(() => ({}));
  const quantity = Number(qty);
  try {
    if (action === "buy") buyShares(user.id, String(sym), quantity);
    else if (action === "sell") sellShares(user.id, String(sym), quantity);
    else return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    const fresh = getUserById(user.id);
    return NextResponse.json({ cash: fresh.cash, holdings: getHoldings(user.id) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
