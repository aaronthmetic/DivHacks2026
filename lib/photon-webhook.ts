import { verifySpectrumSignature } from "@spectrum-ts/core/webhook";
import type { Db } from "mongodb";
import { isE164 } from "./phone";
import { claimInboundMessage } from "./texting";

export type InboundText = { id: string; senderPhone: string; text: string };

/** Reads an inbound text out of Photon's normalized webhook JSON; null for anything else. */
export function parseInboundText(rawBody: string): InboundText | null {
  let envelope: unknown;
  try { envelope = JSON.parse(rawBody); } catch { return null; }
  const message = (envelope as { message?: Record<string, unknown> } | null)?.message;
  const content = message?.content as { type?: unknown; text?: unknown } | undefined;
  const sender = (message?.sender as { id?: unknown } | undefined)?.id;
  if (!message || message.direction === "outbound" || typeof message.id !== "string" || content?.type !== "text" || typeof content.text !== "string") return null;
  // Apple can deliver from an email handle, which can't be matched to a barter account.
  if (typeof sender !== "string" || !isE164(sender)) return null;
  return { id: message.id, senderPhone: sender, text: content.text };
}

/**
 * Verifies and claims one delivery. Returns the response for Photon and, for a new inbound
 * text, the text to handle after responding.
 */
export async function receiveWebhook(request: Request, db: Db, secret: string, now = Date.now()): Promise<{ response: Response; inbound?: InboundText }> {
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const verified = await verifySpectrumSignature({ rawBody, headers: Object.fromEntries(request.headers), secret, now });
  if (!verified.ok) return { response: new Response("Invalid signature.", { status: 401 }) };
  const inbound = parseInboundText(new TextDecoder().decode(rawBody));
  if (!inbound || !await claimInboundMessage(db, inbound.id)) return { response: new Response(null, { status: 200 }) };
  return { response: new Response(null, { status: 200 }), inbound };
}
