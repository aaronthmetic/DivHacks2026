import Image from "next/image";
import { cn } from "@/lib/utils";

// Stacked lockup from the auth mockups: the B mark over the "barter" wordmark. Size it
// by width; the mockups use a relatively larger mark on phones.
export function BarterLogo({ className }: { className?: string }) {
  return (
    <div role="img" aria-label="barter" className={cn("flex flex-col items-center", className)}>
      <Image src="/barter-mark.png" alt="" width={417} height={487} loading="eager" className="h-auto w-[82%] lg:w-[68%]" />
      <Image src="/barter-wordmark.svg" alt="" width={356} height={98} loading="eager" className="mt-[27%] h-auto w-full lg:mt-[8%]" />
    </div>
  );
}
