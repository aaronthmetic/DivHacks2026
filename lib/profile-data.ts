import { ObjectId, type Db } from "mongodb";
import { exchangeCollections } from "./exchange-schema";
import { frequencyLabel, priceLabel } from "./listing-data";
import { editableListing, type EditableListing } from "./listing-edit";
import type { CategoryOption } from "./barter/data";
import type { Service } from "./barter/data";

import { DEFAULT_AVATAR } from "./profile-display";
export interface ProfileCard {
  id: string; title: string; description: string; image?: string; editable?: EditableListing;
  category?: string; images?: string[]; rating?: number; ratingCount?: number; location?: string; zip?: string | null; tags?: string[]; availability?: Service["availability"]; providerId?: string; providerName?: string; own?: boolean;
  lines: string[]; provider?: { id: string; name: string };
}
export interface ProfileData {
  id: string; name: string; image: string; rating: number; reviewCount: number; isOwner: boolean;
  categories?: CategoryOption[];
  listings: ProfileCard[]; bookings: ProfileCard[];
  reviews: { id: string; authorId: string; authorName: string; authorImage: string; rating: number; comment: string; date: string }[];
  reviewsPage: number; reviewPages: number;
}
export function reviewPage(value: unknown, pages: number) {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 1;
  return Math.min(Math.max(1, pages), Number.isSafeInteger(number) ? Math.max(1, number) : 1);
}
const credits = (amount: number) => `${(amount / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} credits`;
const status = (value: string) => value.replaceAll("_", " ");

