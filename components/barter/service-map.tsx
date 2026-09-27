"use client";

import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  APILoadingStatus,
  APIProvider,
  Map as GoogleMap,
  useApiLoadingStatus,
  useMap,
} from "@vis.gl/react-google-maps";

import type { Service, ZipArea } from "@/lib/barter/data";
import { ServiceArt } from "./results";
import boundaries from "@/lib/barter/zip-boundaries.json";
import { cn } from "@/lib/utils";

const HIGHLIGHT = "#2ca3ff";
const MAX_CARDS = 3;

// On-screen size of a card stack, used to decide when stacks would overlap.
const STACK = {
  desktop: { width: 130, height: 128 },
  phone: { width: 100, height: 100 },
};

const NYC_MAP_BOUNDS = {
  north: 40.93,
  south: 40.49,
  east: -73.68,
  west: -74.27,
};

const MIN_ZOOM = 10;
const MAX_ZOOM = 18;

/**
 * Because this map does NOT use a Map ID, normal Google Maps JSON styles
 * work again.
 *
 * Hide all POIs / landmarks while leaving roads, neighborhood labels,
 * geographic labels, etc. visible.
 */
const MAP_STYLES: google.maps.MapTypeStyle[] = [
  {
    featureType: "poi",
    elementType: "all",
    stylers: [{ visibility: "off" }],
  },
];

type Group = {
  key: string;
  zips: ZipArea[];
  position: google.maps.LatLngLiteral;
};

