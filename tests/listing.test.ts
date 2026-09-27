import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createAuth, type Auth } from "../lib/auth-config";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { DEFAULT_GENRES, ensureDefaultGenres, ensureExchangeIndexes, exchangeCollections } from "../lib/exchange-schema";
import { createExchangeService } from "../lib/exchange-service";
import { snapshotService } from "../lib/booking-snapshot";
import { modifyListing, createListing, MAX_LISTING_BODY_BYTES, parseListingForm } from "../lib/listing-service";
import { getProfileData } from "../lib/profile-data";
import { frequencyLabel, getExplorerData, priceLabel } from "../lib/listing-data";

let server: MongoMemoryReplSet, client: MongoClient, db: Db, auth: Auth;
const origin = "http://localhost:3000";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=", "base64");

before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("listings");
  await ensureAuthIndexes(db); await ensureExchangeIndexes(db); await ensureDefaultGenres(db);
  auth = createAuth(db, client, { baseURL: origin, secret: "listing-test-secret-at-least-thirty-two-characters" });
});
after(async () => { await client?.close(); await server?.stop(); });

async function lister(number: number) {
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": `192.0.2.${number}` }, body: JSON.stringify({ firstName: "List", lastName: "Owner", email: `lister${number}@example.com`, phoneNumber: `+12025550${String(300 + number)}`, password: "listing-test-password!" }) }));
  assert.equal(response.status, 200, await response.clone().text());
  return { cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), id: new ObjectId((await response.json()).user.id) };
}
async function genreId(slug = "tutoring") {
  return (await exchangeCollections(db).genres.findOne({ slug }))!._id.toHexString();
}
function listingForm(fields: Record<string, string>, images: Buffer[] = []) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  images.forEach((image, index) => form.append("images", new File([new Uint8Array(image)], `photo${index}.png`, { type: "image/png" })));
  return form;
}
function post(cookie: string, body: FormData | Blob, requestOrigin = origin) {
  return createListing(new Request(`${origin}/api/services`, { method: "POST", headers: { cookie, origin: requestOrigin }, body }), auth, db, client, origin);
}
const baseFields = (genre: string): Record<string, string> => ({ title: "Algebra help", genreId: genre, description: "Homework and test prep.", deliveryMode: "in_person", zipCode: "10027", coins: "5", per: "hour", frequency: "recurring", interval: "2", unit: "week", availability: JSON.stringify([{ day: 6, start: "10:00", end: "14:00" }, { day: 1, start: "17:00", end: "20:00" }]) });
// baseFields' availability in minutes, sorted by day the way it's stored.
const storedAvailability = [{ day: 1, start: 1020, end: 1200 }, { day: 6, start: 600, end: 840 }];

test("default categories are inserted once and existing ones are left alone", async () => {
  const { genres } = exchangeCollections(db);
  await genres.updateOne({ slug: "music" }, { $set: { name: "Music lessons" } });
  await ensureDefaultGenres(db); await ensureDefaultGenres(db);
  assert.equal(await genres.countDocuments({ slug: { $in: DEFAULT_GENRES.map((g) => g.slug) } }), DEFAULT_GENRES.length);
  assert.equal((await genres.findOne({ slug: "music" }))?.name, "Music lessons");
  await genres.updateOne({ slug: "music" }, { $set: { name: "Music" } });
});

