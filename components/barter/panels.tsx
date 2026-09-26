import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { Notification, ZipArea } from "@/lib/barter/data";
import { cn } from "@/lib/utils";

export function NotificationsPanel({
  notifications,
}: {
  notifications: Notification[];
}) {
  return (
    <ul className="border-x border-b border-barter-line">
      {notifications.map((notification) => (
        <li
          key={notification.id}
          className={cn(
            "flex h-[68px] items-center justify-between gap-4 border-t border-barter-line px-6 text-[15px] lg:px-9",
            notification.read
              ? "bg-barter-read text-barter-gray"
              : "bg-white text-black",
          )}
        >
          <span className="truncate">{notification.text}</span>
          {!notification.read && (
            <span className="size-[13px] shrink-0 rounded-full bg-barter-dot">
              <span className="sr-only">Unread</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

const RATINGS = ["Any rating", "3+ stars", "4+ stars", "4.5+ stars"];

// Static options for now: nothing filters yet.
export function FiltersPanel({
  genres,
  zips,
}: {
  genres: string[];
  zips: ZipArea[];
}) {
  return (
    <div className="border-x border-b border-barter-line">
      <FilterSection title="Genre">
        {genres.map((genre) => (
          <Option key={genre} type="checkbox" name="genre" label={genre} />
        ))}
      </FilterSection>
      <FilterSection title="Location">
        {zips.map(({ zip, neighborhood }) => (
          <Option
            key={zip}
            type="checkbox"
            name="zip"
            label={`${zip} · ${neighborhood}`}
          />
        ))}
      </FilterSection>
      <FilterSection title="Rating">
        {RATINGS.map((rating, index) => (
          <Option
            key={rating}
            type="radio"
            name="rating"
            label={rating}
            defaultChecked={index === 0}
          />
        ))}
      </FilterSection>
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
      <div className="flex flex-col gap-3 px-6 pb-5">{children}</div>
    </details>
  );
}

function Option({
  type,
  name,
  label,
  defaultChecked,
}: {
  type: "checkbox" | "radio";
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-3 text-[15px] text-black">
      <input
        type={type}
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-barter-navy"
      />
      {label}
    </label>
  );
}
