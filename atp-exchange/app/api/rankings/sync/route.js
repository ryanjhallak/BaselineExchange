import { NextResponse } from "next/server";
import { getSessionUser } from "../../../../lib/auth";
import { syncRankings } from "../../../../lib/rankings";

export async function POST(req) {
  if (!getSessionUser()) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    const result = await syncRankings({ force });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