test("the listing form maps onto the service schema", async () => {
  const genre = await genreId();
  const { input } = parseListingForm(listingForm(baseFields(genre)));
  assert.deepEqual({ ...input, genreId: input.genreId.toHexString() }, {
    genreId: genre, title: "Algebra help", description: "Homework and test prep.", deliveryMode: "in_person",
    zipCode: "10027", countryCode: "US", pricingType: "hourly", creditRate: 500,
    frequency: { type: "recurring", interval: 2, unit: "week" },
    availability: [{ day: 6, start: 600, end: 840 }, { day: 1, start: 1020, end: 1200 }], status: "active",
  });
  const remote = parseListingForm(listingForm({ ...baseFields(genre), deliveryMode: "remote", zipCode: "", per: "service", frequency: "single", interval: "", unit: "" })).input;
  assert.equal(remote.zipCode, undefined); assert.equal(remote.countryCode, undefined);
  assert.equal(remote.pricingType, "fixed"); assert.deepEqual(remote.frequency, { type: "single" });
  const days = (...slots: object[]) => JSON.stringify(slots);
  const invalid: Record<string, string>[] = [{ zipCode: "" }, { zipCode: "1002" }, { coins: "0" }, { coins: "1.5" }, { per: "day" }, { frequency: "weekly" }, { interval: "0" }, { interval: "100" }, { unit: "year" }, { genreId: "nope" }, { title: " " },
    { availability: "" }, { availability: "[]" }, { availability: "Mondays" }, { availability: "{}" },
    { availability: days({ day: 1, start: "20:00", end: "17:00" }) }, { availability: days({ day: 1, start: "17:00", end: "17:00" }) },
    { availability: days({ day: 1, start: "5pm", end: "20:00" }) }, { availability: days({ day: 7, start: "17:00", end: "20:00" }) },
    { availability: days({ day: 1, start: "17:00", end: "20:00" }, { day: 1, start: "08:00", end: "09:00" }) },
    { availability: days({ day: 1, start: "17:00", end: "20:00", note: "x" }) },
    // Valid JSON, but longer than the 1,000-character limit.
    { availability: days({ day: 1, start: "17:00", end: "20:00" }).replace("[", `[${" ".repeat(1000)}`) },
  ];
  for (const bad of invalid) {
    assert.throws(() => parseListingForm(listingForm({ ...baseFields(genre), ...bad })), /./, JSON.stringify(bad));
  }
  const extra = listingForm(baseFields(genre)); extra.set("userId", new ObjectId().toHexString());
  assert.throws(() => parseListingForm(extra), /cannot be set/);
  const repeated = listingForm(baseFields(genre)); repeated.append("title", "Second title");
  assert.throws(() => parseListingForm(repeated), /only once/);
});

test("frequency is validated, stored without extra keys, and snapshotted", async () => {
  const user = await lister(1);
  const domain = createExchangeService(db, client);
  const input = { ...parseListingForm(listingForm(baseFields(await genreId()))).input };
  for (const frequency of [{ type: "recurring", interval: 0, unit: "week" }, { type: "recurring", interval: 2, unit: "year" }, { type: "monthly" }]) {
    await assert.rejects(domain.createService(user.id, { ...input, frequency } as never));
  }
  const service = await domain.createService(user.id, { ...input, frequency: { type: "recurring", interval: 3, unit: "day", note: "x" } as never });
  assert.deepEqual((await exchangeCollections(db).services.findOne({ _id: service._id }))?.frequency, { type: "recurring", interval: 3, unit: "day" });
  assert.deepEqual(snapshotService(service).frequency, { type: "recurring", interval: 3, unit: "day" });
  assert.equal(frequencyLabel(undefined), "One time");
  assert.equal(frequencyLabel({ type: "recurring", interval: 1, unit: "month" }), "Every month");
  assert.equal(frequencyLabel({ type: "recurring", interval: 2, unit: "week" }), "Every 2 weeks");
  assert.equal(priceLabel({ creditRate: 100, pricingType: "fixed" }), "1 coin / service");
  assert.equal(priceLabel({ creditRate: 250, pricingType: "hourly" }), "2.5 coins / hour");
});

test("availability is required, stored sorted without extra keys, and snapshotted", async () => {
  const user = await lister(5);
  const domain = createExchangeService(db, client);
  const input = { ...parseListingForm(listingForm(baseFields(await genreId()))).input };
  for (const availability of [undefined, [], [{ day: 1, start: 600, end: 600 }], [{ day: 7, start: 0, end: 60 }], [{ day: 1, start: 0, end: 60 }, { day: 1, start: 90, end: 120 }]]) {
    await assert.rejects(domain.createService(user.id, { ...input, availability } as never), JSON.stringify(availability));
  }
  const service = await domain.createService(user.id, { ...input, availability: [{ day: 6, start: 600, end: 840, note: "x" }, { day: 1, start: 1020, end: 1200 }] as never });
  assert.deepEqual((await exchangeCollections(db).services.findOne({ _id: service._id }))?.availability, storedAvailability);
  assert.deepEqual(snapshotService(service).availability, storedAvailability);
});

