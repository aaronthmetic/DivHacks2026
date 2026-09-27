"use client";

import Link from "next/link";
import { Star, X } from "lucide-react";
import type { Service } from "@/lib/barter/data";
import { starFill } from "@/lib/profile-display";
import { cn } from "@/lib/utils";
import { Modal } from "./modal";
import { ServiceArt } from "./results";

export function ListingModal({
  service,
  onClose,
}: {
  service: Service | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={service !== null}
      onClose={onClose}
      labelledBy="listing-title"
      closeOnBackdrop
      className="lg:max-h-[min(843px,calc(100dvh-4rem))]"
    >
      {service && (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 pb-8 lg:pt-[42px] lg:pr-[59px] lg:pb-[58px] lg:pl-[66px]">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h2
                id="listing-title"
                className="font-mono text-[28px] leading-tight font-extrabold break-words lg:text-[40px]"
              >
                {service.title}
              </h2>
              <Rating service={service} className="mt-2 lg:hidden" />
            </div>
            <Rating service={service} className="hidden lg:flex lg:pt-2" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 lg:ml-3"
            >
              <X className="size-8 lg:size-10" strokeWidth={2.5} />
            </button>
          </div>
          <Gallery service={service} />
          <div className="mt-7 flex flex-col gap-6 lg:mt-8 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
            <section aria-labelledby="listing-description" className="min-w-0 lg:max-w-[770px]">
              <h3 id="listing-description" className="font-mono text-xl font-bold lg:text-2xl">
                Description
              </h3>
              <p className="mt-4 font-mono text-base whitespace-pre-wrap text-barter-gray [overflow-wrap:anywhere] lg:mt-5 lg:text-xl">
                {service.description}
              </p>
              <ul aria-label="Details" className="mt-5 flex flex-wrap gap-2 font-mono text-sm font-bold">
                {[...new Set([service.category, service.location, ...service.tags])].map((detail) => (
                  <li key={detail} className="rounded-lg bg-barter-read px-3 py-1.5">
                    {detail}
                  </li>
                ))}
              </ul>
            </section>
            {/* Messaging doesn't exist yet, so Contact opens the provider's profile. */}
            <Link
              href={service.own ? "/profile" : `/profile/${service.providerId}`}
              aria-label={service.own ? "View your profile" : `Contact ${service.providerName}`}
              className="flex h-14 shrink-0 items-center justify-center rounded-[10px] bg-barter-navy px-10 font-mono text-xl font-extrabold text-white transition-opacity hover:opacity-90 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-barter-blue lg:h-[68px] lg:text-2xl"
            >
              {service.own ? "Your profile" : "Contact"}
            </Link>
          </div>
        </div>
      )}
    </Modal>
  );
}

// The provider's average from reviews, as five partly filled stars and a count.
function Rating({ service, className }: { service: Service; className?: string }) {
  const value = service.ratingCount ? service.rating : 0;
  return (
    <p className={cn("flex shrink-0 items-center gap-2", className)}>
      <span className="sr-only">
        {service.ratingCount
          ? `Rated ${value.toFixed(1)} out of 5 from ${service.ratingCount} ${service.ratingCount === 1 ? "review" : "reviews"}`
          : "No reviews yet"}
      </span>
      <span aria-hidden className="flex gap-1">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className="relative size-6 lg:size-[34px]">
            <Star className="absolute inset-0 size-full fill-barter-line text-barter-line" strokeWidth={1} />
            <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${starFill(value, index)}%` }}>
              <Star className="size-6 max-w-none fill-barter-star text-barter-star lg:size-[34px]" strokeWidth={1} />
            </span>
          </span>
        ))}
      </span>
      <span aria-hidden className="font-mono text-lg font-bold text-barter-gray lg:text-[22px]">
        ({service.ratingCount})
      </span>
    </p>
  );
}

// One large photo with two stacked beside it, as in the mockup; fewer photos share the row.
function Gallery({ service }: { service: Service }) {
  const [first, second, third] = service.images;
  const more = service.images.length - 3;
  if (!first) {
    return (
      <ServiceArt
        category={service.category}
        className="mt-6 h-48 rounded-[16px] lg:mt-[37px] lg:h-[300px] lg:rounded-[20px]"
        iconClassName="size-16 lg:size-24"
      />
    );
  }
  const photo = (src: string, index: number) => (
    // GridFS photos come from the app's image route; the browser loader handles them.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${service.title}, photo ${index + 1}`}
      onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
      className="size-full rounded-[16px] object-cover lg:rounded-[20px]"
    />
  );
  return (
    <div
      className={cn(
        "mt-6 grid h-64 gap-3 lg:mt-[37px] lg:h-[468px] lg:gap-4",
        third ? "grid-cols-[1.4fr_1fr] grid-rows-2" : second ? "grid-cols-2" : "grid-cols-1",
      )}
    >
      {[first, second, third].map((src, index) =>
        src ? (
          <div
            key={src}
            className={cn(
              "relative min-h-0 rounded-[16px] bg-barter-read lg:rounded-[20px]",
              index === 0 && third && "row-span-2",
            )}
          >
            {photo(src, index)}
            {index === 2 && more > 0 && (
              <span className="absolute right-3 bottom-3 rounded-lg bg-black/60 px-2.5 py-1 font-mono text-sm font-bold text-white">
                +{more}
              </span>
            )}
          </div>
        ) : null,
      )}
    </div>
  );
}
