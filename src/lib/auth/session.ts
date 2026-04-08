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
    // Session expired or revoked — clear cookie
    await clearSessionCookie();
    return null;
  }
}

export async function setSessionCookie(did: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, did, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
