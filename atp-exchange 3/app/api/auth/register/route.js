import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createUser, getUserByUsername } from "../../../../lib/db";
import { createSession } from "../../../../lib/auth";

export async function POST(req) {
  const { username, display, password } = await req.json().catch(() => ({}));
  const uname = String(username || "").toLowerCase().trim();
  if (!/^[a-z0-9_-]{3,20}$/.test(uname)) {
    return NextResponse.json({ error: "Username must be 3-20 characters: letters, numbers, - or _" }, { status: 400 });
  }
  if (!password || String(password).length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  if (getUserByUsername(uname)) {
    return NextResponse.json({ error: "That username is taken" }, { status: 409 });
  }
  const passHash = await bcrypt.hash(String(password), 10);
  const user = createUser({
    username: uname,
    display: String(display || "").trim().slice(0, 24) || uname,
    passHash,
  });
  createSession(user.id);
  return NextResponse.json({ user: { username: user.username, display: user.display, cash: user.cash } });
}
