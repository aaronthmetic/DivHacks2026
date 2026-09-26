"use client";

import type {
  ReactNode,
} from "react";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  AdvancedMarker,
  APILoadingStatus,
  APIProvider,
  Map as GoogleMap,
  useApiLoadingStatus,
  useMap,
} from "@vis.gl/react-google-maps";

import type {
  Service,
  ZipArea,
} from "@/lib/xchg/data";

import boundaries from "@/lib/xchg/zip-boundaries.json";

import {
  cn,
} from "@/lib/utils";

const DEMO_MAP_ID =
  "DEMO_MAP_ID";

const HIGHLIGHT =
  "#2ca3ff";

const MAX_CARDS =
  3;

const STACK = {
  desktop: {
    width: 130,
    height: 128,
  },

  phone: {
    width: 100,
    height: 100,
  },
};

type Group = {
  key: string;

  zips: ZipArea[];

  position:
    google.maps.LatLngLiteral;
};

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function normalizeZip(
  value: unknown,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  const zip =
    String(
      value,
    ).trim();

  if (
    /^\d+$/.test(
      zip,
    )
  ) {
    return zip.padStart(
      5,
      "0",
    );
  }

  return zip;
}

function getServiceImageUrl(
  service: Service,
): string | null {
  const imageId =
    service.images?.[0];

  if (!imageId) {
    return null;
  }

  return `/api/images/${imageId}`;
}

/*
|--------------------------------------------------------------------------
| Main component
|--------------------------------------------------------------------------
*/

export default function ServiceMap({
  apiKey,
  mapId,
  areas,
  services,
  initialZip,
}: {
  apiKey:
    | string
    | undefined;

  mapId:
    | string
    | undefined;

  areas:
    ZipArea[];

  services:
    Service[];

  initialZip:
    string | null;
}) {
  if (!apiKey) {
    return (
      <MapNotice>
        Add GOOGLE_MAPS_API_KEY
        to .env.local to show
        the map.
      </MapNotice>
    );
  }

  return (
    <APIProvider
      apiKey={
        apiKey
      }
    >
      <ZipMap
        mapId={
          mapId ||
          DEMO_MAP_ID
        }
        areas={
          areas
        }
        services={
          services
        }
        initialZip={
          initialZip
        }
      />
    </APIProvider>
  );
}

/*
|--------------------------------------------------------------------------
| Google Map
|--------------------------------------------------------------------------
*/

function ZipMap({
  mapId,
  areas,
  services,
  initialZip,
}: {
  mapId:
    string;

  areas:
    ZipArea[];

  services:
    Service[];

  initialZip:
    string | null;
}) {
  const status =
    useApiLoadingStatus();

  /*
   * Do not access window during the initial render.
   *
   * This keeps the component safe even if it is ever
   * rendered outside dynamic(..., { ssr: false }).
   */
  const [
    phone,
    setPhone,
  ] =
    useState(
      false,
    );

  useEffect(() => {
    const media =
      window.matchMedia(
        "(min-width: 1024px)",
      );

    const update =
      () => {
        setPhone(
          !media.matches,
        );
      };

    update();

    media.addEventListener(
      "change",
      update,
    );

    return () => {
      media.removeEventListener(
        "change",
        update,
      );
    };
  }, []);

  if (
    status ===
      APILoadingStatus.FAILED ||
    status ===
      APILoadingStatus.AUTH_FAILURE
  ) {
    return (
      <MapNotice>
        Google Maps
        didn&apos;t load.
        Check your API key
        and Maps JavaScript
        API configuration.
      </MapNotice>
    );
  }

  return (
    <GoogleMap
      mapId={
        mapId
      }
      defaultBounds={initialBounds(
        areas,
        initialZip,
        phone,
      )}
      isFractionalZoomEnabled
      disableDefaultUI
      clickableIcons={
        false
      }
      gestureHandling="greedy"
      style={{
        width:
          "100%",

        height:
          "100%",
      }}
    >
      <ZipLayer
        areas={
          areas
        }
        services={
          services
        }
        initialZip={
          initialZip
        }
        phone={
          phone
        }
      />
    </GoogleMap>
  );
}

