import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUserByUsername } from "../../../../lib/db";
import { createSession } from "../../../../lib/auth";

export async function POST(req) {
  const { username, password } = await req.json().catch(() => ({}));
  const user = getUserByUsername(String(username || "").toLowerCase().trim());
  if (!user || !(await bcrypt.compare(String(password || ""), user.pass_hash))) {
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
  }
  createSession(user.id);
  return NextResponse.json({ user: { username: user.username, display: user.display, cash: user.cash } });
}