test("publishing requires a session and the app origin, stores photos, and cleans up failures", async () => {
  const user = await lister(2);
  const genre = await genreId();
  assert.equal((await post("", listingForm(baseFields(genre)))).status, 401);
  assert.equal((await post(user.cookie, listingForm(baseFields(genre)), "https://evil.example")).status, 403);
  const files = db.collection("images.files");
  const before = await files.countDocuments();
  const created = await post(user.cookie, listingForm(baseFields(genre), [png, png]));
  assert.equal(created.status, 201, await created.clone().text());
  const service = await exchangeCollections(db).services.findOne({ _id: new ObjectId((await created.json()).id) });
  assert.ok(service?.userId.equals(user.id));
  assert.equal(service?.creditRate, 500); assert.equal(service?.pricingType, "hourly"); assert.equal(service?.status, "active");
  assert.deepEqual(service?.frequency, { type: "recurring", interval: 2, unit: "week" });
  assert.deepEqual(service?.availability, storedAvailability);
  assert.equal(service?.images?.length, 2);
  const stored = await files.find({ _id: { $in: service!.images! } }).toArray();
  assert.ok(stored.every((file) => file.metadata.purpose === "service" && file.metadata.ownerId.equals(user.id) && file.metadata.contentType === "image/png"));
  // A listing the domain rejects (unknown category) must not leave its photos behind.
  const rejected = await post(user.cookie, listingForm({ ...baseFields(genre), genreId: new ObjectId().toHexString() }, [png]));
  assert.equal(rejected.status, 400);
  assert.equal(await files.countDocuments(), before + 2);
  assert.equal((await post(user.cookie, listingForm(baseFields(genre), [Buffer.from("not an image")]))).status, 400);
  assert.equal((await post(user.cookie, listingForm({ ...baseFields(genre), availability: "" }))).status, 400);
  assert.equal(await files.countDocuments(), before + 2);
  const oversized = new Blob([new Uint8Array(MAX_LISTING_BODY_BYTES + 1)], { type: "multipart/form-data; boundary=x" });
  assert.equal((await post(user.cookie, oversized)).status, 413);
  const remote = await post(user.cookie, listingForm({ ...baseFields(genre), deliveryMode: "remote", zipCode: "", frequency: "single" }));
  assert.equal(remote.status, 201, await remote.clone().text());
});

test("the explorer lists active listings with provider ratings and labels", async () => {
  const viewer = await lister(3), provider = await lister(4);
  const domain = createExchangeService(db, client);
  await domain.grantWelcome(viewer.id);
  await db.collection("user").updateOne({ _id: provider.id }, { $set: { rating: 4.5, numberOfReviews: 2 } });
  const tech = await genreId("tech");
  const input = { ...parseListingForm(listingForm({ ...baseFields(tech), title: "Laptop setup", per: "service", coins: "12", frequency: "single" })).input };
  const shown = await domain.createService(provider.id, input);
  const paused = await domain.createService(provider.id, { ...input, title: "Paused", status: "paused" });
  const hiddenGenre = new ObjectId();
  await exchangeCollections(db).genres.insertOne({ _id: hiddenGenre, name: "Retired", slug: "retired", description: "", isActive: true });
  const retired = await domain.createService(provider.id, { ...input, title: "Retired category", genreId: hiddenGenre });
  await exchangeCollections(db).genres.updateOne({ _id: hiddenGenre }, { $set: { isActive: false } });

  const data = await getExplorerData(db, viewer.id.toHexString());
  const ids = data.listings.map((listing) => listing.id);
  assert.ok(ids.includes(shown._id.toHexString()));
  assert.ok(!ids.includes(paused._id.toHexString()) && !ids.includes(retired._id.toHexString()));
  assert.deepEqual(data.listings.find((listing) => listing.id === shown._id.toHexString()), {
    id: shown._id.toHexString(), title: "Laptop setup", description: "Homework and test prep.", category: "Tech", images: [],
    rating: 4.5, ratingCount: 2, location: "Morningside Heights", zip: "10027",
    tags: ["12 coins / service", "In person", "One time"], availability: storedAvailability, pricingType: "fixed", creditRate: 1200, providerTextsEnabled: false,
    providerId: provider.id.toHexString(), providerName: "List Owner", own: false,
  });
  assert.equal(data.balance, 10);
  assert.equal(data.textsEnabled, false);
  await db.collection("user").updateMany({ _id: { $in: [viewer.id, provider.id] } }, { $set: { textsEnabledAt: new Date() } });
  const texting = await getExplorerData(db, viewer.id.toHexString());
  assert.equal(texting.textsEnabled, true);
  assert.equal(texting.listings.find((listing) => listing.id === shown._id.toHexString())?.providerTextsEnabled, true);
  assert.ok(data.categories.some((category) => category.name === "Tech"));
  assert.ok(!data.categories.some((category) => category.name === "Retired"));
  const own = await getExplorerData(db, provider.id.toHexString());
  assert.equal(own.listings.find((listing) => listing.id === shown._id.toHexString())?.own, true);
});