/*
|--------------------------------------------------------------------------
| ZIP marker layer
|--------------------------------------------------------------------------
*/

function ZipLayer({
  areas,
  services,
  initialZip,
  phone,
}: {
  areas:
    ZipArea[];

  services:
    Service[];

  initialZip:
    string | null;

  phone:
    boolean;
}) {
  const map =
    useMap();

  const zoom =
    useMapZoom(
      map,
    );

  const [
    selectedZip,
    setSelectedZip,
  ] =
    useState<
      string | null
    >(
      initialZip,
    );

  const [
    hoveredZips,
    setHoveredZips,
  ] =
    useState<
      string[]
    >([]);

  const toggleZip =
    useCallback(
      (
        zip: string,
      ) => {
        const normalized =
          normalizeZip(
            zip,
          );

        setSelectedZip(
          (
            current,
          ) =>
            current ===
            normalized
              ? null
              : normalized,
        );
      },
      [],
    );

  useZipOutlines(
    map,
    {
      selectedZip,

      hoveredZips,

      onHover:
        setHoveredZips,

      onToggle:
        toggleZip,
    },
  );

  /*
   * `areas` now comes directly from MongoDB service ZIPs.
   */
  const groups =
    useMemo(
      () => {
        if (
          zoom ===
          undefined
        ) {
          return [];
        }

        return groupNearbyZips(
          areas,

          zoom,

          phone
            ? STACK.phone
            : STACK.desktop,
        );
      },
      [
        areas,
        zoom,
        phone,
      ],
    );

  /*
   * Browser-side debugging.
   *
   * Check DevTools -> Console.
   */
  useEffect(() => {
    console.log(
      "[ServiceMap] services:",
      services,
    );

    console.log(
      "[ServiceMap] areas:",
      areas,
    );

    console.log(
      "[ServiceMap] zoom:",
      zoom,
    );

    console.log(
      "[ServiceMap] groups:",
      groups,
    );

    console.log(
      "[ServiceMap] service zips:",
      services.map(
        (
          service,
        ) =>
          service.zip,
      ),
    );
  }, [
    services,
    areas,
    zoom,
    groups,
  ]);

  return (
    <>
      {groups.map(
        (
          group,
        ) => {
          const zips =
            group.zips.map(
              (
                area,
              ) =>
                normalizeZip(
                  area.zip,
                ),
            );

          const cards =
            cardsFor(
              group,
              services,
            );

          const merged =
            zips.length >
            1;

          const selected =
            selectedZip !==
              null &&
            zips.includes(
              normalizeZip(
                selectedZip,
              ),
            );

          const hovered =
            hoveredZips.some(
              (
                zip,
              ) =>
                zips.includes(
                  normalizeZip(
                    zip,
                  ),
                ),
            );

          /*
           * IMPORTANT:
           *
           * Do NOT return null if cards.length === 0.
           *
           * A marker still renders so a bad service match
           * cannot silently hide the entire marker.
           */
          return (
            <AdvancedMarker
              key={
                group.key
              }
              position={
                group.position
              }
              title={
                merged
                  ? `${zips.length} areas: ${zips.join(", ")}`
                  : cards[0]
                      ?.title ??
                    `ZIP ${zips[0]}`
              }
              zIndex={
                selected
                  ? 3
                  : hovered
                    ? 2
                    : 1
              }
              onMouseEnter={() =>
                setHoveredZips(
                  zips,
                )
              }
              onMouseLeave={() =>
                setHoveredZips(
                  [],
                )
              }
              onClick={() => {
                if (
                  merged
                ) {
                  zoomToZips(
                    map,
                    group.zips,
                    phone,
                  );
                } else {
                  toggleZip(
                    zips[0],
                  );
                }
              }}
            >
              <CardStack
                cards={
                  cards
                }
                label={
                  merged
                    ? `${zips.length} areas`
                    : zips[0]
                }
                selected={
                  selected
                }
              />
            </AdvancedMarker>
          );
        },
      )}
    </>
  );
}

