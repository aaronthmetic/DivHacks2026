"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Star, X } from "lucide-react";
import type { Service } from "@/lib/barter/data";
import { formatAvailability } from "@/lib/availability";
import { starFill } from "@/lib/profile-display";
import { cn } from "@/lib/utils";
import { Modal } from "./modal";
import { ServiceArt } from "./results";
import { useState } from "react";

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
              <h3 className="mt-6 font-mono text-xl font-bold lg:mt-8 lg:text-2xl">Availability</h3>
              <p className="mt-3 font-mono text-base text-barter-gray lg:mt-4 lg:text-xl">
                {formatAvailability(service.availability)}
                {service.availability.length > 0 && " (New York time)"}
              </p>
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
  const [currentIndex, setCurrentIndex] = useState(0);

  const images = service.images ?? [];
  const imageCount = images.length;

  if (imageCount === 0) {
    return (
      <ServiceArt
        category={service.category}
        className="mt-6 h-48 rounded-[16px] lg:mt-[37px] lg:h-[468px] lg:rounded-[20px]"
        iconClassName="size-16 lg:size-24"
      />
    );
  }

  const previousImage = () => {
    setCurrentIndex((current) =>
      current === 0 ? imageCount - 1 : current - 1,
    );
  };

  const nextImage = () => {
    setCurrentIndex((current) =>
      current === imageCount - 1 ? 0 : current + 1,
    );
  };

  return (
    <div className="mt-6 lg:mt-[37px]">
      <div className="relative h-64 overflow-hidden rounded-[16px] bg-barter-read lg:h-[468px] lg:rounded-[20px]">
        {/* Current image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[currentIndex]}
          alt={`${service.title}, photo ${currentIndex + 1}`}
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden";
          }}
          className="size-full object-contain"
        />

        {/* Previous button */}
        {imageCount > 1 && (
          <button
            type="button"
            onClick={previousImage}
            aria-label="Previous image"
            className="absolute top-1/2 left-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/75 lg:size-12"
          >
            <ChevronLeft className="size-6 lg:size-8" />
          </button>
        )}

        {/* Next button */}
        {imageCount > 1 && (
          <button
            type="button"
            onClick={nextImage}
            aria-label="Next image"
            className="absolute top-1/2 right-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/75 lg:size-12"
          >
            <ChevronRight className="size-6 lg:size-8" />
          </button>
        )}

        {/* Image counter */}
        {imageCount > 1 && (
          <div className="absolute top-3 right-3 rounded-lg bg-black/60 px-3 py-1.5 font-mono text-sm font-bold text-white">
            {currentIndex + 1} / {imageCount}
          </div>
        )}
      </div>

      {/* Carousel dots */}
      {imageCount > 1 && (
        <div className="mt-3 flex justify-center gap-2">
          {images.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setCurrentIndex(index)}
              aria-label={`View image ${index + 1}`}
              aria-current={currentIndex === index ? "true" : undefined}
              className={cn(
                "size-2.5 rounded-full transition-all",
                currentIndex === index
                  ? "scale-110 bg-barter-navy"
                  : "bg-barter-line hover:bg-barter-gray",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
