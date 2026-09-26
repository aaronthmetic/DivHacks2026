"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return <main className="mx-auto max-w-lg space-y-5 px-6 py-20">
    <h1 className="text-2xl font-semibold">We couldn’t load this page</h1>
    <p className="text-muted-foreground">The service may be temporarily unavailable. Please try again.</p>
    <Button onClick={retry}>Try again</Button><Link className="ml-4 underline" href="/">Return home</Link>
  </main>;
}