export default function ServiceMap({
  apiKey,
  areas,
  services,
  initialZip,
  selectedZip,
  onToggleZip,
}: {
  apiKey: string | undefined;
  areas: ZipArea[];
  services: Service[];
  initialZip: string | null;
  selectedZip: string | null;

  /**
   * Should keep the same identity across renders;
   * it's a map listener dependency.
   */
  onToggleZip: (zip: string) => void;
}) {
  if (!apiKey) {
    return (
      <MapNotice>
        Add GOOGLE_MAPS_API_KEY to .env.local to show the map.
      </MapNotice>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <ZipMap
        areas={areas}
        services={services}
        initialZip={initialZip}
        selectedZip={selectedZip}
        onToggleZip={onToggleZip}
      />
    </APIProvider>
  );
}

function ZipMap({
  areas,
  services,
  initialZip,
  selectedZip,
  onToggleZip,
}: {
  areas: ZipArea[];
  services: Service[];
  initialZip: string | null;
  selectedZip: string | null;
  onToggleZip: (zip: string) => void;
}) {
  const status = useApiLoadingStatus();

  const [phone] = useState(
    () => !window.matchMedia("(min-width: 1024px)").matches,
  );

  if (
    status === APILoadingStatus.FAILED ||
    status === APILoadingStatus.AUTH_FAILURE
  ) {
    return (
      <MapNotice>
        Google Maps didn&apos;t load. Check that GOOGLE_MAPS_API_KEY is valid
        and has the Maps JavaScript API enabled.
      </MapNotice>
    );
  }

  return (
    <GoogleMap
      defaultBounds={initialBounds(areas, initialZip, phone)}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      restriction={{
        latLngBounds: NYC_MAP_BOUNDS,
        strictBounds: true,
      }}
      // Without this, fitting bounds rounds down to a whole zoom level and
      // shows far more area than asked for.
      isFractionalZoomEnabled
      disableDefaultUI
      clickableIcons={false}
      gestureHandling="greedy"
      styles={MAP_STYLES}
    >
      <ZipLayer
        areas={areas}
        services={services}
        selectedZip={selectedZip}
        onToggleZip={onToggleZip}
        phone={phone}
      />
    </GoogleMap>
  );
}

function ZipLayer({
  areas,
  services,
  selectedZip,
  onToggleZip,
  phone,
}: {
  areas: ZipArea[];
  services: Service[];
  selectedZip: string | null;
  onToggleZip: (zip: string) => void;
  phone: boolean;
}) {
  const map = useMap();
  const zoom = useMapZoom(map);

  const [hoveredZips, setHoveredZips] = useState<string[]>([]);

  const populatedAreas = useMemo(() => {
    const populatedZips = new Set(services.map((service) => service.zip));
    return areas.filter((area) => populatedZips.has(area.zip));
  }, [areas, services]);

  useZipOutlines(map, {
    selectedZip,
    hoveredZips,
    onHover: setHoveredZips,
    onToggle: onToggleZip,
  });

  // Stacks that would overlap on screen at this zoom merge into one.
  const groups = useMemo(
    () =>
      zoom === undefined
        ? []
        : groupNearbyZips(
            populatedAreas,
            zoom,
            phone ? STACK.phone : STACK.desktop,
          ),
    [populatedAreas, zoom, phone],
  );

  return (
    <>
      {groups.map((group) => {
        const zips = group.zips.map((area) => area.zip);
        const merged = zips.length > 1;

        const selected =
          selectedZip !== null && zips.includes(selectedZip);

        const hovered = hoveredZips.some((zip) => zips.includes(zip));

        return (
          <OverlayMarker
            key={group.key}
            position={group.position}
            title={
              merged
                ? `${zips.length} areas: ${zips.join(", ")}`
                : `ZIP ${zips[0]}`
            }
            zIndex={selected ? 3 : hovered ? 2 : 1}
            onMouseEnter={() => setHoveredZips(zips)}
            onMouseLeave={() => setHoveredZips([])}
            onClick={() => {
              if (merged) {
                zoomToZips(map, group.zips, phone);
              } else {
                onToggleZip(zips[0]);
              }
            }}
          >
            <CardStack
              cards={cardsFor(group, services)}
              label={merged ? `${zips.length} areas` : zips[0]}
              selected={selected}
            />
          </OverlayMarker>
        );
      })}
    </>
  );
}

/**
 * Custom marker implementation that does not require a Google Maps Map ID.
 *
 * AdvancedMarker requires a Map ID, so this uses the traditional
 * google.maps.OverlayView API instead.
 */
function OverlayMarker({
  position,
  title,
  zIndex = 1,
  onClick,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  position: google.maps.LatLngLiteral;
  title?: string;
  zIndex?: number;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: ReactNode;
}) {
  const map = useMap();

  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  /**
   * Create a DOM container for React to portal the marker into.
   */
  useEffect(() => {
    const element = document.createElement("div");

    element.style.position = "absolute";
    element.style.transform = "translate(-50%, -100%)";
    element.style.pointerEvents = "auto";
    element.style.userSelect = "none";

    setContainer(element);

    return () => {
      element.remove();
      setContainer(null);
    };
  }, []);

  /**
   * Attach the custom overlay to Google Maps.
   */
  useEffect(() => {
    if (!map || !container) return;
    // The null check above doesn't carry into the class methods below.
    const element = container;

    class ReactOverlay extends google.maps.OverlayView {
      onAdd() {
        const panes = this.getPanes();

        if (!panes) return;

        /**
         * overlayMouseTarget is used instead of overlayLayer so the
         * React marker receives mouse events.
         */
        panes.overlayMouseTarget.appendChild(element);
      }

      draw() {
        const projection = this.getProjection();

        if (!projection) return;

        const point = projection.fromLatLngToDivPixel(
          new google.maps.LatLng(position.lat, position.lng),
        );

        if (!point) return;

        element.style.left = `${point.x}px`;
        element.style.top = `${point.y}px`;
      }

      onRemove() {
        element.remove();
      }
    }

    const overlay = new ReactOverlay();

    overlay.setMap(map);

    return () => {
      overlay.setMap(null);
    };
  }, [map, container, position.lat, position.lng]);

  /**
   * Keep marker stacking synced with hover/selection.
   */
  useEffect(() => {
    if (!container) return;

    container.style.zIndex = String(zIndex);
  }, [container, zIndex]);

  if (!container) return null;

  return createPortal(
    <div
      title={title}
      role="button"
      tabIndex={0}
      className="cursor-pointer"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onClick?.();
        }
      }}
    >
      {children}
    </div>,
    container,
  );
}

