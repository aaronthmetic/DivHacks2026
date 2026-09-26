import "server-only";

import { ObjectId } from "mongodb";
import { getMongo } from "@/lib/mongodb";
import boundaries from "@/lib/xchg/zip-boundaries.json";

export type Category =
  | "Tutoring"
  | "Music"
  | "Repairs"
  | "Pets"
  | "Beauty"
  | "Creative"
  | "Fitness"
  | "Tech";

export type Service = {
  id: string;
  title: string;

  category: Category;

  rating: number;
  ratingCount: number;

  location: string;

  zip: string;

  tags: string[];

  images: string[];

  description?: string;
  price?: number;

  userId?: string;
  genreId?: string;
};

export type ZipArea = {
  zip: string;
  neighborhood: string;
  lat: number;
  lng: number;
};

export type Notification = {
  id: string;
  text: string;
  read: boolean;
};

type BoundaryFeature = {
  type: "Feature";

  properties?: {
    zip?: string | number;
    zipcode?: string | number;
    ZIPCODE?: string | number;

    [key: string]: unknown;
  };

  geometry?: {
    type: string;
    coordinates: unknown;
  };
};

type BoundaryCollection = {
  type: "FeatureCollection";
  features: BoundaryFeature[];
};

const boundaryCollection =
  boundaries as BoundaryCollection;

function normalizeZip(
  value: unknown,
): string {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}

function getBoundaryZip(
  feature: BoundaryFeature,
) {
  return normalizeZip(
    feature.properties?.zip ??
      feature.properties?.zipcode ??
      feature.properties?.ZIPCODE ??
      "",
  );
}

function collectCoordinates(
  value: unknown,
  result: Array<[number, number]>,
) {
  if (!Array.isArray(value)) {
    return;
  }

  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    result.push([
      value[0],
      value[1],
    ]);

    return;
  }

  for (const child of value) {
    collectCoordinates(
      child,
      result,
    );
  }
}

function getZipCenter(
  zip: string,
): {
  lat: number;
  lng: number;
} | null {
  const feature =
    boundaryCollection.features.find(
      (feature) =>
        getBoundaryZip(feature) ===
        normalizeZip(zip),
    );

  if (!feature?.geometry) {
    return null;
  }

  const coordinates: Array<
    [number, number]
  > = [];

  collectCoordinates(
    feature.geometry.coordinates,
    coordinates,
  );

  if (!coordinates.length) {
    return null;
  }

  let minLat = Infinity;
  let maxLat = -Infinity;

  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const [
    lng,
    lat,
  ] of coordinates) {
    minLat = Math.min(
      minLat,
      lat,
    );

    maxLat = Math.max(
      maxLat,
      lat,
    );

    minLng = Math.min(
      minLng,
      lng,
    );

    maxLng = Math.max(
      maxLng,
      lng,
    );
  }

  return {
    lat:
      (minLat +
        maxLat) /
      2,

    lng:
      (minLng +
        maxLng) /
      2,
  };
}

/*
 * Query MongoDB each time this function is called.
 *
 * No static service array exists anymore.
 */
export async function getServices(): Promise<Service[]> {
  const { db } =
    await getMongo();

  const documents =
    await db
      .collection("services")
      .find({})
      .toArray();

  const result =
    documents
      .map(
        (
          service,
        ): Service => {
          const zip =
            normalizeZip(
              service.zipCode ??
                service.zip ??
                "",
            );

          return {
            id:
              service._id.toString(),

            title:
              service.title ??
              "",

            category:
              (service.category as Category) ??
              "Tech",

            rating:
              Number(
                service.rating ??
                  0,
              ),

            ratingCount:
              Number(
                service.ratingCount ??
                  0,
              ),

            location:
              service.location ??
              zip,

            zip,

            tags:
              Array.isArray(
                service.tags,
              )
                ? service.tags.map(
                    (
                      tag: unknown,
                    ) =>
                      String(
                        tag,
                      ),
                  )
                : [],

            images: (
              service.images ??
              []
            ).map(
              (
                image:
                  | ObjectId
                  | string,
              ) =>
                image.toString(),
            ),

            description:
              service.description ??
              "",

            price:
              Number(
                service.price ??
                  service.creditRate ??
                  0,
              ),

            userId:
              service.userId
                ?.toString(),

            genreId:
              service.genreId
                ?.toString(),
          };
        },
      )
      .filter(
        (service) =>
          service.zip !== "",
      );

  console.log(
    "[XCHG] CURRENT SERVICES:",
    result.map(
      (service) => ({
        title:
          service.title,

        zip:
          service.zip,
      }),
    ),
  );

  return result;
}

/*
 * zipAreas comes ONLY from the services passed into it.
 *
 * There is no predetermined ZIP list anymore.
 */
export function getZipAreas(
  services: Service[],
): ZipArea[] {
  const zips =
    [
      ...new Set(
        services.map(
          (service) =>
            normalizeZip(
              service.zip,
            ),
        ),
      ),
    ].filter(Boolean);

  console.log(
    "[XCHG] CURRENT SERVICE ZIPS:",
    zips,
  );

  return zips.flatMap(
    (zip) => {
      const center =
        getZipCenter(zip);

      if (!center) {
        console.warn(
          `[XCHG] ${zip} exists in MongoDB but is missing from zip-boundaries.json`,
        );

        return [];
      }

      const service =
        services.find(
          (service) =>
            normalizeZip(
              service.zip,
            ) ===
            zip,
        );

      return [
        {
          zip,

          neighborhood:
            service?.location ??
            zip,

          lat:
            center.lat,

          lng:
            center.lng,
        },
      ];
    },
  );
}

export const notifications: Notification[] = [
  {
    id: "n1",
    text: "Emily messaged you about Guitar Lessons",
    read: false,
  },

  {
    id: "n2",
    text: "New request: Calculus Tutoring",
    read: false,
  },

  {
    id: "n3",
    text: "Bike Tune-Ups got a 5★ review",
    read: true,
  },

  {
    id: "n4",
    text: "Alex wants to trade for Piano Lessons",
    read: false,
  },

  {
    id: "n5",
    text: "Dog Walking tomorrow at 9:00 AM",
    read: true,
  },

  {
    id: "n6",
    text: "Your profile is 80% complete",
    read: true,
  },

  {
    id: "n7",
    text: "New services near you",
    read: true,
  },

  {
    id: "n8",
    text: "Welcome to XCHG!",
    read: true,
  },
];