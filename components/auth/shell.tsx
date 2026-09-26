import Link from "next/link";
import type { ReactNode } from "react";
import { BarterLogo } from "@/components/barter/logo";

// Layout from the auth mockups: the logo beside the card on desktop, stacked above it on phones.
// `/` requires a complete session, so only pages shown to complete users should link back to it.
export function AuthShell({ title, description, children, backToApp = false }: { title: string; description?: string; children: ReactNode; backToApp?: boolean }) {
  return <main className="flex flex-1 flex-col items-center justify-center gap-10 bg-white px-4 py-10 font-mono text-black lg:flex-row lg:gap-[clamp(4rem,9vw,9.75rem)] lg:px-10 lg:py-16">
    <BarterLogo className="w-[109px] shrink-0 lg:mb-[58px] lg:w-[clamp(15rem,20.4vw,22rem)]" />
    <section className="w-full max-w-[346px] rounded-[20px] bg-white px-[clamp(1rem,calc(50vw_-_129px),3.75rem)] pt-11 pb-11 shadow-[0_10px_18px_rgba(0,0,0,0.3)] lg:max-w-[788px] lg:rounded-[24px] lg:px-[clamp(2.5rem,8vw,8.5rem)] lg:pt-[70px] lg:pb-[70px]">
      {backToApp && <Link href="/" className="mb-6 block text-center text-sm font-bold text-barter-blue hover:underline lg:text-left">← Back to barter</Link>}
      <h1 className="text-center text-[40px] leading-[1.3] font-extrabold lg:text-left">{title}</h1>
      {description && <p className="mt-3 text-center text-sm text-barter-gray lg:text-left">{description}</p>}
      <div className="mt-4 lg:mt-6">{children}</div>
    </section>
  </main>;
}