/*
|--------------------------------------------------------------------------
| Map zoom hook
|--------------------------------------------------------------------------
*/

function useMapZoom(
  map:
    | google.maps.Map
    | null,
) {
  const subscribe =
    useCallback(
      (
        onChange:
          () => void,
      ) => {
        if (!map) {
          return () => {};
        }

        const listener =
          map.addListener(
            "zoom_changed",
            onChange,
          );

        return () => {
          listener.remove();
        };
      },
      [
        map,
      ],
    );

  return useSyncExternalStore(
    subscribe,

    () =>
      map?.getZoom(),

    () =>
      undefined,
  );
}

/*
|--------------------------------------------------------------------------
| ZIP polygon layer
|--------------------------------------------------------------------------
*/

function useZipOutlines(
  map:
    | google.maps.Map
    | null,

  {
    selectedZip,
    hoveredZips,
    onHover,
    onToggle,
  }: {
    selectedZip:
      string | null;

    hoveredZips:
      string[];

    onHover:
      (
        zips:
          string[],
      ) => void;

    onToggle:
      (
        zip:
          string,
      ) => void;
  },
) {
  useEffect(() => {
    if (!map) {
      return;
    }

    const features =
      map.data.addGeoJson(
        boundaries,
      );

    const zipOf = (
      event:
        google.maps.Data.MouseEvent,
    ) =>
      normalizeZip(
        event.feature.getProperty(
          "zip",
        ),
      );

    const listeners = [
      map.data.addListener(
        "mouseover",

        (
          event:
            google.maps.Data.MouseEvent,
        ) => {
          onHover([
            zipOf(
              event,
            ),
          ]);
        },
      ),

      map.data.addListener(
        "mouseout",

        () => {
          onHover(
            [],
          );
        },
      ),

      map.data.addListener(
        "click",

        (
          event:
            google.maps.Data.MouseEvent,
        ) => {
          onToggle(
            zipOf(
              event,
            ),
          );
        },
      ),
    ];

    return () => {
      listeners.forEach(
        (
          listener,
        ) => {
          listener.remove();
        },
      );

      features.forEach(
        (
          feature,
        ) => {
          map.data.remove(
            feature,
          );
        },
      );
    };
  }, [
    map,
    onHover,
    onToggle,
  ]);

  useEffect(() => {
    if (!map) {
      return;
    }

    map.data.setStyle(
      (
        feature,
      ) => {
        const zip =
          normalizeZip(
            feature.getProperty(
              "zip",
            ),
          );

        const active =
          zip ===
            normalizeZip(
              selectedZip,
            ) ||
          hoveredZips.some(
            (
              hoveredZip,
            ) =>
              normalizeZip(
                hoveredZip,
              ) ===
              zip,
          );

        return {
          fillColor:
            HIGHLIGHT,

          fillOpacity:
            active
              ? 0.3
              : 0.001,

          strokeColor:
            HIGHLIGHT,

          strokeOpacity:
            active
              ? 1
              : 0,

          strokeWeight:
            2,

          cursor:
            "pointer",
        };
      },
    );
  }, [
    map,
    selectedZip,
    hoveredZips,
  ]);
}

/*
|--------------------------------------------------------------------------
| Marker grouping
|--------------------------------------------------------------------------
*/

