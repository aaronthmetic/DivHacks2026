// Types for the barter UI. Listings come from MongoDB (lib/listing-data.ts); zip
// areas and notifications are still mock data until they have a real source.

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
  providerId: string;
  providerName: string;
  /** Whether the signed-in viewer posted this listing. */
  own: boolean;
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
  text: string;
  read: boolean;
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

export const notifications: Notification[] = [
  { id: "n1", text: "Emily messaged you about Guitar Lessons", read: false },
  { id: "n2", text: "New request: Calculus Tutoring", read: false },
  { id: "n3", text: "Bike Tune-Ups got a 5★ review", read: true },
  { id: "n4", text: "Alex wants to trade for Piano Lessons", read: false },
  { id: "n5", text: "Dog Walking tomorrow at 9:00 AM", read: true },
  { id: "n6", text: "Your profile is 80% complete", read: true },
  { id: "n7", text: "3 new services near 10027", read: true },
  { id: "n8", text: "Welcome to barter!", read: true },
];
