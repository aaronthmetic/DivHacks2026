"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreateListingModal } from "@/components/barter/create-listing";
import { useState, useTransition } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Star,
} from "lucide-react";
import type { ProfileCard, ProfileData } from "@/lib/profile-data";
import { DEFAULT_AVATAR, starFill } from "@/lib/profile-display";
import { ListingModal } from "@/components/barter/listing-modal";
import type { CategoryOption, Service } from "@/lib/barter/data";
import { buttonVariants } from "@/components/ui/button";
import { ProfileShell } from "./shell";
import { LogoutButton } from "@/components/auth/forms";
import { profileCard, profilePrimaryButton, profileSecondaryButton } from "./styles";

export function Avatar({
  src,
  name,
  large = false,
}: {
  src?: string | null;
  name: string;
  large?: boolean;
}) {
  // GridFS and OAuth images have dynamic origins; use the browser's image loader.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src || DEFAULT_AVATAR}
      alt={`${name}'s profile picture`}
      referrerPolicy="no-referrer"
      onError={(e) => {
        if (!e.currentTarget.src.endsWith(DEFAULT_AVATAR)) {
          e.currentTarget.src = DEFAULT_AVATAR;
        }
      }}
      className={`${
        large ? "size-32" : "size-10"
      } shrink-0 rounded-full bg-muted object-cover`}
    />
  );
}

