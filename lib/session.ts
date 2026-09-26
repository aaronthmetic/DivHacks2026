import { logAuthFailure } from "@/lib/auth-errors";
import "server-only";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { getAuth } from "./auth";
import { isProfileComplete } from "./auth-validation";
import { getSessionCookie } from "better-auth/cookies";

export async function getSession() {
  const requestHeaders = await headers();
  // Analytics and other unrelated cookies must not trigger a database connection.
  if (!getSessionCookie(requestHeaders)) return null;
  const auth = await getAuth();
  return auth.api.getSession({ headers: requestHeaders, query: { disableRefresh: true } });
}

export async function requireSession(complete = true) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (complete && !isProfileComplete(session.user)) redirect("/complete-profile");
  return session;
}

export async function redirectIfSignedIn() {
  // getSession() always reads request headers, so these pages stay dynamic even in builds
  // made without auth env, and it skips the database entirely when there is no session cookie.
  // This optional redirect must not turn public auth pages into a 500 during an outage or
  // before setup. Protected routes still use requireSession(), which fails closed.
  const session = await getSession().catch((error) => { unstable_rethrow(error); logAuthFailure("Optional session read", error); return null; });
  if (session) redirect(isProfileComplete(session.user) ? "/" : "/complete-profile");
}
