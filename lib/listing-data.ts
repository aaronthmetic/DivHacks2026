import { editableListing } from "./listing-edit";
import { ObjectId, type Db } from "mongodb";
import { exchangeCollections, type Service as ServiceDocument } from "./exchange-schema";
import { zipAreas, type CategoryOption, type Service } from "./barter/data";

// Newest active listings shown on the map page.
const LISTING_LIMIT = 200;
const DELIVERY: Record<ServiceDocument["deliveryMode"], string> = { in_person: "In person", remote: "Remote", either: "In person or remote" };

const coins = (credits: number) => (credits / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** "1 coin", "5 coins" or "2.5 coins", from integer hundredths. */
export function coinsLabel(credits: number) {
  const amount = coins(credits);
  return `${amount} ${amount === "1" ? "coin" : "coins"}`;
}

export function priceLabel({ creditRate, pricingType }: Pick<ServiceDocument, "creditRate" | "pricingType">) {
  return `${coinsLabel(creditRate)} / ${pricingType === "hourly" ? "hour" : "service"}`;
}

export function frequencyLabel(frequency: ServiceDocument["frequency"]) {
  if (!frequency || frequency.type === "single") return "One time";
  return frequency.interval === 1 ? `Every ${frequency.unit}` : `Every ${frequency.interval} ${frequency.unit}s`;
}

// Call only from authenticated server pages. The provider projection keeps contact details
// out of the serialized page props.
export async function getExplorerData(db: Db, viewerId: string): Promise<{ listings: Service[]; categories: CategoryOption[]; balance: number; textsEnabled: boolean }> {
  const c = exchangeCollections(db);
  const viewer = new ObjectId(viewerId);
  const [services, genres, account, viewerUser] = await Promise.all([
    c.services.find({ status: "active" }).sort({ createdAt: -1, _id: -1 }).limit(LISTING_LIMIT).toArray(),
    c.genres.find({ isActive: true }).sort({ name: 1 }).toArray(),
    c.accounts.findOne({ userId: viewer }, { projection: { availableCredits: 1 } }),
    db.collection("user").findOne({ _id: viewer }, { projection: { textsEnabledAt: 1 } }),
  ]);
  const providerIds = [...new Map(services.map((s) => [s.userId.toHexString(), s.userId])).values()];
  const providers = await db.collection("user").find({ _id: { $in: providerIds } }, { projection: { name: 1, rating: 1, numberOfReviews: 1, textsEnabledAt: 1 } }).toArray();
  const provider = new Map(providers.map((p) => [p._id.toHexString(), p]));
  const genre = new Map(genres.map((g) => [g._id.toHexString(), g.name]));
  const neighborhood = new Map(zipAreas.map((area) => [area.zip, area.neighborhood]));
  // Listings in inactive categories can't be booked, so they aren't shown either.
  const listings = services.flatMap((s): Service[] => {
    const category = genre.get(s.genreId.toHexString());
    if (!category) return [];
    const owner = provider.get(s.userId.toHexString());
    const zip = s.zipCode ?? null;
    return [{
      ...(s.userId.equals(viewer) ? { editable: editableListing(s) } : {}),
      id: s._id.toHexString(), title: s.title, description: s.description, category,
      images: (s.images ?? []).map((id) => `/api/images/${id.toHexString()}`),
      rating: Number.isFinite(owner?.rating) ? Math.max(0, Math.min(5, owner!.rating)) : 0,
      ratingCount: Number.isFinite(owner?.numberOfReviews) ? Math.max(0, owner!.numberOfReviews) : 0,
      location: zip ? neighborhood.get(zip) ?? `ZIP ${zip}` : "Remote",
      zip, tags: [priceLabel(s), DELIVERY[s.deliveryMode], frequencyLabel(s.frequency)], availability: s.availability ?? [],
      pricingType: s.pricingType, creditRate: s.creditRate, providerTextsEnabled: Boolean(owner?.textsEnabledAt),
      providerId: s.userId.toHexString(), providerName: owner?.name || "Member", own: s.userId.equals(viewer),
    }];
  });
  return {
    listings,
    categories: genres.map((g) => ({ id: g._id.toHexString(), name: g.name })),
    balance: (account?.availableCredits ?? 0) / 100,
    textsEnabled: Boolean(viewerUser?.textsEnabledAt),
  };
}
