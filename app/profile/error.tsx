"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function ProfileError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-lg space-y-6 p-8"><h1 className="text-2xl font-bold">Profile unavailable</h1><p>We could not load this profile. Please try again.</p><Button onClick={reset}>Try again</Button><Link href="/" className="block underline">Back to XCHG</Link></main>;
}