function groupNearbyZips(
  areas:
    ZipArea[],

  zoom:
    number,

  stack: {
    width:
      number;

    height:
      number;
  },
): Group[] {
  const groups: {
    zips:
      ZipArea[];

    x:
      number;

    y:
      number;
  }[] = [];

  for (
    const area of
    areas
  ) {
    /*
     * Ignore invalid coordinates rather than allowing
     * one bad service to break every marker.
     */
    if (
      !Number.isFinite(
        area.lat,
      ) ||
      !Number.isFinite(
        area.lng,
      )
    ) {
      console.warn(
        "[ServiceMap] Invalid area coordinates:",
        area,
      );

      continue;
    }

    const {
      x,
      y,
    } =
      toScreenPixels(
        area,
        zoom,
      );

    const near =
      groups.find(
        (
          group,
        ) =>
          Math.abs(
            group.x -
              x,
          ) <
            stack.width &&
          Math.abs(
            group.y -
              y,
          ) <
            stack.height,
      );

    if (near) {
      near.zips.push(
        area,
      );
    } else {
      groups.push({
        zips: [
          area,
        ],

        x,

        y,
      });
    }
  }

  return groups.map(
    ({
      zips,
    }) => ({
      key:
        zips
          .map(
            (
              area,
            ) =>
              normalizeZip(
                area.zip,
              ),
          )
          .join(
            "-",
          ),

      zips,

      position: {
        lat:
          average(
            zips.map(
              (
                area,
              ) =>
                area.lat,
            ),
          ),

        lng:
          average(
            zips.map(
              (
                area,
              ) =>
                area.lng,
            ),
          ),
      },
    }),
  );
}

function toScreenPixels(
  {
    lat,
    lng,
  }: ZipArea,

  zoom:
    number,
) {
  const size =
    256 *
    2 ** zoom;

  const sin =
    Math.sin(
      (lat *
        Math.PI) /
        180,
    );

  return {
    x:
      ((lng +
        180) /
        360) *
      size,

    y:
      (0.5 -
        Math.log(
          (1 +
            sin) /
            (1 -
              sin),
        ) /
          (4 *
            Math.PI)) *
      size,
  };
}

function average(
  values:
    number[],
) {
  if (
    values.length ===
    0
  ) {
    return 0;
  }

  return (
    values.reduce(
      (
        sum,
        value,
      ) =>
        sum +
        value,
      0,
    ) /
    values.length
  );
}

/*
|--------------------------------------------------------------------------
| Match services to markers
|--------------------------------------------------------------------------
*/

function cardsFor(
  group:
    Group,

  services:
    Service[],
): Service[] {
  const groupZips =
    new Set(
      group.zips.map(
        (
          area,
        ) =>
          normalizeZip(
            area.zip,
          ),
      ),
    );

  /*
   * Compare normalized ZIP strings on both sides.
   */
  return services
    .filter(
      (
        service,
      ) =>
        groupZips.has(
          normalizeZip(
            service.zip,
          ),
        ),
    )
    .slice(
      0,
      MAX_CARDS,
    );
}

/*
|--------------------------------------------------------------------------
| Zoom into merged markers
|--------------------------------------------------------------------------
*/

