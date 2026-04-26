import { NextResponse } from "next/server";
import { getLiveStatementFromSubscan } from "@/lib/subscan-statement-service";
import type { StatementInput } from "@/types/statement";

/**
 * Vercel Hobby and many plans cap at 300s. Vercel Pro/Enterprise can set up to 800s in
 * Project → Functions or `vercel.json` when you need longer than 5 minutes.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const apiKey = process.env.SUBSCAN_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing SUBSCAN_API_KEY in environment. Add it to .env.local." },
        { status: 500 },
      );
    }

    const input = (await request.json()) as StatementInput;
    if (!input?.walletAddress || !input?.network || !input?.startDate || !input?.endDate) {
      return NextResponse.json({ error: "Missing required statement fields." }, { status: 400 });
    }

    const statement = await getLiveStatementFromSubscan(input, apiKey);
    return NextResponse.json({ statement });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