// Call only from authenticated server entrypoints. Explicit projections/DTOs keep
// contact details and booking records out of other users' serialized page props.
export async function getProfileData(db: Db, profileId: string, viewerId: string, page: unknown): Promise<ProfileData | null> {
  if (!/^[a-f\d]{24}$/i.test(profileId)) return null;
  const id = new ObjectId(profileId);
  const user = await db.collection("user").findOne({ _id: id }, { projection: { name: 1, image: 1, rating: 1, numberOfReviews: 1 } });
  if (!user) return null;
  const isOwner = id.toHexString() === viewerId;
  const c = exchangeCollections(db);
  const [services, bookings, total, genres] = await Promise.all([
    c.services.find({ userId: id, status: { $in: isOwner ? ["active", "paused"] : ["active"] } }).sort({ createdAt: -1, _id: -1 }).toArray(),
    isOwner ? c.bookings.find({ requesterId: id, status: { $in: ["requested", "accepted", "awaiting_confirmation"] } }).toArray() : Promise.resolve([]),
    c.reviews.countDocuments({ subjectUserId: id }),
    c.genres.find({ isActive: true }).toArray(),
  ]);
  const genreNames = new Map(genres.map(g => [g._id.toHexString(), g.name]));
  const reviewPages = Math.max(1, Math.ceil(total / 10));
  const reviewsPage = reviewPage(page, reviewPages);
  const reviews = await c.reviews.find({ subjectUserId: id }).sort({ createdAt: -1, _id: -1 }).skip((reviewsPage - 1) * 10).limit(10).toArray();
  const people = await db.collection("user").find({ _id: { $in: [...reviews.map(r => r.authorId), ...bookings.map(b => b.providerId), ...services.map(s => s.userId)] } }, { projection: { name: 1, image: 1, rating: 1, numberOfReviews: 1 } }).toArray();
  const neighborhoods = new Map([["10024", "Upper West Side"], ["10025", "Manhattan Valley"], ["10026", "Central Harlem"], ["10027", "Morningside Heights"], ["10029", "East Harlem"], ["10031", "Hamilton Heights"]]);
  const person = new Map(people.map(p => [p._id.toHexString(), p]));
  bookings.sort((a, b) => {
    const left = a.scheduledAt?.getTime() ?? Infinity;
    const right = b.scheduledAt?.getTime() ?? Infinity;
    return (left === right ? 0 : left < right ? -1 : 1) || a._id.toHexString().localeCompare(b._id.toHexString());
  });
  return {
    id: id.toHexString(), name: user.name || "Member", image: user.image || DEFAULT_AVATAR,
    rating: Number.isFinite(user.rating) ? Math.max(0, Math.min(5, user.rating)) : 0,
    reviewCount: Number.isFinite(user.numberOfReviews) ? Math.max(0, user.numberOfReviews) : 0,
    isOwner, reviewsPage, reviewPages,
    ...(isOwner ? { categories: genres.map(g => ({ id: g._id.toHexString(), name: g.name })) } : {}),
    listings: services.flatMap(s => {
      const category = s.genreId ? genreNames.get(s.genreId.toHexString()) ?? "Other" : "Other";
      if (!category) return [];
      const listingOwner = person.get(s.userId.toHexString());
      const zip = s.zipCode ?? null;
      const location = zip ? neighborhoods.get(zip) ?? `ZIP ${zip}` : "Remote";
      return [{ ...(isOwner ? { editable: editableListing(s) } : {}), id: s._id.toHexString(), title: s.title, description: s.description,
        image: s.images?.[0] ? `/api/images/${s.images[0].toHexString()}` : undefined,
        category, images: (s.images ?? []).map(image => `/api/images/${image.toHexString()}`),
        rating: Number.isFinite(listingOwner?.rating) ? Math.max(0, Math.min(5, listingOwner!.rating)) : 0,
        ratingCount: Number.isFinite(listingOwner?.numberOfReviews) ? listingOwner!.numberOfReviews : 0,
        location, zip, tags: [priceLabel(s), s.deliveryMode === "in_person" ? "In person" : s.deliveryMode === "either" ? "In person or remote" : "Remote", frequencyLabel(s.frequency)], availability: s.availability ?? [],
        providerId: s.userId.toHexString(), providerName: listingOwner?.name || "Member", own: isOwner,
        lines: [`${credits(s.creditRate)}${s.pricingType === "hourly" ? " / hour" : " / service"}`, status(s.deliveryMode), ...(isOwner ? [status(s.status)] : [])] }];
    }),
    bookings: bookings.map(b => ({ category: b.serviceSnapshot.genreId ? genreNames.get(b.serviceSnapshot.genreId.toHexString()) : undefined, images: (b.serviceSnapshot.images ?? []).map(image => `/api/images/${image.toHexString()}`), location: b.serviceSnapshot.zipCode ? neighborhoods.get(b.serviceSnapshot.zipCode) ?? `ZIP ${b.serviceSnapshot.zipCode}` : "Remote", zip: b.serviceSnapshot.zipCode ?? null, tags: [`${credits(b.serviceSnapshot.creditRate)}${b.serviceSnapshot.pricingType === "hourly" ? " / hour" : " / service"}`, b.serviceSnapshot.deliveryMode === "in_person" ? "In person" : b.serviceSnapshot.deliveryMode === "either" ? "In person or remote" : "Remote", frequencyLabel(b.serviceSnapshot.frequency)], availability: b.serviceSnapshot.availability ?? [], rating: 0, ratingCount: 0, providerId: b.providerId.toHexString(), providerName: person.get(b.providerId.toHexString())?.name || "Member", own: false, image: b.serviceSnapshot.images?.[0] ? `/api/images/${b.serviceSnapshot.images[0].toHexString()}` : undefined, id: b._id.toHexString(), title: b.serviceSnapshot.title, description: b.serviceSnapshot.description,
      provider: { id: b.providerId.toHexString(), name: person.get(b.providerId.toHexString())?.name || "Member" },
      lines: [b.scheduledAt ? `${b.scheduledAt.toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC` : "Not scheduled", status(b.status), `${credits(b.totalCredits)} total`,
        `${credits(b.serviceSnapshot.creditRate)}${b.serviceSnapshot.pricingType === "hourly" ? " / hour" : " / service"}`,
        ...(b.durationMinutes ? [`${b.durationMinutes} minutes`] : []),
        ...(b.serviceSnapshot.deliveryMode ? [status(b.serviceSnapshot.deliveryMode)] : []),
        ...(b.serviceSnapshot.zipCode ? [[b.serviceSnapshot.zipCode, b.serviceSnapshot.countryCode].filter(Boolean).join(", ")] : [])] })),
    reviews: reviews.map(r => ({ id: r._id.toHexString(), authorId: r.authorId.toHexString(), authorName: person.get(r.authorId.toHexString())?.name || "Former member",
      authorImage: person.get(r.authorId.toHexString())?.image || DEFAULT_AVATAR, rating: r.rating, comment: r.comment, date: r.createdAt.toISOString().slice(0, 10) })),
  };
}