function zoomToZips(
  map:
    | google.maps.Map
    | null,

  zips:
    ZipArea[],

  phone:
    boolean,
) {
  if (!map) {
    return;
  }

  const bounds =
    new google.maps.LatLngBounds();

  zips.forEach(
    (
      area,
    ) => {
      bounds.extend({
        lat:
          area.lat,

        lng:
          area.lng,
      });
    },
  );

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

/*
|--------------------------------------------------------------------------
| Initial map bounds
|--------------------------------------------------------------------------
*/

function initialBounds(
  areas:
    ZipArea[],

  selectedZip:
    string | null,

  phone:
    boolean,
) {
  const focus =
    areas.find(
      (
        area,
      ) =>
        normalizeZip(
          area.zip,
        ) ===
        normalizeZip(
          selectedZip,
        ),
    ) ??
    areas[0];

  const shown =
    phone &&
    focus
      ? [
          focus,
        ]
      : areas;

  if (
    shown.length ===
    0
  ) {
    return {
      north:
        40.83,

      south:
        40.68,

      east:
        -73.85,

      west:
        -74.05,
    };
  }

  const margin =
    phone
      ? 0.012
      : 0.005;

  const lats =
    shown.map(
      (
        area,
      ) =>
        area.lat,
    );

  const lngs =
    shown.map(
      (
        area,
      ) =>
        area.lng,
    );

  return {
    north:
      Math.max(
        ...lats,
      ) +
      margin,

    south:
      Math.min(
        ...lats,
      ) -
      margin,

    east:
      Math.max(
        ...lngs,
      ) +
      margin,

    west:
      Math.min(
        ...lngs,
      ) -
      margin,

    padding:
      phone
        ? {
            top:
              120,

            right:
              30,

            bottom:
              20,

            left:
              30,
          }
        : {
            top:
              160,

            right:
              80,

            bottom:
              50,

            left:
              80,
          },
  };
}

/*
|--------------------------------------------------------------------------
| Marker cards
|--------------------------------------------------------------------------
*/

function CardStack({
  cards,
  label,
  selected,
}: {
  cards:
    Service[];

  label:
    string;

  selected:
    boolean;
}) {
  /*
   * If service matching somehow fails, still show
   * a visible ZIP marker instead of rendering nothing.
   */
  if (
    cards.length ===
    0
  ) {
    return (
      <EmptyCard
        label={
          label
        }
        selected={
          selected
        }
      />
    );
  }

  const [
    front,
    ...back
  ] =
    cards;

  return (
    <div className="relative">
      {back.map(
        (
          service,
          index,
        ) => (
          <Card
            key={
              service.id
            }
            service={
              service
            }
            className={cn(
              "absolute inset-0",

              index ===
                0
                ? "-rotate-12"
                : "rotate-12",
            )}
          />
        ),
      )}

      <Card
        service={
          front
        }
        label={
          label
        }
        selected={
          selected
        }
        className="relative"
      />
    </div>
  );
}

function Card({
  service,
  label,
  selected = false,
  className,
}: {
  service:
    Service;

  label?:
    string;

  selected?:
    boolean;

  className?:
    string;
}) {
  const imageUrl =
    getServiceImageUrl(
      service,
    );

  return (
    <div
      className={cn(
        "w-[80px] origin-bottom rounded-[16px] bg-white p-[5px] shadow-[0_2px_8px_rgba(0,0,0,0.25)]",

        "lg:w-[104px] lg:rounded-[20px] lg:p-1.5",

        selected &&
          "ring-[3px] ring-xchg-blue",

        className,
      )}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={
            imageUrl
          }
          alt={
            service.title
          }
          className="aspect-square w-full rounded-[12px] object-cover lg:rounded-[15px]"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-[12px] bg-[#e9ecef] px-2 text-center text-[10px] text-black lg:rounded-[15px]">
          {service.title}
        </div>
      )}

      <p
        title={
          service.title
        }
        className="flex h-5 items-center justify-center truncate px-1 text-xs text-black lg:h-6 lg:text-[13px]"
      >
        {label ??
          service.title}
      </p>
    </div>
  );
}

function EmptyCard({
  label,
  selected,
}: {
  label:
    string;

  selected:
    boolean;
}) {
  return (
    <div
      className={cn(
        "w-[80px] origin-bottom rounded-[16px] bg-white p-[5px] shadow-[0_2px_8px_rgba(0,0,0,0.25)]",

        "lg:w-[104px] lg:rounded-[20px] lg:p-1.5",

        selected &&
          "ring-[3px] ring-xchg-blue",
      )}
    >
      <div className="flex aspect-square w-full items-center justify-center rounded-[12px] bg-[#2ca3ff] px-2 text-center text-xs font-semibold text-white lg:rounded-[15px]">
        {label}
      </div>

      <p className="flex h-5 items-center justify-center text-xs text-black lg:h-6 lg:text-[13px]">
        {label}
      </p>
    </div>
  );
}

function MapNotice({
  children,
}: {
  children:
    ReactNode;
}) {
  return (
    <div className="flex size-full items-center justify-center bg-[#e9ecef] p-6 text-center text-sm text-xchg-gray">
      <p className="max-w-xs">
        {children}
      </p>
    </div>
  );
}