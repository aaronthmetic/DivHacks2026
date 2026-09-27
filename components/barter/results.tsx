"use client";

import type { LucideIcon } from "lucide-react";
import {
  Camera,
  Dumbbell,
  GraduationCap,
  Handshake,
  Laptop,
  Music,
  PawPrint,
  Scissors,
  Star,
  Wrench,
} from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { Service } from "@/lib/barter/data";
import { starFill } from "@/lib/profile-display";
import { cn } from "@/lib/utils";

type Art = {
  icon: LucideIcon;
  colors: string;
};

const CATEGORY_ART: Record<
  string,
  Art
> = {
  Tutoring: {
    icon: GraduationCap,
    colors:
      "bg-[#e8eaff] text-[#4b55c8]",
  },
  Music: {
    icon: Music,
    colors:
      "bg-[#fff1e0] text-[#c2600a]",
  },
  Repairs: {
    icon: Wrench,
    colors:
      "bg-[#e3f4e8] text-[#2f7d4a]",
  },
  Pets: {
    icon: PawPrint,
    colors:
      "bg-[#fde8ec] text-[#c23b5a]",
  },
  Beauty: {
    icon: Scissors,
    colors:
      "bg-[#f3e8ff] text-[#8a3fcb]",
  },
  Creative: {
    icon: Camera,
    colors:
      "bg-[#e0f2fe] text-[#1b75b8]",
  },
  Fitness: {
    icon: Dumbbell,
    colors:
      "bg-[#fef6d8] text-[#a87b00]",
  },
  Tech: {
    icon: Laptop,
    colors:
      "bg-[#e6ecf5] text-[#3a5578]",
  },
};

const OTHER_ART: Art = {
  icon: Handshake,
  colors:
    "bg-[#eef0f4] text-[#4a5568]",
};

const MAX_TAGS = 3;

export function ServiceArt({
  category,
  className,
  iconClassName,
}: {
  category: string;
  className?: string;
  iconClassName?: string;
}) {
  const {
    icon: Icon,
    colors,
  } =
    CATEGORY_ART[category] ??
    OTHER_ART;

  return (
    <div
      className={cn(
        "flex items-center justify-center",
        colors,
        className,
      )}
    >
      <Icon
        aria-hidden
        className={iconClassName}
        strokeWidth={1.5}
      />
    </div>
  );
}

// Explorer already filters this array.
// ResultsPanel only renders the services it receives.
export function ResultsPanel({
  services,
  query,
  zip,
  onSelect,
  compact = false,
}: {
  services: Service[];
  query: string;
  zip: string | null;
  onSelect: (
    service: Service,
  ) => void;
  compact?: boolean;
}) {
  const hasSearch =
    query.trim().length > 0;

  return (
    <div
      className={
        compact
          ? "px-6 pt-4 pb-6"
          : "px-5 pt-6 pb-8"
      }
    >
      <h2 className="text-xl font-bold text-black">
        Looking for “
        {hasSearch
          ? query
          : "anything"}
        ”
        {zip
          ? ` in ${zip}`
          : ""}
        .
      </h2>

      {services.length === 0 && (
        <p className="mt-4 text-[15px] text-barter-gray">
          No listings match your
          current search or filters.
        </p>
      )}

      <ul
        className={cn(
          "grid items-stretch",
          compact
            ? "mt-4 grid-cols-2 gap-[27px]"
            : "mt-[18px] grid-cols-1 gap-[30px] xl:grid-cols-2",
        )}
      >
        {services.map(
          (service) => (
            <li key={service.id}>
              <ServiceCard
                service={service}
                compact={compact}
                onSelect={onSelect}
              />
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function ServiceCard({
  service,
  compact,
  onSelect,
}: {
  service: Service;
  compact: boolean;
  onSelect: (
    service: Service,
  ) => void;
}) {
  const cover = cn(
    "aspect-square w-full overflow-hidden",
    compact
      ? "rounded-xl"
      : "rounded-[20px]",
  );

  const firstImage =
    service.images?.[0];

  return (
    <article
      className={cn(
        "relative flex h-full flex-col bg-white shadow-[0_4px_12px_rgba(0,0,0,0.15)]",
        compact
          ? "rounded-[14px] p-3.5"
          : "rounded-[24px] p-[27px]",
      )}
    >
      {firstImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={firstImage}
          alt={`${service.title} listing`}
          className={cn(
            cover,
            "bg-barter-read object-cover",
          )}
        />
      ) : (
        <ServiceArt
          category={
            service.category
          }
          className={cover}
          iconClassName={
            compact
              ? "size-10"
              : "size-16"
          }
        />
      )}

      <div
        className={cn(
          "flex items-start justify-between gap-2",
          compact
            ? "mt-2.5 text-xs"
            : "mt-5 text-xl",
        )}
      >
        <h3 className="min-w-0 leading-tight text-black">
          {service.title}
        </h3>
      </div>

      <div
        className={cn(
          "flex justify-between gap-2 text-barter-gray",
          compact
            ? "mt-1 text-[9px]"
            : "mt-2 text-[15px]",
        )}
      >
        <span className="truncate">
          {service.location}
        </span>
      </div>

      <div
        className={cn(
          "mt-auto flex justify-end",
          compact ? "pt-2" : "pt-3",
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center leading-tight",
            compact ? "gap-0.5" : "gap-1",
          )}
          role="img"
          aria-label={
            service.ratingCount
              ? `${service.rating.toFixed(1)} out of 5 stars, ${service.ratingCount} reviews`
              : "No reviews yet"
          }
        >
          <span className="flex" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <span
                key={index}
                className={cn(
                  "relative block text-amber-500",
                  compact ? "size-2.5" : "size-4",
                )}
              >
                <Star className="size-full" />
                <span
                  className="absolute inset-y-0 left-0 overflow-hidden"
                  style={{
                    width: `${starFill(service.ratingCount ? service.rating : 0, index)}%`,
                  }}
                >
                  <Star
                    className={cn(
                      "max-w-none fill-current",
                      compact ? "size-2.5" : "size-4",
                    )}
                  />
                </span>
              </span>
            ))}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "text-barter-gray",
              compact ? "text-[9px]" : "text-xs",
            )}
          >
            ({service.ratingCount})
          </span>
        </span>
      </div>

      <TagList
        tags={service.tags ?? []}
        compact={compact}
      />

      <button
        type="button"
        onClick={() =>
          onSelect(service)
        }
        className="absolute inset-0 rounded-[inherit] focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-barter-blue"
      >
        <span className="sr-only">
          View {service.title}
        </span>
      </button>
    </article>
  );
}

