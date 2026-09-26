"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import {
  AdvancedMarker,
  APILoadingStatus,
  APIProvider,
  Map as GoogleMap,
  useApiLoadingStatus,
} from "@vis.gl/react-google-maps";
import type { Service, ZipArea } from "@/lib/xchg/data";
import { cn } from "@/lib/utils";
import { ServiceArt } from "./results";

// Advanced Markers (custom HTML markers) need a Map ID. Google's demo ID is
// fine for development; create a real one in Google Cloud for production.
const MAP_ID = "DEMO_MAP_ID";

export default function ServiceMap({
  apiKey,
  areas,
  services,
  selectedZip,
}: {
  apiKey: string | undefined;
  areas: ZipArea[];
  services: Service[];
  selectedZip: string | null;
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
      <ZipMap areas={areas} services={services} selectedZip={selectedZip} />
    </APIProvider>
  );
}

function ZipMap({
  areas,
  services,
  selectedZip,
}: {
  areas: ZipArea[];
  services: Service[];
  selectedZip: string | null;
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
        Google Maps didn’t load. Check that GOOGLE_MAPS_API_KEY is valid and
        has the Maps JavaScript API enabled.
      </MapNotice>
    );
  }
  return (
    <GoogleMap
      mapId={MAP_ID}
      defaultBounds={initialBounds(areas, selectedZip, phone)}
      // Without this, fitting the bounds rounds down to a whole zoom level
      // and shows far more area than asked for.
      isFractionalZoomEnabled
      disableDefaultUI
      clickableIcons={false}
      gestureHandling="greedy"
      style={{ width: "100%", height: "100%" }}
    >
      {areas.map((area) => (
        <AdvancedMarker
          key={area.zip}
          position={{ lat: area.lat, lng: area.lng }}
        >
          <ZipMarker
            zip={area.zip}
            services={services.filter((service) => service.zip === area.zip)}
            selected={area.zip === selectedZip}
          />
        </AdvancedMarker>
      ))}
    </GoogleMap>
  );
}

// Desktop fits every zip; phones zoom in around the selected one.
function initialBounds(
  areas: ZipArea[],
  selectedZip: string | null,
  phone: boolean,
) {
  const focus = areas.find((area) => area.zip === selectedZip) ?? areas[0];
  const shown = phone && focus ? [focus] : areas;
  if (!shown.length) {
    return { north: 40.83, south: 40.78, east: -73.94, west: -73.98 };
  }
  const margin = phone ? 0.012 : 0;
  const lats = shown.map((area) => area.lat);
  const lngs = shown.map((area) => area.lng);
  return {
    north: Math.max(...lats) + margin,
    south: Math.min(...lats) - margin,
    east: Math.max(...lngs) + margin,
    west: Math.min(...lngs) - margin,
    // Markers hang above their point, so leave room at the top.
    padding: phone
      ? { top: 90, right: 16, bottom: 16, left: 16 }
      : { top: 150, right: 70, bottom: 50, left: 70 },
  };
}

function MapNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex size-full items-center justify-center bg-[#e9ecef] p-6 text-center text-sm text-xchg-gray">
      <p className="max-w-xs">{children}</p>
    </div>
  );
}

function ZipMarker({
  zip,
  services,
  selected,
}: {
  zip: string;
  services: Service[];
  selected: boolean;
}) {
  const cover = services[0];
  return (
    <div
      role="img"
      aria-label={`${zip}: ${services.length} services`}
      className="flex flex-col items-center"
    >
      <div
        className={cn(
          "size-[71px] overflow-hidden rounded-[18px] border-[5px] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.25)] lg:size-[98px] lg:rounded-[22px] lg:border-[6px]",
          selected ? "border-xchg-blue" : "border-white",
        )}
      >
        {cover && (
          <ServiceArt
            category={cover.category}
            className="size-full"
            iconClassName="size-7 lg:size-10"
          />
        )}
      </div>
      <span className="mt-1 text-sm text-black [text-shadow:0_0_3px_#fff,0_0_3px_#fff] lg:text-[15px]">
        {zip}
      </span>
    </div>
  );
}
