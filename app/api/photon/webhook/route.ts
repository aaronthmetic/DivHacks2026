import { after } from "next/server";
import { logAuthFailure } from "@/lib/auth-errors";
import { handleInboundText } from "@/lib/booking-replies";
import { createLlm, llmConfig } from "@/lib/llm";
import { getMongo } from "@/lib/mongodb";
import { photonMessenger } from "@/lib/photon-messenger";
import { receiveWebhook } from "@/lib/photon-webhook";
import { loggingMessenger } from "@/lib/text-log";

export const runtime = "nodejs";
// The assistant runs inside after(), which shares this route's time budget.
export const maxDuration = 120;

// Photon posts each incoming text here (register it with npm run photon:webhook). Replies are sent
// inside after(), so the function stays alive past the 200 on Vercel.
export async function POST(request: Request) {
  const secret = process.env.SPECTRUM_WEBHOOK_SECRET;
  if (!secret) {
    logAuthFailure("Photon webhook: SPECTRUM_WEBHOOK_SECRET is not set");
    return new Response("Not configured.", { status: 503 });
  }
  try {
    const { db, client } = await getMongo();
    const { response, inbound } = await receiveWebhook(request, db, secret);
    if (inbound) {
      const messenger = loggingMessenger(db, photonMessenger);
      const config = llmConfig();
      const llm = config ? createLlm(config) : null;
      after(() => handleInboundText(db, client, messenger, inbound, { llm }));
    }
    return response;
  } catch (error) {
    // A 5xx makes Photon retry; the message wasn't claimed, so the retry is handled normally.
    logAuthFailure("Photon webhook", error);
    return new Response("Unavailable.", { status: 503 });
  }
}
