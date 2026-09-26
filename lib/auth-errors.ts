// Never log request bodies, callback URLs, database error messages, or tokens.
export class AuthConfigurationError extends Error {}

const unknownCause = "check database/provider availability and index permissions.";

// Error names and driver codes identify a cause without the message, which can contain user data.
function describe(error: unknown) {
  if (error instanceof AuthConfigurationError) return error.message;
  if (!(error instanceof Error)) return `Operation failed; ${unknownCause}`;
  const { code, codeName } = error as { code?: unknown; codeName?: unknown };
  const detail = [code, codeName].filter((part) => part !== undefined && part !== "").join(" ");
  return `${error.name}${detail ? ` (${detail})` : ""}; ${unknownCause}`;
}

export function logAuthFailure(operation: string, error?: unknown) {
  console.error(`[auth] ${operation}`, describe(error));
}

export function isOAuthCallback(request: Request) {
  return new URL(request.url).pathname === "/api/auth/callback/google";
}

// The callback is a top-level browser navigation, so failures go back to /login instead of JSON.
// A relative, fixed redirect cannot inherit an attacker-controlled Host header.
export function callbackRedirect(error: string) {
  return new Response(null, { status: 302, headers: { Location: `/login?error=${error}`, "Cache-Control": "no-store" } });
}

export function authUnavailable(request: Request) {
  if (isOAuthCallback(request)) return callbackRedirect("unavailable");
  return Response.json({ error: { code: "UNAVAILABLE", message: "Authentication is temporarily unavailable. Please try again." } }, { status: 503 });
}