function useMapZoom(map: google.maps.Map | null) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!map) return () => {};

      const listener = map.addListener("zoom_changed", onChange);

      // Google Maps can return no listener while its map is being torn down
      // during route transitions. `remove()` is otherwise the normal cleanup.
      return () => listener?.remove();
    },
    [map],
  );

  return useSyncExternalStore(
    subscribe,
    () => map?.getZoom(),
    () => undefined,
  );
}

/**
 * ZIP outlines stay nearly transparent until hovered or selected,
 * so the whole area can be hovered and clicked, not just the card.
 */
function useZipOutlines(
  map: google.maps.Map | null,
  {
    selectedZip,
    hoveredZips,
    onHover,
    onToggle,
  }: {
    selectedZip: string | null;
    hoveredZips: string[];
    onHover: (zips: string[]) => void;
    onToggle: (zip: string) => void;
  },
) {
  useEffect(() => {
    if (!map) return;

    const features = map.data.addGeoJson(boundaries);

    const zipOf = (event: google.maps.Data.MouseEvent) =>
      String(event.feature.getProperty("zip"));

    const listeners = [
      map.data.addListener(
        "mouseover",
        (event: google.maps.Data.MouseEvent) => {
          onHover([zipOf(event)]);
        },
      ),

      map.data.addListener("mouseout", () => {
        onHover([]);
      }),

      map.data.addListener(
        "click",
        (event: google.maps.Data.MouseEvent) => {
          onToggle(zipOf(event));
        },
      ),
    ];

    return () => {
      listeners.forEach((listener) => listener?.remove());

      features?.forEach((feature) => {
        map.data.remove(feature);
      });
    };
  }, [map, onHover, onToggle]);

  useEffect(() => {
    if (!map) return;

    map.data.setStyle((feature) => {
      const zip = String(feature.getProperty("zip"));

      const active =
        zip === selectedZip || hoveredZips.includes(zip);

      return {
        fillColor: HIGHLIGHT,
        fillOpacity: active ? 0.3 : 0.001,

        strokeColor: HIGHLIGHT,
        strokeOpacity: active ? 1 : 0,
        strokeWeight: 2,

        cursor: "pointer",
      };
    });
  }, [map, selectedZip, hoveredZips]);
}

function groupNearbyZips(
  areas: ZipArea[],
  zoom: number,
  stack: {
    width: number;
    height: number;
  },
): Group[] {
  const groups: {
    zips: ZipArea[];
    x: number;
    y: number;
  }[] = [];

  for (const area of areas) {
    const { x, y } = toScreenPixels(area, zoom);

    const near = groups.find(
      (group) =>
        Math.abs(group.x - x) < stack.width &&
        Math.abs(group.y - y) < stack.height,
    );

    if (near) {
      near.zips.push(area);
    } else {
      groups.push({
        zips: [area],
        x,
        y,
      });
    }
  }

  return groups.map(({ zips }) => ({
    key: zips.map((area) => area.zip).join("-"),

    zips,

    position: {
      lat: average(zips.map((area) => area.lat)),
      lng: average(zips.map((area) => area.lng)),
    },
  }));
}

/**
 * Web Mercator:
 * a point's pixel position on the whole world map at `zoom`.
 */
function toScreenPixels(
  {
    lat,
    lng,
  }: ZipArea,
  zoom: number,
) {
  const size = 256 * 2 ** zoom;

  const sin = Math.sin((lat * Math.PI) / 180);

  return {
    x: ((lng + 180) / 360) * size,

    y:
      (0.5 -
        Math.log((1 + sin) / (1 - sin)) /
          (4 * Math.PI)) *
      size,
  };
}

