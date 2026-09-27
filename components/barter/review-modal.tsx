"use client";

import { useRouter } from "next/navigation";
import { Star, X } from "lucide-react";
import { useState } from "react";

import { Modal } from "./modal";
import { cn } from "@/lib/utils";

export function ReviewModal({
  bookingId,
  serviceTitle,
  canReview = true,
  reviewed = false,
  requiredBy,
}: {
  bookingId: string;
  serviceTitle: string;
  canReview?: boolean;
  /** Whether the viewer already reviewed this booking. */
  reviewed?: boolean;
  /** When the other person finished the barter: their first name. The review can't be closed until it's sent. */
  requiredBy?: string;
}) {
  const router = useRouter();

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bookings have no page of their own, so the review returns to the map.
  function closeModal() {
    router.push("/");
  }

  async function submitReview() {
    if (submitting) {
      return;
    }

    if (rating < 1 || rating > 5) {
      setError("Please choose a rating.");
      return;
    }

    if (!comment.trim()) {
      setError("Please write a review.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookingId,
          rating,
          comment: comment.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          response.status === 429
            ? "Too many changes. Please wait a minute and try again."
            : data?.error?.message ?? "Failed to submit review",
        );
      }

      router.push("/");
      router.refresh();
    } catch (error) {
      console.error("Failed to submit review:", error);

      setError(
        error instanceof Error
          ? error.message
          : "Failed to submit review",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const displayedRating = hoverRating || rating;

  return (
    <Modal
      open
      onClose={closeModal}
      labelledBy="review-title"
      closeOnBackdrop={!requiredBy}
      dismissDisabled={Boolean(requiredBy)}
      className="lg:max-w-[760px]"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 pb-8 lg:px-[66px] lg:pt-[42px] lg:pb-[58px]">
        {/* Header */}
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1
              id="review-title"
              className="font-mono text-[28px] leading-tight font-extrabold lg:text-[40px]"
            >
              Leave a review
            </h1>

            <p className="mt-2 font-mono text-base text-barter-gray lg:text-lg">
              {serviceTitle}
            </p>

            {requiredBy && (
              <p className="mt-3 font-mono text-base text-barter-gray lg:text-lg">
                {requiredBy} finished this barter. Leave them a review to keep bartering.
              </p>
            )}
          </div>

          {!requiredBy && <button
            type="button"
            onClick={closeModal}
            aria-label="Close"
            className="shrink-0"
          >
            <X
              className="size-8 lg:size-10"
              strokeWidth={2.5}
            />
          </button>}
        </div>

        {!canReview ? (
          <div className="mt-10">
            <p className="font-mono text-lg text-barter-gray">
              {reviewed
                ? "You already reviewed this booking. Thanks!"
                : "This booking must be completed before you can leave a review."}
            </p>

            <button
              type="button"
              onClick={closeModal}
              className="mt-8 flex h-14 w-full items-center justify-center rounded-[10px] bg-barter-navy px-10 font-mono text-xl font-extrabold text-white transition-opacity hover:opacity-90 lg:h-[68px] lg:text-2xl"
            >
              Back to barter
            </button>
          </div>
        ) : (
          <>
            {/* Rating */}
            <section className="mt-10">
              <h2 className="font-mono text-xl font-bold lg:text-2xl">
                How was your experience?
              </h2>

              <div
                className="mt-5 flex gap-2"
                onMouseLeave={() => setHoverRating(0)}
              >
                {Array.from(
                  { length: 5 },
                  (_, index) => {
                    const value = index + 1;
                    const filled =
                      value <= displayedRating;

                    return (
                      <div
                        key={value}
                        className="flex flex-col items-center"
                      >
                        <button
                          type="button"
                          onMouseEnter={() =>
                            setHoverRating(value)
                          }
                          onFocus={() =>
                            setHoverRating(value)
                          }
                          onBlur={() =>
                            setHoverRating(0)
                          }
                          onClick={() => {
                            setRating(value);
                            setError(null);
                          }}
                          aria-label={`${value} ${
                            value === 1
                              ? "star"
                              : "stars"
                          }`}
                          aria-pressed={
                            rating === value
                          }
                          className="rounded-md p-1 focus-visible:outline-[3px] focus-visible:outline-barter-blue"
                        >
                          <Star
                            className={cn(
                              "size-10 transition lg:size-12",
                              filled
                                ? "fill-barter-star text-barter-star"
                                : "fill-barter-line text-barter-line",
                            )}
                            strokeWidth={1.5}
                          />
                        </button>

                        <p className="mt-1 h-6 whitespace-nowrap font-mono text-sm font-bold text-barter-gray">
                          {displayedRating === value
                            ? `${displayedRating} / 5`
                            : ""}
                        </p>
                      </div>
                    );
                  },
                )}
              </div>
            </section>

            {/* Comment */}
            <section className="mt-7">
              <label
                htmlFor="review-comment"
                className="font-mono text-xl font-bold lg:text-2xl"
              >
                Tell us more
              </label>

              <textarea
                id="review-comment"
                value={comment}
                onChange={(event) => {
                  setComment(event.target.value);
                  setError(null);
                }}
                maxLength={2000}
                rows={7}
                placeholder="What was your experience like?"
                className="mt-4 w-full resize-none rounded-[14px] border border-barter-line bg-white px-4 py-4 font-mono text-base outline-none transition placeholder:text-barter-gray focus:border-barter-blue lg:px-5 lg:py-5 lg:text-lg"
              />

              <div className="mt-2 flex justify-end">
                <span className="font-mono text-sm text-barter-gray">
                  {comment.length} / 2000
                </span>
              </div>
            </section>

            {error && (
              <p className="mt-5 font-mono text-sm font-bold text-red-600">
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row">
              {!requiredBy && <button
                type="button"
                onClick={closeModal}
                disabled={submitting}
                className="flex h-14 flex-1 items-center justify-center rounded-[10px] border border-barter-line bg-white px-8 font-mono text-lg font-extrabold transition hover:bg-barter-read disabled:cursor-not-allowed disabled:opacity-50 lg:h-[68px] lg:text-xl"
              >
                Cancel
              </button>}

              <button
                type="button"
                onClick={submitReview}
                disabled={
                  submitting ||
                  rating === 0 ||
                  !comment.trim()
                }
                className="flex h-14 flex-1 items-center justify-center rounded-[10px] bg-barter-navy px-8 font-mono text-lg font-extrabold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-barter-blue lg:h-[68px] lg:text-xl"
              >
                {submitting
                  ? "Submitting..."
                  : "Submit review"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}