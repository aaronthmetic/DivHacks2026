import { logAuthFailure } from "./auth-errors";
import { createExchangeService } from "./exchange-service";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import type { Auth } from "./auth-config";
import { conflictMessage, InputError, isProfileComplete, names, nameField, normalizeEmail, normalizePhone, objectBody, onlyFields } from "./auth-validation";

export function apiError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export async function updateProfile(request: Request, auth: Auth, db: Db, origin: string, complete: boolean) {
  try {
    if (request.headers.get("origin") !== origin) return apiError(403, "INVALID_ORIGIN", "This request is not allowed.");
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!complete && !isProfileComplete(session.user)) return apiError(403, "PROFILE_INCOMPLETE", "Complete your profile to continue.");
    if (complete && isProfileComplete(session.user)) return apiError(409, "PROFILE_ALREADY_COMPLETE", "Your profile is already complete.");

    if (!await consumeProfileLimit(db, session.user.id)) return apiError(429, "RATE_LIMITED", "Too many changes. Please wait a minute and try again.");

    let body: Record<string, unknown>;
    try { body = objectBody(await request.json()); } catch { throw new InputError("Send a valid JSON object."); }
    onlyFields(body, complete ? ["firstName", "lastName", "phoneNumber"] : ["firstName", "lastName", "email", "phoneNumber", "currentPassword"]);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (complete) Object.assign(updates, names(body), { phoneNumber: normalizePhone(body.phoneNumber), phoneNumberVerified: false, profileCompletedAt: new Date() });
    else {
      if (!["firstName", "lastName", "email", "phoneNumber"].some(key => key in body)) throw new InputError("Choose a field to update.");
      if ("firstName" in body) updates.firstName = nameField(body.firstName, "First name");
      if ("lastName" in body) updates.lastName = nameField(body.lastName, "Last name");
      if ("email" in body) updates.email = normalizeEmail(body.email);
      if ("phoneNumber" in body) updates.phoneNumber = normalizePhone(body.phoneNumber);
      if ("email" in body || "phoneNumber" in body) {
        const context = await auth.$context;
        const credential = await context.internalAdapter.findCredentialAccount(session.user.id);
        if (credential?.password) {
          if (typeof body.currentPassword !== "string" || body.currentPassword.length > 128 || !await context.password.verify({ hash: credential.password, password: body.currentPassword })) return apiError(403, "REAUTHENTICATE", "Enter your current password to change contact details.");
        } else {
          const google = await db.collection("account").findOne({ userId: new ObjectId(session.user.id), providerId: "google" });
          if (!google || Date.now() - new Date(session.session.createdAt).getTime() > 300_000) return apiError(403, "REAUTHENTICATE", "Sign in with Google again, then return here within five minutes.");
        }
      }
    }
    await db.client.withSession((transactionSession) => transactionSession.withTransaction(async () => {
      const userId = new ObjectId(session.user.id);
      const current = await db.collection("user").findOne({ _id: userId }, { session: transactionSession });
      if (!current) throw new ProfileChangedError();
      if ("firstName" in updates || "lastName" in updates) updates.name = `${updates.firstName ?? current.firstName} ${updates.lastName ?? current.lastName}`;
      if ("email" in updates && updates.email !== current.email) updates.emailVerified = false;
      if ("phoneNumber" in updates && updates.phoneNumber !== current.phoneNumber) updates.phoneNumberVerified = false;
      const result = await db.collection("user").updateOne(
        { _id: userId, ...(complete ? { profileCompletedAt: null } : {}) },
        { $set: updates }, { session: transactionSession },
      );
      if (result.matchedCount !== 1) throw new ProfileChangedError();
      await createExchangeService(db, db.client).grantWelcome(userId, transactionSession);
    }));
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof ProfileChangedError) return apiError(409, "PROFILE_CHANGED", "Your profile changed. Refresh the page and try again.");
    if (error instanceof InputError) return apiError(400, "INVALID_INPUT", error.message);
    if (error instanceof MongoServerError && error.code === 11000) return apiError(409, "IDENTIFIER_IN_USE", conflictMessage);
    logAuthFailure("Profile update", error);
    return apiError(503, "UNAVAILABLE", "We could not save your profile. Please try again.");
  }
}

class ProfileChangedError extends Error {}

export async function consumeProfileLimit(db: Db, userId: string) {
  // One atomic sliding window per user, shared across application instances.
  const now = Date.now();
  const collection = db.collection<{ _id: string; timestamps: number[]; allowed: boolean; expiresAt: Date }>("profileRateLimit");
  const consume = () => collection.findOneAndUpdate(
    { _id: userId },
    [
      { $set: { timestamps: { $filter: { input: { $ifNull: ["$timestamps", []] }, as: "time", cond: { $gt: ["$$time", now - 60_000] } } } } },
      { $set: { allowed: { $lt: [{ $size: "$timestamps" }, 20] } } },
      { $set: {
        timestamps: { $cond: ["$allowed", { $concatArrays: ["$timestamps", [now]] }, "$timestamps"] },
        expiresAt: new Date(now + 120_000),
      } },
    ],
    { upsert: true, returnDocument: "after" },
  );
  const limit = await consume().catch((error) => {
    // Concurrent first requests can race to insert the same unique user key.
    if (error instanceof MongoServerError && error.code === 11000) return consume();
    throw error;
  });
  return Boolean(limit?.allowed);
}
