import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function ProfileShell({ children, backHref = "/", backLabel = "Back to barter" }: { children: ReactNode; backHref?: string; backLabel?: string }) {
  return (
    <div className="min-h-screen bg-barter-read text-black">
      <header className="flex h-[94px] items-center justify-between gap-6 bg-barter-navy px-7 lg:px-10">
        <Link href="/" aria-label="barter home" className="shrink-0 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-barter-blue">
          <Image src="/barter-mark-white.png" alt="" width={417} height={487} loading="eager" className="h-12 w-auto" />
        </Link>
        <Link href={backHref} className="inline-flex items-center gap-2 rounded text-sm font-semibold text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-barter-blue">
          <ArrowLeft className="size-4" aria-hidden="true" />{backLabel}
        </Link>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">{children}</main>
    </div>
  );
}
