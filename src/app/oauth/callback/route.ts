import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/auth/client";
import { setSessionCookie } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const appUrl = process.env.APP_URL ?? "";

  try {
    const params = new URL(request.url).searchParams;

    // Check for auth denial
    if (params.get("error")) {
      console.error("OAuth denied:", params.get("error_description"));
      return NextResponse.redirect(`${appUrl}/?error=auth_denied`);
    }

    const client = getOAuthClient();
    const { session } = await client.callback(params);
    const did = session.did;

    // Set auth cookie
    await setSessionCookie(did);

    // Redirect to talks for now — /for/:handle doesn't exist yet
    const redirectPath = "/talks";

    return NextResponse.redirect(`${appUrl}${redirectPath}`);
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(`${appUrl}/?error=auth_failed`);
  }
}
