import { unstable_rethrow } from "next/navigation";
import { SessionRefresh } from "./session-refresh";
import { logAuthFailure } from "@/lib/auth-errors";
import Link from "next/link";
import { getSession } from "@/lib/session";

export async function AuthNavigation() {
  // A database outage must not make the public home page unavailable.
  const session = await getSession().catch((error) => { unstable_rethrow(error); logAuthFailure("Optional session read", error); return null; });
  return <nav aria-label="Main navigation" className="flex items-center justify-between border-b px-6 py-4 text-sm">
    {session && <SessionRefresh />}
    <Link href="/" className="font-semibold">DivHacks 2026</Link>
    <div className="flex gap-5">{session ? <Link href="/profile">Your profile</Link> : <><Link href="/login">Log in</Link><Link href="/register">Create account</Link></>}</div>
  </nav>;
}
