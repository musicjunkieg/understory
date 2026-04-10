import { cookies } from "next/headers";
import { Agent } from "@atproto/api";
import { getOAuthClient } from "./client";

const COOKIE_NAME = "understory_did";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

export async function getSessionDid(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

export async function getSession(): Promise<{
  agent: Agent;
  did: string;
} | null> {
  const did = await getSessionDid();
  if (!did) return null;

  try {
    const client = getOAuthClient();
    const session = await client.restore(did);
    const agent = new Agent(session);
    return { agent, did };
  } catch {
    // Session expired or revoked. Don't try to clear the cookie here —
    // Next.js only allows cookie modification in Route Handlers and Server
    // Actions, not during page renders. A stale cookie is harmless: the
    // user sees the login form, and logging in again overwrites it.
    // The cookie expires in 7 days anyway (COOKIE_MAX_AGE).
    return null;
  }
}

export async function setSessionCookie(did: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, did, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
