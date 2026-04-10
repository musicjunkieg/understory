import { NextResponse } from "next/server";
import { buildClientMetadata } from "@/lib/auth/metadata";

export async function GET() {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    return NextResponse.json(
      { error: "APP_URL not configured" },
      { status: 500 },
    );
  }
  return NextResponse.json(buildClientMetadata(appUrl));
}