function TagList({
  tags,
  compact,
}: {
  tags: string[];
  compact: boolean;
}) {
  const rowRef =
    useRef<HTMLUListElement>(
      null,
    );

  const measureRef =
    useRef<HTMLDivElement>(
      null,
    );

  const [visible, setVisible] =
    useState(
      Math.min(
        MAX_TAGS,
        tags.length,
      ),
    );

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure =
      measureRef.current;

    if (!row || !measure) {
      return;
    }

    const observer =
      new ResizeObserver(() => {
        const gap =
          parseFloat(
            getComputedStyle(row)
              .columnGap,
          ) || 0;

        const [
          more,
          ...chips
        ] = Array.from(
          measure.children,
        ) as HTMLElement[];

        let used = 0;
        let count = 0;

        for (const chip of chips.slice(
          0,
          MAX_TAGS,
        )) {
          const width =
            used +
            (count > 0
              ? gap
              : 0) +
            chip.offsetWidth;

          const hidden =
            tags.length -
            count -
            1;

          const reserve =
            hidden > 0
              ? gap +
                more.offsetWidth
              : 0;

          if (
            width + reserve >
            row.clientWidth
          ) {
            break;
          }

          used = width;
          count += 1;
        }

        setVisible(
          tags.length > 0
            ? Math.max(
                count,
                1,
              )
            : 0,
        );
      });

    observer.observe(row);

    return () => {
      observer.disconnect();
    };
  }, [tags]);

  if (tags.length === 0) {
    return null;
  }

  const chip = cn(
    "shrink-0 whitespace-nowrap bg-barter-line text-black",
    compact
      ? "rounded px-1.5 py-1"
      : "rounded-lg px-3.5 py-2",
  );

  const hidden = Math.max(
    tags.length - visible,
    0,
  );

  return (
    <div
      className={cn(
        "relative",
        compact
          ? "mt-2.5 text-[9px]"
          : "mt-5 text-[15px]",
      )}
    >
      <div
        ref={measureRef}
        aria-hidden
        className="invisible absolute inset-x-0 top-0 flex overflow-hidden"
      >
        <span className="pl-1 whitespace-nowrap">
          +{tags.length}
        </span>

        {tags.map(
          (tag, index) => (
            <span
              key={`${tag}-${index}`}
              className={chip}
            >
              {tag}
            </span>
          ),
        )}
      </div>

      <ul
        ref={rowRef}
        className={cn(
          "flex items-center",
          compact
            ? "gap-1.5"
            : "gap-3",
        )}
      >
        {tags
          .slice(0, visible)
          .map(
            (
              tag,
              index,
            ) => (
              <li
                key={`${tag}-${index}`}
                className={cn(
                  chip,
                  "min-w-0 shrink truncate",
                )}
              >
                {tag}
              </li>
            ),
          )}

        {hidden > 0 && (
          <li className="ml-auto shrink-0 pl-1">
            +{hidden}
          </li>
        )}
      </ul>
    </div>
  );
}
