import { MongoServerError, ObjectId, type Db } from "mongodb";
import type { Auth } from "./auth-config";
import { conflictMessage, InputError, isProfileComplete, names, normalizePhone, objectBody, onlyFields } from "./auth-validation";

export function apiError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export async function updateProfile(request: Request, auth: Auth, db: Db, origin: string, complete: boolean) {
  try {
    if (request.headers.get("origin") !== origin) return apiError(403, "INVALID_ORIGIN", "This request is not allowed.");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!complete && !isProfileComplete(session.user)) return apiError(403, "PROFILE_INCOMPLETE", "Complete your profile to continue.");
    if (complete && isProfileComplete(session.user)) return apiError(409, "PROFILE_ALREADY_COMPLETE", "Your profile is already complete.");

    const bucket = Math.floor(Date.now() / 60_000);
    const limit = await db.collection<{ _id: string; count: number; expiresAt: Date }>("profileRateLimit").findOneAndUpdate(
      { _id: `${session.user.id}:${bucket}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * 60_000) } },
      { upsert: true, returnDocument: "after" },
    );
    if (limit && limit.count > 20) return apiError(429, "RATE_LIMITED", "Too many changes. Please wait a minute and try again.");

    let body: Record<string, unknown>;
    try { body = objectBody(await request.json()); } catch { throw new InputError("Send a valid JSON object."); }
    onlyFields(body, complete ? ["firstName", "lastName", "phoneNumber"] : ["firstName", "lastName"]);
    const updates = {
      ...names(body),
      updatedAt: new Date(),
      ...(complete ? { phoneNumber: normalizePhone(body.phoneNumber), phoneNumberVerified: false, profileCompletedAt: new Date() } : {}),
    };
    // Conditional update makes profile completion one-time, even under concurrent requests.
    const result = await db.collection("user").updateOne(
      { _id: new ObjectId(session.user.id), ...(complete ? { profileCompletedAt: null } : {}) },
      { $set: updates },
    );
    if (result.matchedCount !== 1) return apiError(409, "PROFILE_CHANGED", "Your profile changed. Refresh the page and try again.");
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof InputError) return apiError(400, "INVALID_INPUT", error.message);
    if (error instanceof MongoServerError && error.code === 11000) return apiError(409, "IDENTIFIER_IN_USE", conflictMessage);
    return apiError(503, "UNAVAILABLE", "We could not save your profile. Please try again.");
  }
}
