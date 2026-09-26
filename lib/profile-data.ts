import { ObjectId, type Db } from "mongodb";
import { exchangeCollections } from "./exchange-schema";

import { DEFAULT_AVATAR } from "./profile-display";
export interface ProfileCard {
  id: string; title: string; description: string; image?: string;
  lines: string[]; provider?: { id: string; name: string };
}
export interface ProfileData {
  id: string; name: string; image: string; rating: number; reviewCount: number; isOwner: boolean;
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
  const [services, bookings, total] = await Promise.all([
    c.services.find({ userId: id, status: { $in: isOwner ? ["active", "paused"] : ["active"] } }).sort({ createdAt: -1, _id: -1 }).toArray(),
    isOwner ? c.bookings.find({ requesterId: id, status: { $in: ["requested", "accepted", "awaiting_confirmation"] } }).toArray() : Promise.resolve([]),
    c.reviews.countDocuments({ subjectUserId: id }),
  ]);
  const reviewPages = Math.max(1, Math.ceil(total / 10));
  const reviewsPage = reviewPage(page, reviewPages);
  const reviews = await c.reviews.find({ subjectUserId: id }).sort({ createdAt: -1, _id: -1 }).skip((reviewsPage - 1) * 10).limit(10).toArray();
  const people = await db.collection("user").find({ _id: { $in: [...reviews.map(r => r.authorId), ...bookings.map(b => b.providerId)] } }, { projection: { name: 1, image: 1 } }).toArray();
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
    listings: services.map(s => ({ id: s._id.toHexString(), title: s.title, description: s.description,
      image: s.images?.[0] ? `/api/images/${s.images[0].toHexString()}` : undefined,
      lines: [`${credits(s.creditRate)}${s.pricingType === "hourly" ? " / hour" : " / service"}`, status(s.deliveryMode), ...(isOwner ? [status(s.status)] : [])] })),
    bookings: bookings.map(b => ({ image: b.serviceSnapshot.images?.[0] ? `/api/images/${b.serviceSnapshot.images[0].toHexString()}` : undefined, id: b._id.toHexString(), title: b.serviceSnapshot.title, description: b.serviceSnapshot.description,
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
