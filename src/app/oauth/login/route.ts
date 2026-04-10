import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/auth/client";
import { OAUTH_SCOPE } from "@/lib/auth/metadata";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const handle = body.handle?.trim();

    if (!handle) {
      return NextResponse.json(
        { error: "Handle is required" },
        { status: 400 },
      );
    }

    const client = getOAuthClient();
    const url = await client.authorize(handle, {
      scope: OAUTH_SCOPE,
    });

    return NextResponse.json({ redirect: url.toString() });
  } catch (error) {
    console.error("OAuth login error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to start authentication",
      },
      { status: 400 },
    );
  }
}
