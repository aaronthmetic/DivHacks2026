import { logAuthFailure } from "@/lib/auth-errors";
import { handleExpiryCron } from "@/lib/booking-expiry";
import { getMongo } from "@/lib/mongodb";
import { photonMessenger } from "@/lib/photon-messenger";
import { loggingMessenger } from "@/lib/text-log";

export const runtime = "nodejs";
export const maxDuration = 120;

// Vercel's daily cron (vercel.json) hits this to sweep up requests nobody answered within 48 hours.
export async function GET(request: Request) {
  try {
    const { db, client } = await getMongo();
    return await handleExpiryCron(request, db, client, loggingMessenger(db, photonMessenger), process.env.CRON_SECRET);
  } catch (error) {
    logAuthFailure("Expiry cron", error);
    return new Response("Unavailable.", { status: 503 });
  }
}
