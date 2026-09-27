import { ObjectId, type Db, type MongoClient } from "mongodb";
import type { Auth } from "./auth-config";
import { logAuthFailure } from "./auth-errors";
import { InputError, isProfileComplete, objectBody, onlyFields } from "./auth-validation";
import { bookingCode, requestSentText, requestText } from "./booking-texts";
import { exchangeCollections, type AvailabilityWindow } from "./exchange-schema";
import { createExchangeService } from "./exchange-service";
import { apiError, consumeProfileLimit } from "./profile-service";
import type { Messenger } from "./texting";

const MAX_HOURS = 8;

/** Checks the request form's JSON. The domain checks the window against the listing. */
export function parseBookingRequest(value: unknown): { serviceId: ObjectId; window?: AvailabilityWindow; hours?: number; note?: string } {
  const body = objectBody(value);
  onlyFields(body, ["serviceId", "window", "hours", "note"]);
  if (typeof body.serviceId !== "string" || !/^[a-f\d]{24}$/i.test(body.serviceId)) throw new InputError("Choose a listing.");
  let window: AvailabilityWindow | undefined;
  if (body.window !== undefined && body.window !== null) {
    const entry = body.window as Record<string, unknown>;
    if (typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join() !== "day,end,start" || ![entry.day, entry.start, entry.end].every(Number.isInteger)) throw new InputError("Choose one of the provider's available times.");
    window = { day: entry.day as number, start: entry.start as number, end: entry.end as number };
  }
  if (body.hours !== undefined && (!Number.isInteger(body.hours) || (body.hours as number) < 1 || (body.hours as number) > MAX_HOURS)) throw new InputError(`Choose from 1 to ${MAX_HOURS} hours.`);
  if (body.note !== undefined && typeof body.note !== "string") throw new InputError("A note must be text.");
  return { serviceId: new ObjectId(body.serviceId), window, hours: body.hours as number | undefined, note: body.note as string | undefined };
}

// The provider is texted first: a request the provider never hears about must not keep the coins held.
export async function createBookingRequest(request: Request, auth: Auth, db: Db, client: MongoClient, origin: string, messenger: Messenger) {
  try {
    if (request.headers.get("origin") !== origin) return apiError(403, "INVALID_ORIGIN", "This request is not allowed.");
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!isProfileComplete(session.user)) return apiError(403, "PROFILE_INCOMPLETE", "Complete your profile to continue.");
    if (!await consumeProfileLimit(db, session.user.id)) return apiError(429, "RATE_LIMITED", "Too many requests. Please wait a minute and try again.");
    let body: unknown;
    try { body = await request.json(); } catch { throw new InputError("Send the request as JSON."); }
    const input = parseBookingRequest(body);
    const c = exchangeCollections(db);
    const service = await c.services.findOne({ _id: input.serviceId, status: "active" });
    if (!service) return apiError(404, "LISTING_NOT_FOUND", "This listing is no longer available.");
    const requesterId = new ObjectId(session.user.id);
    const [requester, provider] = await Promise.all([requesterId, service.userId].map((_id) => db.collection("user").findOne({ _id })));
    if (!requester?.textsEnabledAt) return apiError(403, "TEXTS_OFF", "Turn on texts to send requests.");
    if (!provider?.textsEnabledAt) return apiError(409, "PROVIDER_UNAVAILABLE", "Requests aren't available for this provider yet.");
    const hourly = service.pricingType === "hourly";
    if (hourly && input.hours === undefined) throw new InputError("Choose how many hours.");
    // Read everything before holding the coins, so only the provider's text can fail after the hold.
    const offers = (await c.services.find({ userId: requesterId, status: "active" }, { projection: { title: 1 } }).sort({ createdAt: -1 }).toArray()).map((s) => s.title);
    const domain = createExchangeService(db, client);
    const booking = await domain.requestBooking(requesterId, service._id, { ...(hourly ? { durationMinutes: input.hours! * 60 } : {}), preferredWindow: input.window, note: input.note });
    try {
      await messenger.send(provider.phoneNumber, requestText({ requesterName: requester.name, requesterFirstName: requester.firstName, title: service.title, pricingType: service.pricingType, totalCredits: booking.totalCredits, hours: input.hours, window: booking.preferredWindow, offers, note: booking.note, code: bookingCode(booking._id) }));
    } catch (error) {
      logAuthFailure("Booking request text", error);
      await domain.transitionBooking(requesterId, booking._id, "cancel");
      return apiError(503, "PROVIDER_UNREACHABLE", `We couldn't reach ${provider.firstName} by text, so you weren't charged.`);
    }
    await messenger.send(requester.phoneNumber, requestSentText({ title: service.title, providerName: provider.name, providerFirstName: provider.firstName })).catch((error) => logAuthFailure("Booking confirmation text", error));
    return Response.json({ success: true, id: booking._id.toHexString() }, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return apiError(400, "INVALID_INPUT", error.message);
    logAuthFailure("Booking request", error);
    return apiError(503, "UNAVAILABLE", "We could not send your request. Please try again.");
  }
}
