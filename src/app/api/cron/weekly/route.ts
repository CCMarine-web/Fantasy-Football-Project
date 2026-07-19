import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { generateWeeklyContent } from "@/server/ai/weekly-pipeline";

// Weekly cron: sync fresh Sleeper data, then generate recaps of the completed
// week and previews of the upcoming one. Scheduled via vercel.json. Vercel Cron
// sends `Authorization: Bearer <CRON_SECRET>`; when CRON_SECRET is set we
// require it so the endpoint can't be triggered by anyone.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = getEnv().CRON_SECRET.trim();
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await generateWeeklyContent({ sync: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