export function Stars({
  rating,
  count,
}: {
  rating: number;
  count?: number;
}) {
  const value = count === 0 ? 0 : rating;

  return (
    <span
      className="inline-flex items-center gap-2"
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars${
        count === undefined ? "" : `, ${count} reviews`
      }`}
    >
      <span className="flex" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className="relative block size-6 text-amber-500"
          >
            <Star className="size-6" />

            <span
              className="absolute inset-y-0 left-0 overflow-hidden"
              style={{
                width: `${starFill(value, i)}%`,
              }}
            >
              <Star className="size-6 max-w-none fill-current" />
            </span>
          </span>
        ))}
      </span>

      {count !== undefined && (
        <span
          aria-hidden="true"
          className="text-sm text-barter-gray"
        >
          ({count})
        </span>
      )}
    </span>
  );
}

function BookingModal({
  card,
  onClose,
}: {
  card: ProfileCard | undefined;
  onClose: () => void;
}) {
  return (
    <ListingModal
      service={
        card
          ? {
              id: card.id,
              title: card.title,
              description: card.description,
              category: card.category ?? "Other",

              images:
                card.images ??
                (card.image ? [card.image] : []),

              rating: card.rating ?? 0,
              ratingCount: card.ratingCount ?? 0,

              location: card.location ?? "Remote",
              zip: card.zip ?? null,

              tags: card.tags ?? card.lines,

              availability: card.availability ?? [],

              pricingType: card.pricingType ?? "fixed",
              creditRate: card.creditRate ?? 0,
              providerTextsEnabled: card.providerTextsEnabled ?? false,

              providerId:
                card.providerId ??
                card.provider?.id ??
                "",

              providerName:
                card.providerName ??
                card.provider?.name ??
                "Member",

              own: false,
            }
          : null
      }
      onClose={onClose}
    />
  );
}

function Carousel({
  title,
  cards,
  listings = false,
  categories = [],
  canEdit = false,
}: {
  title: string;
  cards: ProfileCard[];
  listings?: boolean;
  categories?: CategoryOption[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [editing, setEditing] = useState(false);
  const [index, setIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const card =
    cards[Math.min(index, Math.max(0, cards.length - 1))];

  const selected = cards.find(
    (item) => item.id === selectedId,
  );

  const modalService: Service | null = selected
    ? {
        id: selected.id,

        title: selected.title,

        description: selected.description,

        category: selected.category ?? "Other",

        images:
          selected.images ??
          (selected.image ? [selected.image] : []),

        rating: selected.rating ?? 0,

        ratingCount: selected.ratingCount ?? 0,

        location: selected.location ?? "Remote",

        zip: selected.zip ?? null,

        tags: selected.tags ?? selected.lines,

        availability: selected.availability ?? [],

        pricingType: selected.pricingType ?? "fixed",

        creditRate: selected.creditRate ?? 0,

        providerTextsEnabled: selected.providerTextsEnabled ?? false,

        providerId:
          selected.providerId ??
          selected.provider?.id ??
          "",

        providerName:
          selected.providerName ??
          selected.provider?.name ??
          "Member",

        own: selected.own ?? false,
      }
    : null;

  return (
    <section
      className={`flex min-w-0 flex-col ${profileCard}`}
      aria-label={title}
    >
      <h2 className="mb-4 text-xl font-bold text-black">
        {title}
      </h2>

      {card ? (
        <>
          <button
            onClick={() => setSelectedId(card.id)}
            className="w-full flex-1 content-start space-y-3 rounded-xl border border-barter-line p-4 text-left transition hover:bg-barter-read focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-barter-blue"
            aria-label={`View ${card.title} details`}
          >
            <h3 className="text-lg font-semibold">
              {card.title}
            </h3>

            {card.provider && (
              <p>
                With {card.provider.name}
              </p>
            )}

            {card.lines.map((line, i) => (
              <p
                key={i}
                className="text-sm capitalize text-barter-gray"
              >
                {line}
              </p>
            ))}

            <p className="text-sm underline">
              View details
            </p>
          </button>

          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              className={buttonVariants({
                variant: "outline",
                size: "icon",
                className: "size-10 border-barter-line text-barter-navy hover:bg-barter-read focus-visible:ring-barter-blue/30",
              })}
              aria-label={`Previous ${title.toLowerCase()}`}
              disabled={index === 0}
              onClick={() =>
                setIndex(
                  Math.max(
                    0,
                    Math.min(index, cards.length - 1) - 1,
                  ),
                )
              }
            >
              <ChevronLeft />
            </button>

            <span
              aria-live="polite"
              className="text-sm"
            >
              {Math.min(index + 1, cards.length)} of{" "}
              {cards.length}
            </span>

            <button
              type="button"
              className={buttonVariants({
                variant: "outline",
                size: "icon",
                className: "size-10 border-barter-line text-barter-navy hover:bg-barter-read focus-visible:ring-barter-blue/30",
              })}
              aria-label={`Next ${title.toLowerCase()}`}
              disabled={index >= cards.length - 1}
              onClick={() =>
                setIndex((i) => i + 1)
              }
            >
              <ChevronRight />
            </button>
          </div>

          {listings ? (
            <>
              <ListingModal
                service={
                  editing
                    ? null
                    : modalService
                }
                onClose={() =>
                  setSelectedId(null)
                }
                onEdit={
                  canEdit &&
                  selected?.editable
                    ? () => setEditing(true)
                    : undefined
                }
              />

              {canEdit &&
                selected?.editable && (
                  <CreateListingModal
                    key={selected.id}
                    open={editing}
                    listing={
                      selected.editable
                    }
                    categories={
                      categories
                    }
                    onClose={() =>
                      setEditing(false)
                    }
                    onPublished={() => {
                      startTransition(
                        () => {
                          router.refresh();
                          setEditing(false);
                        },
                      );
                    }}
                    onDeleted={() => {
                      setEditing(false);
                      setSelectedId(null);

                      setIndex((i) =>
                        Math.max(
                          0,
                          Math.min(
                            i,
                            cards.length - 2,
                          ),
                        ),
                      );

                      router.refresh();
                    }}
                  />
                )}
            </>
          ) : (
            <BookingModal
              card={selected}
              onClose={() =>
                setSelectedId(null)
              }
            />
          )}
        </>
      ) : (
        <p className="flex flex-1 items-center justify-center py-12 text-center text-barter-gray">
          {listings
            ? "No listings to show yet."
            : "No upcoming or pending bookings."}
        </p>
      )}
    </section>
  );
}

export function ProfileView({
  profile,
  basePath,
}: {
  profile: ProfileData;
  basePath: string;
}) {
  return (
    <ProfileShell>
        <header className="mb-8 flex flex-col items-center gap-4 py-6 text-center">
          <Avatar
            src={profile.image}
            name={profile.name}
            large
          />

          <h1 className="text-3xl font-bold text-barter-navy">
            {profile.name}
          </h1>

          <Stars
            rating={profile.rating}
            count={profile.reviewCount}
          />

          {profile.isOwner && (
            <div className="flex flex-wrap items-start justify-center gap-3">
            <Link
              href="/profile/edit"
              className={profilePrimaryButton}
            >
              Edit profile
            </Link>
            <LogoutButton className={profileSecondaryButton} />
            </div>
          )}
        </header>

        <div
          className={`grid items-stretch gap-6 ${
            profile.isOwner
              ? "md:grid-cols-2"
              : ""
          }`}
        >
          <Carousel
            title="Listings"
            cards={profile.listings}
            listings
            canEdit={profile.isOwner}
            categories={
              profile.categories
            }
          />

          {profile.isOwner && (
            <Carousel
              title="Bookings"
              cards={profile.bookings}
            />
          )}
        </div>

        <section
          className={`mt-8 ${profileCard}`}
          aria-labelledby="reviews-heading"
        >
          <h2
            id="reviews-heading"
            className="text-xl font-bold text-black"
          >
            Reviews
          </h2>

          {profile.reviews.length ? (
            <ul className="divide-y divide-barter-line">
              {profile.reviews.map(
                (review) => (
                  <li
                    key={review.id}
                    className="space-y-3 py-6"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar
                        src={
                          review.authorImage
                        }
                        name={
                          review.authorName
                        }
                      />

                      <Link
                        href={`/profile/${review.authorId}`}
                        className="font-medium text-barter-navy underline decoration-barter-navy/30 underline-offset-4 hover:decoration-barter-navy"
                      >
                        {
                          review.authorName
                        }
                      </Link>

                      <time
                        dateTime={
                          review.date
                        }
                        className="ml-auto text-sm text-barter-gray"
                      >
                        {review.date}
                      </time>
                    </div>

                    {/* Service this review came from */}
                    <div className="text-sm">
                      <span className="text-barter-gray">
                        Service:
                      </span>{" "}
                      <span className="font-medium text-barter-navy">
                        {review.serviceTitle ??
                          "Unknown service"}
                      </span>
                    </div>

                    <Stars
                      rating={
                        review.rating
                      }
                    />

                    <p className="whitespace-pre-wrap break-words">
                      {
                        review.comment
                      }
                    </p>
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className="py-6 text-barter-gray">
              No reviews yet.
            </p>
          )}

          {profile.reviewPages >
            1 && (
            <nav
              aria-label="Review pages"
              className="flex items-center justify-between gap-4 border-t pt-4"
            >
              {profile.reviewsPage >
              1 ? (
                <Link
                  className="underline"
                  href={`${basePath}?reviewsPage=${
                    profile.reviewsPage -
                    1
                  }#reviews-heading`}
                >
                  Previous
                </Link>
              ) : (
                <span className="text-barter-gray">
                  Previous
                </span>
              )}

              <span>
                Page{" "}
                {
                  profile.reviewsPage
                }{" "}
                of{" "}
                {
                  profile.reviewPages
                }
              </span>

              {profile.reviewsPage <
              profile.reviewPages ? (
                <Link
                  className="underline"
                  href={`${basePath}?reviewsPage=${
                    profile.reviewsPage +
                    1
                  }#reviews-heading`}
                >
                  Next
                </Link>
              ) : (
                <span className="text-barter-gray">
                  Next
                </span>
              )}
            </nav>
          )}
        </section>
    </ProfileShell>
  );
}
