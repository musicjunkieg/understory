import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/auth/client";

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
      scope: "atproto transition:generic",
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
