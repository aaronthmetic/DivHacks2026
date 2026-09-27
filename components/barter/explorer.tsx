"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";

import type {
  CategoryOption,
  Notification,
  Service,
  ZipArea,
} from "@/lib/barter/data";

import { CreateListingModal } from "./create-listing";
import { Header, type Panel, SearchInput } from "./header";
import { ListingModal } from "./listing-modal";
import {
  FiltersPanel,
  NotificationsPanel,
  type ServiceFilters,
} from "./panels";
import { ResultsPanel } from "./results";

const ServiceMap = dynamic(() => import("./service-map"), {
  ssr: false,
  loading: () => <div className="size-full bg-[#e9ecef]" />,
});

const DEFAULT_FILTERS: ServiceFilters = {
  categories: [],
  zips: [],
  minRating: 0,
};

export function Explorer({
  services,
  categories,
  balance,
  areas,
  notifications,
  initialZip,
  mapsApiKey,
  query = "",
}: {
  services: Service[];
  categories: CategoryOption[];
  balance: number;
  areas: ZipArea[];
  notifications: Notification[];
  initialZip: string | null;
  mapsApiKey?: string;
  query?: string;
}) {
  const router = useRouter();

  const [panel, setPanel] = useState<Panel | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Nothing is selected at first, because a selected zip hides every other listing
  // (remote ones included); `initialZip` only centers the map on phones.
  const [selectedZip, setSelectedZip] = useState<string | null>(null);

  const [serviceFilters, setServiceFilters] =
    useState<ServiceFilters>(DEFAULT_FILTERS);

  const toggle = (next: Panel) => {
    setPanel((current) => (current === next ? null : next));
  };

  const selected =
    services.find((service) => service.id === selectedId) ?? null;

  const select = (service: Service) => {
    setSelectedId(service.id);
  };

  const toggleZip = useCallback((zip: string) => {
    setSelectedZip((current) =>
      current === zip ? null : zip,
    );
  }, []);

  /*
   * Filtering pipeline:
   *
   * all services
   *      ↓
   * search query
   *      ↓
   * genre/location/rating filters
   *      ↓
   * map services
   *      ↓
   * selected map ZIP
   *      ↓
   * displayed results
   */

  const searchedServices = searchServices(
    services,
    query,
  );

  const filteredServices = filterServices(
    searchedServices,
    serviceFilters,
  );

  // The map shows everything matching search + filters.
  // Clicking a ZIP further restricts only the results panel.
  const listedServices = selectedZip
    ? filteredServices.filter(
        (service) =>
          service.zip === selectedZip,
      )
    : filteredServices;

  useEffect(() => {
    if (!panel) return;

    const closeOnEscape = (
      event: KeyboardEvent,
    ) => {
      if (event.key === "Escape") {
        setPanel(null);
      }
    };

    window.addEventListener(
      "keydown",
      closeOnEscape,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        closeOnEscape,
      );
    };
  }, [panel]);

  const unreadCount = notifications.filter(
    (notification) => !notification.read,
  ).length;

  const filters = (
    <FiltersPanel
      genres={categories.map(
        (category) => category.name,
      )}
      zips={areas}
      filters={serviceFilters}
      onChange={setServiceFilters}
    />
  );

  return (
    <div className="flex h-dvh flex-col">
      <Header
        openPanel={panel}
        onToggle={toggle}
        unreadCount={unreadCount}
        balance={balance}
        query={query}
        filters={filters}
      />

      <main className="relative flex min-h-0 flex-1 bg-[#e9ecef]">
        {(panel === "notifications" ||
          panel === "filters") && (
          <div
            aria-hidden
            className="fixed inset-0 z-10 hidden lg:block"
            onClick={() => setPanel(null)}
          />
        )}

        {/* MAP */}
        <div className="absolute inset-x-0 top-0 bottom-[45%] lg:relative lg:inset-auto lg:flex-none lg:basis-[60%]">
          <ServiceMap
            apiKey={mapsApiKey}
            areas={areas}
            services={filteredServices}
            initialZip={initialZip}
            selectedZip={selectedZip}
            onToggleZip={toggleZip}
          />
        </div>

        {/* DESKTOP RESULTS */}
        <section
          aria-label="Results"
          className="relative hidden min-w-0 flex-1 overflow-y-auto lg:block"
        >
          <ResultsPanel
            services={listedServices}
            query={query}
            zip={selectedZip}
            onSelect={select}
          />
        </section>

        {/* MOBILE RESULTS */}
        <section
          aria-label="Results"
          className="absolute inset-x-0 bottom-0 flex h-[45%] flex-col rounded-t-3xl bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.12)] lg:hidden"
        >
          <div
            aria-hidden
            className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-barter-line"
          />

          <div className="relative min-h-0 flex-1 overflow-y-auto">
            <ResultsPanel
              services={listedServices}
              query={query}
              zip={selectedZip}
              onSelect={select}
              compact
            />
          </div>
        </section>

        {/* NOTIFICATIONS */}
        {panel === "notifications" && (
          <div
            id="notifications-panel"
            className="absolute inset-0 z-20 overflow-y-auto bg-white lg:inset-auto lg:top-0 lg:right-4 lg:max-h-full lg:w-[618px] lg:shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
          >
            <NotificationsPanel
              notifications={notifications}
            />
          </div>
        )}

        {/* MOBILE MENU */}
        {panel === "menu" && (
          <div
            id="mobile-menu"
            className="absolute inset-0 z-20 overflow-y-auto bg-white lg:hidden"
          >
            <div className="px-4 pt-[13px] pb-3">
              <SearchInput
                query={query}
                outlined
                className="h-14"
                onSubmit={() =>
                  setPanel(null)
                }
              />
            </div>

            {filters}
          </div>
        )}

        {/* CREATE LISTING */}
        {!panel && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            aria-label="List a service"
            className="fixed right-4 bottom-4 z-30 flex size-16 items-center justify-center rounded-[6px] bg-barter-ink text-white shadow-[0_4px_12px_rgba(0,0,0,0.3)] transition-transform hover:scale-105 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-barter-blue lg:right-6 lg:bottom-[34px] lg:size-[102px]"
          >
            <Plus
              className="size-10 lg:size-[62px]"
              strokeWidth={2.75}
            />
          </button>
        )}
      </main>

      <ListingModal
        service={selected}
        onClose={() =>
          setSelectedId(null)
        }
      />

      <CreateListingModal
        open={creating}
        categories={categories}
        onClose={() =>
          setCreating(false)
        }
        onPublished={() => {
          setCreating(false);
          router.refresh();
        }}
      />
    </div>
  );
}

function searchServices(
  services: Service[],
  query: string,
): Service[] {
  const needle =
    query.trim().toLowerCase();

  if (!needle) {
    return services;
  }

  return services.filter((service) => {
    const searchable = [
      service.title,
      service.category,
      service.description ?? "",
      service.location ?? "",
      service.zip ?? "",
      ...(service.tags ?? []),
    ];

    return searchable.some((value) =>
      value
        .toLowerCase()
        .includes(needle),
    );
  });
}

function filterServices(
  services: Service[],
  filters: ServiceFilters,
): Service[] {
  return services.filter((service) => {
    const matchesCategory =
      filters.categories.length === 0 ||
      filters.categories.includes(
        service.category,
      );

    // Remote listings have no zip, so they only match when no location is chosen.
    const matchesZip =
      filters.zips.length === 0 ||
      (service.zip !== null &&
        filters.zips.includes(service.zip));

    const matchesRating =
      (service.rating ?? 0) >=
      filters.minRating;

    return (
      matchesCategory &&
      matchesZip &&
      matchesRating
    );
  });
}