function modify(cookie: string, id: string, body?: FormData | Blob, requestOrigin = origin) {
  return modifyListing(new Request(`${origin}/api/services/${id}`, {
    method: body ? "PATCH" : "DELETE", headers: { cookie, origin: requestOrigin }, ...(body ? { body } : {}),
  }), id, auth, db, origin);
}

test("owners can edit and archive listings while booking snapshots and photos survive", async () => {
  const owner = await lister(10), requester = await lister(11);
  const genre = await genreId();
  const created = await post(owner.cookie, listingForm(baseFields(genre), [png, png]));
  const id = (await created.json()).id;
  const c = exchangeCollections(db);
  const original = (await c.services.findOne({ _id: new ObjectId(id) }))!;
  const domain = createExchangeService(db, client);
  await domain.grantWelcome(requester.id);
  const booking = await domain.requestBooking(requester.id, original._id, { durationMinutes: 60, preferredWindow: storedAvailability[0] });
  await c.services.updateOne({ _id: original._id }, { $set: { status: "paused" } });
  const updated = await modify(owner.cookie, id, listingForm({ ...baseFields(genre),
    title: "Updated title", description: "New description", deliveryMode: "remote", zipCode: "", coins: "8", per: "service",
    frequency: "single", availability: JSON.stringify([{ day: 2, start: "09:00", end: "10:00" }]),
    retainedImageIds: JSON.stringify([original.images![1].toHexString()]),
  }, [png]));
  assert.equal(updated.status, 200, await updated.clone().text());
  const saved = (await c.services.findOne({ _id: original._id }))!;
  assert.equal(saved.title, "Updated title"); assert.equal(saved.description, "New description");
  assert.equal(saved.status, "paused"); assert.equal(saved.deliveryMode, "remote");
  assert.equal(saved.zipCode, undefined); assert.equal(saved.countryCode, undefined);
  assert.equal(saved.creditRate, 800); assert.equal(saved.pricingType, "fixed");
  assert.deepEqual(saved.frequency, { type: "single" });
  assert.deepEqual(saved.availability, [{ day: 2, start: 540, end: 600 }]);
  assert.deepEqual(saved.createdAt, original.createdAt); assert.deepEqual(saved.userId, original.userId);
  assert.equal(saved.images?.length, 2); assert.ok(saved.images![0].equals(original.images![1]));
  assert.equal(await db.collection("images.files").countDocuments({ _id: { $in: original.images } }), 2);
  const profile = (await getProfileData(db, owner.id.toHexString(), owner.id.toHexString(), "1"))!;
  assert.equal(profile.listings.find(card => card.id === id)?.editable?.creditRate, 800);
  assert.ok(profile.categories?.length);
  const publicProfile = (await getProfileData(db, owner.id.toHexString(), requester.id.toHexString(), "1"))!;
  assert.equal(publicProfile.categories, undefined);
  assert.ok(publicProfile.listings.every(card => card.editable === undefined));
  assert.equal((await modify(owner.cookie, id)).status, 200);
  assert.equal((await c.services.findOne({ _id: original._id }))?.status, "archived");
  assert.deepEqual(await c.bookings.findOne({ _id: booking._id }), booking);
  assert.equal(await db.collection("images.files").countDocuments({ _id: { $in: original.images } }), 2);
  assert.ok(!(await getExplorerData(db, owner.id.toHexString())).listings.some(card => card.id === id));
  assert.ok(!(await getProfileData(db, owner.id.toHexString(), owner.id.toHexString(), "1"))!.listings.some(card => card.id === id));
  assert.equal((await modify(owner.cookie, id)).status, 404);
  assert.equal((await modify(owner.cookie, id, listingForm({ ...baseFields(genre), retainedImageIds: "[]" }))).status, 404);
  await assert.rejects(domain.requestBooking(requester.id, original._id, { durationMinutes: 60, preferredWindow: { day: 2, start: 540, end: 600 } }), /Active service not found/);
});

