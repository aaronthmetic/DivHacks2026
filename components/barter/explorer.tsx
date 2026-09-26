"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { Notification, Service, ZipArea } from "@/lib/barter/data";
import { Header, type Panel, SearchInput } from "./header";
import { FiltersPanel, NotificationsPanel } from "./panels";
import { ResultsPanel } from "./results";

// The map checks the window size, so it only renders in the browser.
const ServiceMap = dynamic(() => import("./service-map"), {
  ssr: false,
  loading: () => <div className="size-full bg-[#e9ecef]" />,
});

// UI only for now: panels open and close, but search, filters, marker
// selection and dragging the results sheet aren't wired up yet.
export function Explorer({
  services,
  areas,
  notifications,
  initialZip,
  mapsApiKey,
  mapsMapId,
  query = "",
}: {
  services: Service[];
  areas: ZipArea[];
  notifications: Notification[];
  initialZip: string | null;
  mapsApiKey?: string;
  mapsMapId?: string;
  query?: string;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const toggle = (next: Panel) =>
    setPanel((current) => (current === next ? null : next));

  useEffect(() => {
    if (!panel) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [panel]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const filters = (
    <FiltersPanel
      genres={[...new Set(services.map((service) => service.category))]}
      zips={areas}
    />
  );

  return (
    <div className="flex h-dvh flex-col">
      <Header
        openPanel={panel}
        onToggle={toggle}
        unreadCount={unreadCount}
        filters={filters}
      />
      <main className="relative flex min-h-0 flex-1 bg-[#e9ecef]">
        {(panel === "notifications" || panel === "filters") && (
          // Click-away layer for the desktop dropdowns (Escape also closes them).
          <div
            aria-hidden
            className="fixed inset-0 z-10 hidden lg:block"
            onClick={() => setPanel(null)}
          />
        )}
        {/* On phones the map stops where the results sheet starts, so Google's
            logo and terms at its bottom edge stay visible. */}
        <div className="absolute inset-x-0 top-0 bottom-[45%] lg:relative lg:inset-auto lg:flex-none lg:basis-[60%]">
          <ServiceMap
            apiKey={mapsApiKey}
            mapId={mapsMapId}
            areas={areas}
            services={services}
            initialZip={initialZip}
          />
        </div>
        {/* Scroll areas are `relative` so absolutely positioned children (the
            cards' sr-only labels) stay inside them; otherwise they're placed
            against <main> and stretch the whole page. */}
        <section
          aria-label="Results"
          className="relative hidden min-w-0 flex-1 overflow-y-auto lg:block"
        >
          <ResultsPanel services={services} query={query} />
        </section>
        <section
          aria-label="Results"
          className="absolute inset-x-0 bottom-0 flex h-[45%] flex-col rounded-t-3xl bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.12)] lg:hidden"
        >
          <div
            aria-hidden
            className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-barter-line"
          />
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            <ResultsPanel services={services} query={query} compact />
          </div>
        </section>
        {panel === "notifications" && (
          <div
            id="notifications-panel"
            className="absolute inset-0 z-20 overflow-y-auto bg-white lg:inset-auto lg:top-0 lg:right-4 lg:max-h-full lg:w-[618px] lg:shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
          >
            <NotificationsPanel notifications={notifications} />
          </div>
        )}
        {panel === "menu" && (
          <div
            id="mobile-menu"
            className="absolute inset-0 z-20 overflow-y-auto bg-white lg:hidden"
          >
            <div className="px-4 pt-[13px] pb-3">
              <SearchInput outlined className="h-14" />
            </div>
            {filters}
          </div>
        )}
      </main>
    </div>
  );
}
