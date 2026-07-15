import { NextResponse } from "next/server";
import { getSessionUser } from "../../../lib/auth";
import { getHoldings } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ cash: user.cash, holdings: getHoldings(user.id) });
}
