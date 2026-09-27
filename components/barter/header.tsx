"use client";

import Form from "next/form";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useState,
  type ReactNode,
  type SVGProps,
} from "react";
import { Bell, Menu, Search, X } from "lucide-react";

import type { Notification } from "@/lib/barter/data";
import { cn } from "@/lib/utils";

export type Panel =
  | "notifications"
  | "menu"
  | "filters";

export function Header({
  openPanel,
  onToggle,
  notifications,
  balance,
  query,
  filters,
}: {
  openPanel: Panel | null;
  onToggle: (panel: Panel) => void;
  notifications: Notification[];
  balance: number;
  query: string;
  filters: ReactNode;
}) {
  const router = useRouter();

  const menuOpen =
    openPanel === "menu";

  const [
    notificationsOpen,
    setNotificationsOpen,
  ] = useState(false);

  // Clicked notifications look read right away; the server's list catches up on the
  // next refresh, and a failed update takes the ID back out.
  const [readIds, setReadIds] = useState<string[]>([]);

  const [
    markingRead,
    setMarkingRead,
  ] = useState<string[]>([]);

  const localNotifications = notifications.map(
    (notification) =>
      readIds.includes(notification.id)
        ? { ...notification, read: true }
        : notification,
  );

  const unreadCount =
    localNotifications.filter(
      (notification) =>
        !notification.read,
    ).length;

  const handleNotificationClick =
    () => {
      if (
        openPanel === "filters"
      ) {
        onToggle("filters");
      }

      setNotificationsOpen(
        (current) => !current,
      );
    };

  function openNotification(href?: string) {
    if (!href) return;
    setNotificationsOpen(false);
    router.push(href);
  }

  async function readNotification(
    notification: Notification,
  ) {
    const { id, href } = notification;

    // Already-read notifications need no update; they can still open their link.
    if (notification.read) {
      openNotification(href);
      return;
    }

    if (markingRead.includes(id)) {
      return;
    }

    setReadIds((current) => [...current, id]);
    setMarkingRead((current) => [...current, id]);

    try {
      const response = await fetch(
        `/api/notifications/${encodeURIComponent(id)}`,
        { method: "PATCH" },
      );

      if (!response.ok) {
        throw new Error(`Marking the notification read failed with ${response.status}.`);
      }

      // Navigate only after the notification is saved as read.
      openNotification(href);
    } catch (error) {
      console.error(
        "Failed to mark notification as read:",
        error,
      );

      setReadIds((current) =>
        current.filter((value) => value !== id),
      );
    } finally {
      setMarkingRead(
        (current) =>
          current.filter(
            (value) =>
              value !== id,
          ),
      );
    }
  }

  return (
    <header className="relative z-30 flex h-[94px] shrink-0 items-center bg-barter-navy pr-6 pl-7 lg:pr-8 lg:pl-10">
      <button
        type="button"
        onClick={() => {
          setNotificationsOpen(
            false,
          );

          onToggle("menu");
        }}
        aria-label={
          menuOpen
            ? "Close menu"
            : "Open menu"
        }
        aria-expanded={
          menuOpen
        }
        aria-controls="mobile-menu"
        className="mr-7 text-white lg:hidden"
      >
        {menuOpen ? (
          <X
            className="size-9"
            strokeWidth={2.5}
          />
        ) : (
          <Menu
            className="size-9"
            strokeWidth={2.5}
          />
        )}
      </button>

      <Link
        href="/"
        aria-label="barter home"
        className="shrink-0"
      >
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
        <SearchInput
          query={query}
          className="h-[58px] flex-1"
        />

        <button
          type="button"
          onClick={() => {
            setNotificationsOpen(
              false,
            );

            onToggle(
              "filters",
            );
          }}
          aria-label="Filters"
          aria-expanded={
            openPanel ===
            "filters"
          }
          aria-controls="filters-panel"
          className="text-white"
        >
          <FilterIcon className="h-6 w-8" />
        </button>

        {openPanel ===
          "filters" && (
          <div
            id="filters-panel"
            className="absolute top-[calc(100%+18px)] right-0 w-[360px] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
          >
            {filters}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3 lg:ml-0 lg:gap-4">
        {/* Coin balance + hover dropdown */}
        <div className="group relative">
          <div className="flex h-10 cursor-default items-center gap-1.5 rounded-[10px] bg-barter-ink px-3 text-lg font-bold text-white lg:h-12 lg:gap-2 lg:px-4 lg:text-[26px]">
            <span className="sr-only">
              Balance:
            </span>

            {balance.toLocaleString(
              "en-US",
              {
                maximumFractionDigits: 2,
              },
            )}

            <CoinIcon className="size-5 lg:size-[26px]" />

            <span className="sr-only">
              coins
            </span>
          </div>

          {/* Invisible hover bridge between balance and dropdown */}
          <div className="absolute top-full right-0 h-3 w-full" />

          {/* Animated dropdown */}
          <div
            className={cn(
              "pointer-events-none absolute top-[calc(100%+10px)] right-0",
              "w-[280px] origin-top-right",
              "translate-y-[-8px] scale-[0.98] opacity-0",
              "transition-all duration-200 ease-out",
              "group-hover:pointer-events-auto",
              "group-hover:translate-y-0",
              "group-hover:scale-100",
              "group-hover:opacity-100",
            )}
          >
            {/* Small arrow */}
            <div className="absolute -top-2 right-5 size-4 rotate-45 bg-white" />

            <div className="relative rounded-xl bg-white p-5 text-black shadow-[0_8px_30px_rgba(0,0,0,0.22)]">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex size-9 items-center justify-center rounded-full bg-barter-ink text-white">
                  <CoinIcon className="size-5" />
                </div>

                <div>
                  <p className="text-sm font-semibold text-black">
                    Your Coins
                  </p>

                  <p className="text-xs text-gray-500">
                    Barter credit
                    balance
                  </p>
                </div>
              </div>

              <p className="text-sm leading-5 text-gray-600">
                Coins are used to
                exchange services
                with other members.
                Earn coins by
                completing services
                for others and spend
                them when booking
                services you need.
              </p>

              <div className="mt-4 border-t border-gray-200 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">
                    Current
                    balance
                  </span>

                  <div className="flex items-center gap-1.5 font-semibold text-black">
                    {balance.toLocaleString(
                      "en-US",
                      {
                        maximumFractionDigits: 2,
                      },
                    )}

                    <CoinIcon className="size-4" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            type="button"
            onClick={
              handleNotificationClick
            }
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
            aria-expanded={
              notificationsOpen
            }
            aria-controls="notifications-dropdown"
            className="relative text-white"
          >
            <Bell
              className="size-9"
              fill="currentColor"
              strokeWidth={1.5}
            />

            {unreadCount >
              0 && (
              <span className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-barter-dot ring-2 ring-barter-navy">
                <span className="sr-only">
                  {
                    unreadCount
                  }{" "}
                  unread
                  notifications
                </span>
              </span>
            )}
          </button>

          {/* Notification dropdown */}
          <div
            id="notifications-dropdown"
            className={cn(
              "absolute top-[calc(100%+10px)] right-0 z-50",
              "w-[340px] origin-top-right",
              "transition-all duration-200 ease-out",
              notificationsOpen
                ? [
                    "pointer-events-auto",
                    "translate-y-0",
                    "scale-100",
                    "opacity-100",
                  ]
                : [
                    "pointer-events-none",
                    "translate-y-[-8px]",
                    "scale-[0.98]",
                    "opacity-0",
                  ],
            )}
          >
            {/* Arrow */}
            <div className="absolute -top-2 right-5 size-4 rotate-45 bg-white" />

            <div className="relative overflow-hidden rounded-xl bg-white text-black shadow-[0_8px_30px_rgba(0,0,0,0.22)]">
              {localNotifications.length ===
              0 ? (
                <div className="p-5">
                  <div className="flex items-center gap-2">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-barter-ink text-white">
                      <Bell
                        className="size-5"
                        fill="currentColor"
                        strokeWidth={
                          1.5
                        }
                      />
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-black">
                        No new
                        notifications
                      </p>

                      <p className="text-xs text-gray-500">
                        You&apos;re
                        all caught
                        up
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="max-h-[420px] overflow-y-auto">
                  {localNotifications.map(
                    (
                      notification,
                      index,
                    ) => {
                      const text = notification.message;

                      const loading = markingRead.includes(notification.id);

                      return (
                        <button
                          key={notification.id}
                          type="button"
                          disabled={
                            loading
                          }
                          onClick={() =>
                            readNotification(
                              notification,
                            )
                          }
                          className={cn(
                            "flex w-full min-h-[68px] items-start gap-3 px-5 py-4 text-left",
                            "transition-colors hover:bg-gray-100",
                            "disabled:cursor-wait",
                            index !==
                              0 &&
                              "border-t border-gray-200",
                            notification.read
                              ? "bg-white"
                              : "bg-barter-read",
                          )}
                        >
                          <div
                            className={cn(
                              "flex size-9 shrink-0 items-center justify-center rounded-full",
                              notification.read
                                ? "bg-gray-200 text-gray-500"
                                : "bg-barter-ink text-white",
                            )}
                          >
                            <Bell
                              className="size-5"
                              fill="currentColor"
                              strokeWidth={
                                1.5
                              }
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p
                              className={cn(
                                "break-words whitespace-normal text-sm leading-5",
                                notification.read
                                  ? "font-medium text-gray-500"
                                  : "font-semibold text-black",
                              )}
                            >
                              {
                                text
                              }
                            </p>

                            {notification.read && (
                              <p className="mt-1 text-[11px] font-medium text-gray-400">
                                Read
                              </p>
                            )}
                          </div>

                          {!notification.read && (
                            <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-barter-dot">
                              <span className="sr-only">
                                Unread
                              </span>
                            </span>
                          )}
                        </button>
                      );
                    },
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <Link
          href="/profile"
          aria-label="Profile"
          className="text-white"
          onClick={() =>
            setNotificationsOpen(
              false,
            )
          }
        >
          <ProfileIcon className="size-[46px]" />
        </Link>
      </div>
    </header>
  );
}


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
        outlined &&
          "border border-barter-line px-[18px]",
        className,
      )}
    >
      <input
        key={query}
        name="search"
        type="search"
        defaultValue={query}
        aria-label="Search services"
        placeholder="Search..."
        className="min-w-0 flex-1 self-stretch bg-transparent text-[15px] text-black outline-none placeholder:text-black [&::-webkit-search-cancel-button]:hidden"
      />

      <button
        type="submit"
        aria-label="Search"
        className="shrink-0 text-black"
      >
        <Search
          aria-hidden
          className="size-6"
          strokeWidth={2}
        />
      </button>
    </Form>
  );
}

function FilterIcon(
  props: SVGProps<SVGSVGElement>,
) {
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
      <circle
        cx="11"
        cy="4"
        r="3"
      />
      <circle
        cx="22"
        cy="12"
        r="3"
      />
      <circle
        cx="14"
        cy="20"
        r="3"
      />
    </svg>
  );
}

function CoinIcon(
  props: SVGProps<SVGSVGElement>,
) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      aria-hidden
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
      />
      <path d="M15.2 9.3a4.2 4.2 0 1 0 0 5.4" />
    </svg>
  );
}

function ProfileIcon(
  props: SVGProps<SVGSVGElement>,
) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      {...props}
    >
      <defs>
        <clipPath id="barter-profile-clip">
          <circle
            cx="24"
            cy="24"
            r="22"
          />
        </clipPath>
      </defs>

      <circle
        cx="24"
        cy="24"
        r="22.5"
        stroke="currentColor"
        strokeWidth={2}
      />

      <g
        clipPath="url(#barter-profile-clip)"
        fill="currentColor"
      >
        <circle
          cx="24"
          cy="19"
          r="8"
        />
        <path d="M8 46c0-9 7.2-16 16-16s16 7 16 16z" />
      </g>
    </svg>
  );
}