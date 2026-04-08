import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";

export async function POST() {
  await clearSessionCookie();
  const appUrl = process.env.APP_URL ?? "";
  return NextResponse.redirect(`${appUrl}/`);
}
