"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import type { ZipArea } from "@/lib/barter/data";

export type ServiceFilters = {
  categories: string[];
  zips: string[];
  minRating: number;
};

const RATINGS = [
  {
    label: "Any rating",
    value: 0,
  },
  {
    label: "3+ stars",
    value: 3,
  },
  {
    label: "4+ stars",
    value: 4,
  },
  {
    label: "4.5+ stars",
    value: 4.5,
  },
];

export function FiltersPanel({
  genres,
  zips,
  filters,
  onChange,
}: {
  genres: string[];
  zips: ZipArea[];
  filters: ServiceFilters;
  onChange: (
    filters: ServiceFilters,
  ) => void;
}) {
  function toggleGenre(
    genre: string,
  ) {
    const currentlySelected =
      filters.categories.includes(
        genre,
      );

    onChange({
      ...filters,
      categories: currentlySelected
        ? filters.categories.filter(
            (category) =>
              category !== genre,
          )
        : [
            ...filters.categories,
            genre,
          ],
    });
  }

  function toggleZip(zip: string) {
    const currentlySelected =
      filters.zips.includes(zip);

    onChange({
      ...filters,
      zips: currentlySelected
        ? filters.zips.filter(
            (currentZip) =>
              currentZip !== zip,
          )
        : [...filters.zips, zip],
    });
  }

  function setRating(
    minRating: number,
  ) {
    onChange({
      ...filters,
      minRating,
    });
  }

  function clearFilters() {
    onChange({
      categories: [],
      zips: [],
      minRating: 0,
    });
  }

  const hasFilters =
    filters.categories.length > 0 ||
    filters.zips.length > 0 ||
    filters.minRating > 0;

  return (
    <div className="border-x border-b border-barter-line bg-white">
      {/* GENRE */}
      <FilterSection title="Genre">
        {genres.map((genre) => (
          <Option
            key={genre}
            type="checkbox"
            name="genre"
            label={genre}
            checked={filters.categories.includes(
              genre,
            )}
            onChange={() =>
              toggleGenre(genre)
            }
          />
        ))}
      </FilterSection>

      {/* LOCATION */}
      <FilterSection title="Location">
        {zips.map(
          ({
            zip,
            neighborhood,
          }) => (
            <Option
              key={zip}
              type="checkbox"
              name="zip"
              label={
                neighborhood
                  ? `${zip} · ${neighborhood}`
                  : zip
              }
              checked={filters.zips.includes(
                zip,
              )}
              onChange={() =>
                toggleZip(zip)
              }
            />
          ),
        )}
      </FilterSection>

      {/* RATING */}
      <FilterSection title="Rating">
        {RATINGS.map(
          ({ label, value }) => (
            <Option
              key={value}
              type="radio"
              name="rating"
              label={label}
              checked={
                filters.minRating ===
                value
              }
              onChange={() =>
                setRating(value)
              }
            />
          ),
        )}
      </FilterSection>

      {/* CLEAR FILTERS */}
      {hasFilters && (
        <div className="border-t border-barter-line px-6 py-5">
          <button
            type="button"
            onClick={clearFilters}
            className="text-[15px] font-medium text-barter-navy underline underline-offset-4"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="group border-t border-barter-line">
      <summary className="flex h-[67px] cursor-pointer list-none items-center justify-between px-6 text-[15px] text-black [&::-webkit-details-marker]:hidden">
        {title}

        <ChevronDown
          aria-hidden
          className="size-7 text-[#636363] transition-transform group-open:rotate-180"
          strokeWidth={1.25}
        />
      </summary>

      <div className="flex max-h-[260px] flex-col gap-3 overflow-y-auto px-6 pb-5">
        {children}
      </div>
    </details>
  );
}

function Option({
  type,
  name,
  label,
  checked,
  onChange,
}: {
  type: "checkbox" | "radio";
  name: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-[15px] text-black">
      <input
        type={type}
        name={name}
        checked={checked}
        onChange={onChange}
        className="size-4 shrink-0 accent-barter-navy"
      />

      <span>{label}</span>
    </label>
  );
}