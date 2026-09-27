import { ObjectId, type Db } from "mongodb";
import type { Auth } from "./auth-config";
import { logAuthFailure } from "./auth-errors";
import { InputError, isProfileComplete } from "./auth-validation";
import type { RegisterPhoton } from "./photon-users";
import { apiError, consumeProfileLimit } from "./profile-service";
import { ensurePhotonUser } from "./texting";

// The "Turn on texts" button: registers the account with Photon if needed and returns the number to text.
export async function turnOnTexts(request: Request, auth: Auth, db: Db, origin: string, register: RegisterPhoton | undefined) {
  try {
    if (request.headers.get("origin") !== origin) return apiError(403, "INVALID_ORIGIN", "This request is not allowed.");
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!isProfileComplete(session.user)) return apiError(403, "PROFILE_INCOMPLETE", "Complete your profile to continue.");
    if (!await consumeProfileLimit(db, session.user.id)) return apiError(429, "RATE_LIMITED", "Too many requests. Please wait a minute and try again.");
    if (!register) return apiError(503, "TEXTS_UNAVAILABLE", "Texting isn't set up yet.");
    return Response.json({ number: await ensurePhotonUser(db, new ObjectId(session.user.id), register) });
  } catch (error) {
    if (error instanceof InputError) return apiError(400, "INVALID_INPUT", error.message);
    logAuthFailure("Turning on texts", error);
    return apiError(503, "UNAVAILABLE", "We couldn't reach our texting service. Please try again.");
  }
}
