import { authUnavailable, logAuthFailure } from "./auth-errors";
import type { Auth } from "./auth-config";
import { apiError } from "./profile-service";
import { conflictMessage } from "./auth-validation";

export async function handleAuthRequest(request: Request, auth: Auth) {
  try {
    const response = await auth.handler(request);
    const path = new URL(request.url).pathname;
    if (!response.ok && path.endsWith("/sign-up/email")) {
      const body = await response.clone().json().catch(() => null);
      if (body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
        return apiError(409, "REGISTRATION_CONFLICT", conflictMessage);
      }
      if (body?.code === "FAILED_TO_CREATE_USER") {
        return apiError(422, "REGISTRATION_FAILED", "We could not create your account. Please try again, or sign in if you already registered.");
      }
    }
    if (["/api/auth/sign-in/email", "/api/auth/sign-in/phone-number"].includes(path) && [400, 401, 403].includes(response.status)) {
      const body = await response.clone().json().catch(() => null);
      if (["INVALID_EMAIL_OR_PASSWORD", "INVALID_PHONE_NUMBER_OR_PASSWORD"].includes(body?.code)) {
        return apiError(401, "INVALID_CREDENTIALS", "Invalid email, phone number, or password.");
      }
    }
    if (response.status >= 500) {
      logAuthFailure("Auth endpoint returned a server error");
      return authUnavailable(request);
    }
    return response;
  } catch (error) {
    logAuthFailure("Auth request", error);
    return authUnavailable(request);
  }
}
