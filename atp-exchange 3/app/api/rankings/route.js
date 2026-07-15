import { NextResponse } from "next/server";
import { getPlayers, getMeta } from "../../../lib/db";
import { ensureSeeded } from "../../../lib/rankings";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  return NextResponse.json({
    players: getPlayers(),
    lastSync: Number(getMeta("lastSync") || 0),
    source: getMeta("lastSyncSource") || "seed",
    liveEnabled: !!process.env.ANTHROPIC_API_KEY,
  });
}
