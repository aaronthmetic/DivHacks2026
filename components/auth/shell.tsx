import Link from "next/link";
import type { ReactNode } from "react";

// `/` requires a complete session, so only pages shown to complete users should link back to it.
export function AuthShell({ title, description, children, backToApp = false }: { title: string; description: string; children: ReactNode; backToApp?: boolean }) {
  return <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-12">
    {backToApp && <Link href="/" className="mb-6 self-start text-sm underline underline-offset-4">Back to XCHG</Link>}
    <section className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mb-7 mt-2 text-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  </main>;
}
