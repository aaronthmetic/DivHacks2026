import { ObjectId, type Db, type MongoClient } from "mongodb";
import type { Auth } from "./auth-config";
import { InputError, isProfileComplete, objectBody, onlyFields } from "./auth-validation";
import { logAuthFailure } from "./auth-errors";
import { createExchangeService } from "./exchange-service";
import { apiError, consumeProfileLimit } from "./profile-service";

/**
 * The web's booking actions. Requests are made by `POST /api/bookings` and answered by text;
 * here the requester finishes an accepted booking ("Finish Barter"), which pays the provider
 * the coins held since the request.
 */
export async function updateBooking(request: Request, id: string, auth: Auth, db: Db, client: MongoClient, origin: string) {
  try {
    if (request.headers.get("origin") !== origin) return apiError(403, "INVALID_ORIGIN", "This request is not allowed.");
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!isProfileComplete(session.user)) return apiError(403, "PROFILE_INCOMPLETE", "Complete your profile to continue.");
    if (!await consumeProfileLimit(db, session.user.id)) return apiError(429, "RATE_LIMITED", "Too many changes. Please wait a minute and try again.");
    if (!/^[a-f\d]{24}$/i.test(id)) return apiError(400, "INVALID_INPUT", "Invalid booking ID.");
    let body: Record<string, unknown>;
    try { body = objectBody(await request.json()); } catch { throw new InputError("Send a valid JSON object."); }
    onlyFields(body, ["action"]);
    if (body.action !== "confirm") throw new InputError("Choose a booking action.");
    // The domain allows only the requester to confirm, so a provider can't pay themselves.
    const booking = await createExchangeService(db, client).transitionBooking(new ObjectId(session.user.id), new ObjectId(id), "confirm");
    return Response.json({ success: true, id, status: booking.status });
  } catch (error) {
    if (error instanceof InputError) return apiError(400, "INVALID_INPUT", error.message);
    logAuthFailure("Booking update", error);
    return apiError(503, "UNAVAILABLE", "We could not update this booking. Please try again.");
  }
}
