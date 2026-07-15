import crypto from "crypto";
import { cookies } from "next/headers";
import { getUserById } from "./db";

const SECRET = process.env.AUTH_SECRET || "dev-secret-change-me-in-production";
const COOKIE = "atp_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sign(payloadB64) {
  return crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
}

export function createSession(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export function clearSession() {
  cookies().delete(COOKIE);
}

export function getSessionUser() {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.uid || data.exp < Date.now()) return null;
    const user = getUserById(data.uid);
    return user || null;
  } catch {
    return null;
  }
}
