// Cancels requests nobody answered within 48 hours, which returns the held coins.
import { timingSafeEqual } from "node:crypto";
import type { Db, MongoClient } from "mongodb";
import { logAuthFailure } from "./auth-errors";
import { InputError } from "./auth-validation";
import { expiredTexts } from "./booking-texts";
import { exchangeCollections } from "./exchange-schema";
import { createExchangeService } from "./exchange-service";
import type { Messenger } from "./texting";

export const REQUEST_LIFETIME_MS = 48 * 60 * 60 * 1000;

/** Expires up to `limit` stale requests and texts both people; returns how many it cancelled. Safe to run twice or concurrently. */
export async function expireStaleRequests(db: Db, client: MongoClient, messenger: Messenger, now = new Date(), limit = 50): Promise<number> {
  const { bookings } = exchangeCollections(db);
  const cutoff = new Date(now.getTime() - REQUEST_LIFETIME_MS);
  const stale = await bookings.find({ status: "requested", createdAt: { $lte: cutoff } }).sort({ createdAt: 1 }).limit(limit).toArray();
  const domain = createExchangeService(db, client);
  let expired = 0;
  for (const booking of stale) {
    try {
      // Cancelling as the requester takes the same path a manual cancel would, refunding the held coins.
      await domain.transitionBooking(booking.requesterId, booking._id, "cancel");
    } catch (error) {
      // Not an InputError: something unexpected went wrong transitioning this one; log and move on.
      if (!(error instanceof InputError)) logAuthFailure("Request expiry", error);
      continue; // InputError means a reply or cancellation got there first.
    }
    expired++;
    const [requester, provider] = await Promise.all([
      db.collection("user").findOne({ _id: booking.requesterId }),
      db.collection("user").findOne({ _id: booking.providerId }),
    ]);
    const texts = expiredTexts({
      title: booking.serviceSnapshot.title,
      requesterFirstName: String(requester?.firstName ?? "someone"),
      providerFirstName: String(provider?.firstName ?? "someone"),
      totalCredits: booking.totalCredits,
    });
    if (typeof requester?.phoneNumber === "string") {
      try { await messenger.send(requester.phoneNumber, texts.requester); } catch (error) { logAuthFailure("Request expiry", error); }
    }
    if (typeof provider?.phoneNumber === "string") {
      try { await messenger.send(provider.phoneNumber, texts.provider); } catch (error) { logAuthFailure("Request expiry", error); }
    }
  }
  return expired;
}

/** Checks Vercel's cron secret and runs the expiry sweep; the route handler this backs never throws. */
export async function handleExpiryCron(request: Request, db: Db, client: MongoClient, messenger: Messenger, secret: string | undefined): Promise<Response> {
  if (!secret) {
    logAuthFailure("Expiry cron: CRON_SECRET is not set");
    return new Response("Not configured.", { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Same length first: timingSafeEqual throws, rather than returning false, on a length mismatch.
  const authorized = header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  if (!authorized) return new Response("Unauthorized.", { status: 401 });
  try {
    const expired = await expireStaleRequests(db, client, messenger);
    return Response.json({ expired });
  } catch (error) {
    logAuthFailure("Expiry cron", error);
    return new Response("Unavailable.", { status: 503 });
  }
}
