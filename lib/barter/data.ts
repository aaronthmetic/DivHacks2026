// Types for the barter UI. Listings (lib/listing-data.ts) and notifications
// (lib/notification-data.ts) come from MongoDB; zip areas are static.

import type { EditableListing } from "../listing-edit";
import type { AvailabilityWindow } from "../exchange-schema";

export type Service = {
  id: string;
  title: string;
  description: string;
  /** Category (genre) name. */
  category: string;
  /** Photo URLs; the first is the cover. */
  images: string[];
  /** The provider's average rating and number of reviews. */
  rating: number;
  ratingCount: number;
  location: string;
  /** Null for remote listings without a ZIP code. */
  zip: string | null;
  /** Price, delivery and frequency labels. */
  tags: string[];
  /** Weekly windows in New York time; empty for listings posted before availability existed. */
  availability: AvailabilityWindow[];
  /** Pricing for the request form's total; the rate is in integer hundredths of a coin. */
  pricingType: "fixed" | "hourly";
  creditRate: number;
  /** Whether the provider has turned on texts, so Contact can send them requests. */
  providerTextsEnabled: boolean;
  providerId: string;
  providerName: string;
  /** Whether the signed-in viewer posted this listing. */
  own: boolean;
  editable?: EditableListing;
  /** The viewer's open booking of this listing, if any: it's waiting for an answer, or accepted and ready to finish. */
  booking?: { id: string; status: "requested" | "accepted" | "awaiting_confirmation" };
};

export type CategoryOption = { id: string; name: string };

export type ZipArea = {
  zip: string;
  neighborhood: string;
  lat: number;
  lng: number;
};

export type Notification = {
  id: string;
  message: string;
  /** An in-app path to open when it's clicked. */
  href?: string;
  read: boolean;
  /** ISO timestamp. */
  createdAt: string;
};

// Official zip center points from NYC Open Data. Outlines are in
// zip-boundaries.json; regenerate both with scripts/zip-boundaries.mjs.
export const zipAreas: ZipArea[] = [
  { zip: "10024", neighborhood: "Upper West Side", lat: 40.78566, lng: -73.97127 },
  { zip: "10025", neighborhood: "Manhattan Valley", lat: 40.79825, lng: -73.96834 },
  { zip: "10026", neighborhood: "Central Harlem", lat: 40.80298, lng: -73.95353 },
  { zip: "10027", neighborhood: "Morningside Heights", lat: 40.81266, lng: -73.95498 },
  { zip: "10029", neighborhood: "East Harlem", lat: 40.79225, lng: -73.94733 },
  { zip: "10031", neighborhood: "Hamilton Heights", lat: 40.8248, lng: -73.95021 },
];