test("listing mutations reject unauthorized and invalid requests without changing stored data", async () => {
  const owner = await lister(12), other = await lister(13);
  const genre = await genreId();
  const created = await post(owner.cookie, listingForm(baseFields(genre), [png]));
  const id = (await created.json()).id;
  const c = exchangeCollections(db);
  const original = (await c.services.findOne({ _id: new ObjectId(id) }))!;
  const form = (extra: Record<string, string> = {}, photos: Buffer[] = []) => listingForm({ ...baseFields(genre), retainedImageIds: JSON.stringify(original.images!.map(id => id.toHexString())), ...extra }, photos);
  for (const body of [undefined, form()]) {
    assert.equal((await modify("", id, body)).status, 401);
    assert.equal((await modify(other.cookie, id, body)).status, 404);
    assert.equal((await modify(owner.cookie, id, body, "https://evil.example")).status, 403);
  }
  assert.equal((await modify(owner.cookie, "invalid")).status, 400);
  const invalidEdits: Record<string, string>[] = [
    { retainedImageIds: "invalid" }, { retainedImageIds: JSON.stringify([new ObjectId().toHexString()]) },
    { retainedImageIds: JSON.stringify([original.images![0].toHexString(), original.images![0].toHexString()]) },
    { title: "" }, { availability: "[]" }, { userId: other.id.toHexString() }, { status: "active" },
    { genreId: new ObjectId().toHexString() },
  ];
  for (const extra of invalidEdits) {
    const response = await modify(owner.cookie, id, form(extra));
    assert.equal(response.status, 400, await response.clone().text());
  }
  const filesBefore = await db.collection("images.files").countDocuments();
  assert.equal((await modify(owner.cookie, id, form({}, [png, png, png, png, png]))).status, 400);
  assert.equal((await modify(owner.cookie, id, form({}, [Buffer.from("invalid image")]))).status, 400);
  const oversized = new Blob([new Uint8Array(MAX_LISTING_BODY_BYTES + 1)], { type: "multipart/form-data; boundary=x" });
  assert.equal((await modify(owner.cookie, id, oversized)).status, 413);
  assert.equal(await db.collection("images.files").countDocuments(), filesBefore);
  assert.deepEqual(await c.services.findOne({ _id: original._id }), original);
});

test("failed listing saves and uploads clean up new images and preserve the original listing", async () => {
  const owner = await lister(14);
  const genre = await genreId();
  const created = await post(owner.cookie, listingForm(baseFields(genre), [png]));
  const id = (await created.json()).id;
  const original = await exchangeCollections(db).services.findOne({ _id: new ObjectId(id) });
  for (const failure of ["save", "upload", "conflict"]) {
    const failedDb = new Proxy(db, { get(target, key) {
      if (key === "collection") return (name: string) => {
        const collection = target.collection(name);
        if (name !== (failure === "upload" ? "images.chunks" : "service")) return collection;
        return new Proxy(collection, { get(target, key) {
          if (key === (failure === "upload" ? "insertOne" : "updateOne")) return async () => {
            if (failure === "conflict") return { matchedCount: 0 };
            throw new Error("Simulated listing failure");
          };
          const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const request = new Request(`${origin}/api/services/${id}`, { method: "PATCH", headers: { cookie: owner.cookie, origin }, body: listingForm({ ...baseFields(genre), retainedImageIds: "[]" }, [png]) });
    assert.equal((await modifyListing(request, id, auth, failedDb, origin)).status, failure === "conflict" ? 409 : 503);
    assert.equal(await db.collection("images.files").countDocuments({ "metadata.ownerId": owner.id }), 1);
    assert.deepEqual(await exchangeCollections(db).services.findOne({ _id: new ObjectId(id) }), original);
  }
});
