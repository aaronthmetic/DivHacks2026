import { MongoServerError, ObjectId, type Db, type MongoClient } from "mongodb";
import type { Auth } from "./auth-config";
import { InputError, isProfileComplete, objectBody, onlyFields } from "./auth-validation";
import { logAuthFailure } from "./auth-errors";
import { createExchangeService } from "./exchange-service";
import { apiError, consumeProfileLimit } from "./profile-service";

/**
 * `POST /api/reviews`: a participant reviews the other person in a completed booking. The
 * domain's createReview checks the booking and updates the reviewed person's rating in one
 * transaction.
 */
export async function submitReview(request: Request, auth: Auth, db: Db, client: MongoClient, origin: string) {
  try {
    if (request.headers.get("origin") !== origin) return apiError(403, "INVALID_ORIGIN", "This request is not allowed.");
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to leave a review.");
    if (!isProfileComplete(session.user)) return apiError(403, "PROFILE_INCOMPLETE", "Complete your profile to continue.");
    if (!await consumeProfileLimit(db, session.user.id)) return apiError(429, "RATE_LIMITED", "Too many changes. Please wait a minute and try again.");
    let body: Record<string, unknown>;
    try { body = objectBody(await request.json()); } catch { throw new InputError("Send a valid JSON object."); }
    onlyFields(body, ["bookingId", "rating", "comment"]);
    const { bookingId, rating, comment } = body;
    if (typeof bookingId !== "string" || !/^[a-f\d]{24}$/i.test(bookingId)) throw new InputError("Invalid booking ID.");
    if (typeof rating !== "number") throw new InputError("Rating must be a whole number from 1 to 5.");
    if (typeof comment !== "string" || !comment.trim()) throw new InputError("A review comment is required.");
    const review = await createExchangeService(db, client).createReview(new ObjectId(session.user.id), new ObjectId(bookingId), rating, comment);
    return Response.json({ success: true, id: review._id.toHexString() }, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return apiError(400, "INVALID_INPUT", error.message);
    // The unique review index allows one review per author per booking.
    if (error instanceof MongoServerError && error.code === 11000) return apiError(409, "ALREADY_REVIEWED", "You already reviewed this booking.");
    logAuthFailure("Review creation", error);
    return apiError(503, "UNAVAILABLE", "We could not save your review. Please try again.");
  }
}
