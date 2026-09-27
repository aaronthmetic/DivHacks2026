"use client";

import Image from "next/image";
import { Star } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

const MAX_TAGS = 3;

export type MongoService = {
  id: string;
  title: string;

  rating: number;
  ratingCount: number;

  location: string;
  zip: string;
  tags: string[];

  images: string[];

  description?: string;
  price?: number;
  userId?: string;
  genreId?: string;
};

export function ResultsPanel({
  services,
  query,
  compact = false,
}: {
  services: MongoService[];
  query: string;
  compact?: boolean;
}) {
  const [selectedZip, setSelectedZip] = useState<string | null>(null);

  /*
   * Listen for selectedZip changes coming directly
   * from service-map.tsx.
   */
  useEffect(() => {
    function handleZipChange(event: Event) {
      const customEvent = event as CustomEvent<string | null>;

      setSelectedZip(customEvent.detail);
    }

    window.addEventListener(
      "xchg:selectedZip",
      handleZipChange,
    );

    return () => {
      window.removeEventListener(
        "xchg:selectedZip",
        handleZipChange,
      );
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const normalizedZip = selectedZip?.trim() ?? "";

  const filteredServices = services.filter((service) => {
    const matchesSearch =
      !normalizedQuery ||
      service.title
        .toLowerCase()
        .includes(normalizedQuery);

    const matchesZip =
      !normalizedZip ||
      String(service.zip).trim() === normalizedZip;

    return matchesSearch && matchesZip;
  });

  return (
    <div className={compact ? "px-6 pt-4 pb-6" : "px-5 pt-6 pb-8"}>
      <h2 className="text-xl font-bold text-black">
        Looking for “{query || "anything"}”.
      </h2>

      {filteredServices.length > 0 ? (
        <ul
          className={cn(
            "grid",
            compact
              ? "mt-4 grid-cols-2 gap-[27px]"
              : "mt-[18px] grid-cols-1 gap-[30px] xl:grid-cols-2",
          )}
        >
          {filteredServices.map((service) => (
            <li key={service.id}>
              <ServiceCard
                service={service}
                compact={compact}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-xchg-gray">
          No services found matching “{query || "anything"}”
          {selectedZip ? ` in ${selectedZip}` : ""}.
        </p>
      )}
    </div>
  );
}

function ServiceCard({
  service,
  compact,
}: {
  service: MongoService;
  compact: boolean;
}) {
  const imageUrl =
    service.images && service.images.length > 0
      ? `/api/images/${service.images[0]}`
      : null;

  return (
    <article
      className={cn(
        "overflow-hidden bg-white shadow-[0_4px_12px_rgba(0,0,0,0.15)]",
        compact
          ? "rounded-[14px] p-3.5"
          : "rounded-[24px] p-[27px]",
      )}
    >
      <div
        className={cn(
          "relative aspect-square w-full overflow-hidden bg-zinc-100",
          compact ? "rounded-xl" : "rounded-[20px]",
        )}
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={service.title}
            fill
            unoptimized
            sizes={
              compact
                ? "(max-width: 768px) 50vw, 250px"
                : "(max-width: 1280px) 100vw, 50vw"
            }
            className="object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-zinc-400">
            No image
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex items-start justify-between gap-2",
          compact ? "mt-2.5 text-xs" : "mt-5 text-xl",
        )}
      >
        <h3 className="leading-tight text-black">
          {service.title}
        </h3>

        <p className="flex shrink-0 items-center gap-1 leading-tight">
          <span className="sr-only">Rated</span>

          {service.rating.toFixed(1)}

          <Star
            aria-hidden
            className={cn(
              "fill-xchg-star text-xchg-star",
              compact ? "size-3.5" : "size-[26px]",
            )}
          />
        </p>
      </div>

      <div
        className={cn(
          "flex justify-between gap-2 text-xchg-gray",
          compact ? "mt-1 text-[9px]" : "mt-2 text-[15px]",
        )}
      >
        <span className="truncate">
          {service.location}
        </span>

        <span className="shrink-0">
          {service.ratingCount} ratings
        </span>
      </div>

      <TagList
        tags={service.tags ?? []}
        compact={compact}
      />
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
  const rowRef = useRef<HTMLUListElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const [visible, setVisible] = useState(
    Math.min(MAX_TAGS, tags.length),
  );

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;

    if (!row || !measure) return;

    const observer = new ResizeObserver(() => {
      const gap =
        parseFloat(getComputedStyle(row).columnGap) || 0;

      const [more, ...chips] = Array.from(
        measure.children,
      ) as HTMLElement[];

      let used = 0;
      let count = 0;

      for (const chip of chips.slice(0, MAX_TAGS)) {
        const width =
          used +
          (count > 0 ? gap : 0) +
          chip.offsetWidth;

        const hidden = tags.length - count - 1;

        const reserve =
          hidden > 0
            ? gap + more.offsetWidth
            : 0;

        if (width + reserve > row.clientWidth) {
          break;
        }

        used = width;
        count += 1;
      }

      setVisible(
        tags.length === 0
          ? 0
          : Math.max(count, 1),
      );
    });

    observer.observe(row);

    return () => observer.disconnect();
  }, [tags]);

  if (tags.length === 0) {
    return null;
  }

  const chip = cn(
    "shrink-0 whitespace-nowrap bg-xchg-line text-black",
    compact
      ? "rounded px-1.5 py-1"
      : "rounded-lg px-3.5 py-2",
  );

  const hidden = tags.length - visible;

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

        {tags.map((tag) => (
          <span key={tag} className={chip}>
            {tag}
          </span>
        ))}
      </div>

      <ul
        ref={rowRef}
        className={cn(
          "flex items-center",
          compact ? "gap-1.5" : "gap-3",
        )}
      >
        {tags.slice(0, visible).map((tag) => (
          <li
            key={tag}
            className={cn(
              chip,
              "min-w-0 shrink truncate",
            )}
          >
            {tag}
          </li>
        ))}

        {hidden > 0 && (
          <li className="ml-auto shrink-0 pl-1">
            +{hidden}
          </li>
        )}
      </ul>
    </div>
  );
}