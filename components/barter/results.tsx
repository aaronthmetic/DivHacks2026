"use client";

import type { LucideIcon } from "lucide-react";
import {
  Camera,
  Dumbbell,
  GraduationCap,
  Laptop,
  Music,
  PawPrint,
  Scissors,
  Star,
  Wrench,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { Category, Service } from "@/lib/barter/data";
import { cn } from "@/lib/utils";

// Stand-in artwork per category until services have real photos.
const CATEGORY_ART: Record<Category, { icon: LucideIcon; colors: string }> = {
  Tutoring: { icon: GraduationCap, colors: "bg-[#e8eaff] text-[#4b55c8]" },
  Music: { icon: Music, colors: "bg-[#fff1e0] text-[#c2600a]" },
  Repairs: { icon: Wrench, colors: "bg-[#e3f4e8] text-[#2f7d4a]" },
  Pets: { icon: PawPrint, colors: "bg-[#fde8ec] text-[#c23b5a]" },
  Beauty: { icon: Scissors, colors: "bg-[#f3e8ff] text-[#8a3fcb]" },
  Creative: { icon: Camera, colors: "bg-[#e0f2fe] text-[#1b75b8]" },
  Fitness: { icon: Dumbbell, colors: "bg-[#fef6d8] text-[#a87b00]" },
  Tech: { icon: Laptop, colors: "bg-[#e6ecf5] text-[#3a5578]" },
};

const MAX_TAGS = 3;

export function ServiceArt({
  category,
  className,
  iconClassName,
}: {
  category: Category;
  className?: string;
  iconClassName?: string;
}) {
  const { icon: Icon, colors } = CATEGORY_ART[category];
  return (
    <div className={cn("flex items-center justify-center", colors, className)}>
      <Icon aria-hidden className={iconClassName} strokeWidth={1.5} />
    </div>
  );
}

export function ResultsPanel({
  services,
  query,
  compact = false,
}: {
  services: Service[];
  query: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "px-6 pt-4 pb-6" : "px-5 pt-6 pb-8"}>
      <h2 className="text-xl font-bold text-black">
        Looking for “{query || "anything"}”.
      </h2>
      <ul
        className={cn(
          "grid",
          compact
            ? "mt-4 grid-cols-2 gap-[27px]"
            : // Two columns only once the panel is wide enough to fit tags.
              "mt-[18px] grid-cols-1 gap-[30px] xl:grid-cols-2",
        )}
      >
        {services.map((service) => (
          <li key={service.id}>
            <ServiceCard service={service} compact={compact} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ServiceCard({
  service,
  compact,
}: {
  service: Service;
  compact: boolean;
}) {
  return (
    <article
      className={cn(
        "bg-white shadow-[0_4px_12px_rgba(0,0,0,0.15)]",
        compact ? "rounded-[14px] p-3.5" : "rounded-[24px] p-[27px]",
      )}
    >
      <ServiceArt
        category={service.category}
        className={cn(
          "aspect-square w-full",
          compact ? "rounded-xl" : "rounded-[20px]",
        )}
        iconClassName={compact ? "size-10" : "size-16"}
      />
      <div
        className={cn(
          "flex items-start justify-between gap-2",
          compact ? "mt-2.5 text-xs" : "mt-5 text-xl",
        )}
      >
        <h3 className="leading-tight text-black">{service.title}</h3>
        <p className="flex shrink-0 items-center gap-1 leading-tight">
          <span className="sr-only">Rated</span>
          {service.rating.toFixed(1)}
          <Star
            aria-hidden
            className={cn(
              "fill-barter-star text-barter-star",
              compact ? "size-3.5" : "size-[26px]",
            )}
          />
        </p>
      </div>
      <div
        className={cn(
          "flex justify-between gap-2 text-barter-gray",
          compact ? "mt-1 text-[9px]" : "mt-2 text-[15px]",
        )}
      >
        <span className="truncate">{service.location}</span>
        <span className="shrink-0">{service.ratingCount} ratings</span>
      </div>
      <TagList tags={service.tags} compact={compact} />
    </article>
  );
}

// Shows as many whole tags as fit on one line (up to three), then "+N".
function TagList({ tags, compact }: { tags: string[]; compact: boolean }) {
  const rowRef = useRef<HTMLUListElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(Math.min(MAX_TAGS, tags.length));

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    // Runs once when observing starts, then whenever the card resizes.
    const observer = new ResizeObserver(() => {
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const [more, ...chips] = Array.from(measure.children) as HTMLElement[];
      let used = 0;
      let count = 0;
      for (const chip of chips.slice(0, MAX_TAGS)) {
        const width = used + (count > 0 ? gap : 0) + chip.offsetWidth;
        const hidden = tags.length - count - 1;
        const reserve = hidden > 0 ? gap + more.offsetWidth : 0;
        if (width + reserve > row.clientWidth) break;
        used = width;
        count += 1;
      }
      setVisible(Math.max(count, 1));
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [tags]);

  const chip = cn(
    "shrink-0 whitespace-nowrap bg-barter-line text-black",
    compact ? "rounded px-1.5 py-1" : "rounded-lg px-3.5 py-2",
  );
  const hidden = tags.length - visible;
  return (
    <div
      className={cn(
        "relative",
        compact ? "mt-2.5 text-[9px]" : "mt-5 text-[15px]",
      )}
    >
      {/* Invisible copy of every chip, measured to decide how many fit. */}
      <div
        ref={measureRef}
        aria-hidden
        className="invisible absolute inset-x-0 top-0 flex overflow-hidden"
      >
        <span className="pl-1 whitespace-nowrap">+{tags.length}</span>
        {tags.map((tag) => (
          <span key={tag} className={chip}>
            {tag}
          </span>
        ))}
      </div>
      <ul
        ref={rowRef}
        className={cn("flex items-center", compact ? "gap-1.5" : "gap-3")}
      >
        {tags.slice(0, visible).map((tag) => (
          <li key={tag} className={cn(chip, "min-w-0 shrink truncate")}>
            {tag}
          </li>
        ))}
        {hidden > 0 && <li className="ml-auto shrink-0 pl-1">+{hidden}</li>}
      </ul>
    </div>
  );
}
