// Never log request bodies, callback URLs, database error messages, or tokens.
export class AuthConfigurationError extends Error {}

export function logAuthFailure(operation: string, error?: unknown) {
  console.error(`[auth] ${operation}`, error instanceof AuthConfigurationError
    ? error.message
    : "Operation failed; check database/provider availability and index permissions.");
}

export function authUnavailable(request: Request) {
  if (new URL(request.url).pathname === "/api/auth/callback/google") {
    // A relative, fixed redirect cannot inherit an attacker-controlled Host header.
    return new Response(null, { status: 302, headers: { Location: "/login?error=unavailable", "Cache-Control": "no-store" } });
  }
  return Response.json({ error: { code: "UNAVAILABLE", message: "Authentication is temporarily unavailable. Please try again." } }, { status: 503 });
}
