import Form from "next/form";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode, SVGProps } from "react";
import { Bell, Menu, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Panel = "notifications" | "menu" | "filters";

export function Header({
  openPanel,
  onToggle,
  unreadCount,
  query,
  filters,
}: {
  openPanel: Panel | null;
  onToggle: (panel: Panel) => void;
  unreadCount: number;
  query: string;
  filters: ReactNode;
}) {
  const menuOpen = openPanel === "menu";
  return (
    <header className="relative z-30 flex h-[94px] shrink-0 items-center bg-barter-navy pr-6 pl-7 lg:pr-8 lg:pl-10">
      <button
        type="button"
        onClick={() => onToggle("menu")}
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-expanded={menuOpen}
        aria-controls="mobile-menu"
        className="mr-7 text-white lg:hidden"
      >
        {menuOpen ? (
          <X className="size-9" strokeWidth={2.5} />
        ) : (
          <Menu className="size-9" strokeWidth={2.5} />
        )}
      </button>
      <Link href="/" aria-label="barter home" className="shrink-0">
        <Image
          src="/barter-mark-white.png"
          alt=""
          width={417}
          height={487}
          loading="eager"
          className="h-12 w-auto"
        />
      </Link>
      <div className="relative mr-[clamp(1.5rem,11vw,13rem)] ml-[clamp(1.5rem,10vw,11rem)] hidden flex-1 items-center gap-7 lg:flex">
        <SearchInput query={query} className="h-[58px] flex-1" />
        <button
          type="button"
          onClick={() => onToggle("filters")}
          aria-label="Filters"
          aria-expanded={openPanel === "filters"}
          aria-controls="filters-panel"
          className="text-white"
        >
          <FilterIcon className="h-6 w-8" />
        </button>
        {openPanel === "filters" && (
          <div
            id="filters-panel"
            className="absolute top-[calc(100%+18px)] right-0 w-[360px] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
          >
            {filters}
          </div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3 lg:ml-0 lg:gap-4">
        <button
          type="button"
          onClick={() => onToggle("notifications")}
          aria-label={
            unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"
          }
          aria-expanded={openPanel === "notifications"}
          aria-controls="notifications-panel"
          className="relative text-white"
        >
          <Bell className="size-9" fill="currentColor" strokeWidth={1.5} />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-barter-dot ring-2 ring-barter-navy" />
          )}
        </button>
        <Link href="/profile" aria-label="Profile" className="text-white">
          <ProfileIcon className="size-[46px]" />
        </Link>
      </div>
    </header>
  );
}

// Submits to /?search=…, which the page passes back down as `query`.
export function SearchInput({
  query,
  outlined = false,
  className,
  onSubmit,
}: {
  query: string;
  outlined?: boolean;
  className?: string;
  onSubmit?: () => void;
}) {
  return (
    <Form
      action="/"
      role="search"
      onSubmit={onSubmit}
      className={cn(
        "flex items-center gap-3 rounded-lg bg-white px-6 focus-within:ring-2 focus-within:ring-barter-blue",
        outlined && "border border-barter-line px-[18px]",
        className,
      )}
    >
      <input
        // Remounts when the search changes elsewhere (the logo link clears it).
        key={query}
        name="search"
        type="search"
        defaultValue={query}
        aria-label="Search services"
        placeholder="Search..."
        className="min-w-0 flex-1 self-stretch bg-transparent text-[15px] text-black outline-none placeholder:text-black [&::-webkit-search-cancel-button]:hidden"
      />
      <button type="submit" aria-label="Search" className="shrink-0 text-black">
        <Search aria-hidden className="size-6" strokeWidth={2} />
      </button>
    </Form>
  );
}

// Three sliders with round knobs, as in the mockup (lucide has no exact match).
function FilterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
      {...props}
    >
      <path d="M2 4h6M14 4h16M2 12h17M25 12h5M2 20h9M17 20h13" />
      <circle cx="11" cy="4" r="3" />
      <circle cx="22" cy="12" r="3" />
      <circle cx="14" cy="20" r="3" />
    </svg>
  );
}

// Ring with a filled figure, as in the mockup.
function ProfileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden {...props}>
      <defs>
        <clipPath id="barter-profile-clip">
          <circle cx="24" cy="24" r="22" />
        </clipPath>
      </defs>
      <circle cx="24" cy="24" r="22.5" stroke="currentColor" strokeWidth={2} />
      <g clipPath="url(#barter-profile-clip)" fill="currentColor">
        <circle cx="24" cy="19" r="8" />
        <path d="M8 46c0-9 7.2-16 16-16s16 7 16 16z" />
      </g>
    </svg>
  );
}