function average(values: number[]) {
  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

type MapCard = { image: string | undefined; category: string };

/** A merged stack shows one card per ZIP, preferring uploaded photos. */
function cardsFor(group: Group, services: Service[]): MapCard[] {
  const cardsForZip = (zip: string) => services
    .filter((service) => service.zip === zip)
    .map((service) => ({
      image: service.images.find((image) => image.trim().length > 0),
      category: service.category,
    }))
    .sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)));

  const cards = group.zips.length > 1
    ? group.zips.flatMap((area) => cardsForZip(area.zip).slice(0, 1))
    : cardsForZip(group.zips[0].zip);

  return cards
    .sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)))
    .slice(0, MAX_CARDS);
}

function zoomToZips(
  map: google.maps.Map | null,
  zips: ZipArea[],
  phone: boolean,
) {
  if (!map) return;

  const bounds = new google.maps.LatLngBounds();

  zips.forEach((area) => {
    bounds.extend({
      lat: area.lat,
      lng: area.lng,
    });
  });

  map.fitBounds(
    bounds,
    phone
      ? {
          top: 120,
          right: 50,
          bottom: 30,
          left: 50,
        }
      : {
          top: 170,
          right: 90,
          bottom: 60,
          left: 90,
        },
  );
}

/**
 * Desktop fits every ZIP.
 * Phones zoom in around the selected one.
 */
function initialBounds(
  areas: ZipArea[],
  selectedZip: string | null,
  phone: boolean,
) {
  const focus =
    areas.find(
      (area) => area.zip === selectedZip,
    ) ?? areas[0];

  const shown =
    phone && focus
      ? [focus]
      : areas;

  if (!shown.length) {
    return {
      north: 40.83,
      south: 40.78,
      east: -73.94,
      west: -73.98,
    };
  }

  const margin = phone ? 0.012 : 0;

  const lats = shown.map((area) => area.lat);
  const lngs = shown.map((area) => area.lng);

  return {
    north: Math.max(...lats) + margin,
    south: Math.min(...lats) - margin,
    east: Math.max(...lngs) + margin,
    west: Math.min(...lngs) - margin,

    // Cards hang above their point, so leave room at the top.
    padding: phone
      ? {
          top: 120,
          right: 30,
          bottom: 20,
          left: 30,
        }
      : {
          top: 160,
          right: 80,
          bottom: 50,
          left: 80,
        },
  };
}

/**
 * Up to three cards fanned out.
 * The front one carries the ZIP label.
 */
function CardStack({
  cards,
  label,
  selected,
}: {
  cards: MapCard[];
  label: string;
  selected: boolean;
}) {
  const [front, ...back] = cards;
  if (!front) return null;

  return (
    <div className="relative">
      {back.map((card, index) => (
        <Card
          key={index}
          image={card.image}
          category={card.category}
          className={cn(
            "absolute inset-0",
            index === 0
              ? "-rotate-12"
              : "rotate-12",
          )}
        />
      ))}

      <Card
        image={front.image}
        category={front.category}
        label={label}
        selected={selected}
        className="relative"
      />
    </div>
  );
}

function Card({
  image,
  category,
  label,
  selected = false,
  className,
}: {
  image: string | undefined;
  category: string;
  label?: string;
  selected?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-[80px] origin-bottom rounded-[16px] bg-white p-[5px] shadow-[0_2px_8px_rgba(0,0,0,0.25)] lg:w-[104px] lg:rounded-[20px] lg:p-1.5",
        selected && "ring-[3px] ring-barter-blue",
        className,
      )}
    >
      {image ? (
        <img
          src={image}
          alt=""
          className="aspect-square w-full rounded-[12px] object-cover lg:rounded-[15px]"
        />
      ) : (
        <ServiceArt
          category={category}
          className="aspect-square w-full rounded-[12px] lg:rounded-[15px]"
          iconClassName="size-8 lg:size-10"
        />
      )}

      <p className="flex h-5 items-center justify-center text-xs text-black lg:h-6 lg:text-[13px]">
        {label}
      </p>
    </div>
  );
}

function MapNotice({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex size-full items-center justify-center bg-[#e9ecef] p-6 text-center text-sm text-barter-gray">
      <p className="max-w-xs">
        {children}
      </p>
    </div>
  );
}
