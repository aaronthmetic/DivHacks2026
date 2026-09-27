import { GridFSBucket, ObjectId, type Db, type MongoClient } from "mongodb";
import type { Auth } from "./auth-config";
import { InputError, isProfileComplete } from "./auth-validation";
import { logAuthFailure } from "./auth-errors";
import { createExchangeService, validateService } from "./exchange-service";
import { isValidAvailability, toMinutes } from "./availability";
import type { AvailabilityWindow, Service, ServiceFrequency } from "./exchange-schema";
import { apiError, consumeProfileLimit } from "./profile-service";
import { validateProfileImage } from "./profile-image";

export const MAX_LISTING_IMAGES = 5;
/** Stays under the 4.5 MB request limit of Vercel functions; the form shrinks photos first. */
export const MAX_LISTING_BODY_BYTES = 4 * 1024 * 1024;
const FIELDS = ["title", "genreId", "description", "deliveryMode", "zipCode", "coins", "per", "frequency", "interval", "unit", "availability", "images"];

type ListingInput = Omit<Service, "_id" | "userId" | "createdAt" | "updatedAt">;

function text(form: FormData, key: string) {
  const values = form.getAll(key);
  if (values.length > 1 || values.some((value) => typeof value !== "string")) throw new InputError("Each listing field can be sent only once.");
  return typeof values[0] === "string" ? values[0].trim() : "";
}

function parseFrequency(type: string, interval: string, unit: string): ServiceFrequency {
  if (type === "single") return { type: "single" };
  if (type !== "recurring") throw new InputError("Choose single time or recurring.");
  if (!/^\d{1,2}$/.test(interval) || Number(interval) < 1) throw new InputError("Enter how often it repeats, from 1 to 99.");
  if (unit !== "day" && unit !== "week" && unit !== "month") throw new InputError("Choose days, weeks, or months.");
  return { type: "recurring", interval: Number(interval), unit };
}

const AVAILABILITY_ERROR = "Choose the days and hours you're available.";

/** The form sends [{ day, start: "HH:MM", end: "HH:MM" }] as JSON; times are stored as minutes. */
function parseAvailability(value: string): AvailabilityWindow[] {
  if (!value) throw new InputError("Choose at least one day you're available.");
  let entries: unknown;
  try { entries = value.length <= 1000 ? JSON.parse(value) : null; } catch { entries = null; }
  if (!Array.isArray(entries)) throw new InputError(AVAILABILITY_ERROR);
  if (entries.length === 0) throw new InputError("Choose at least one day you're available.");
  const windows = entries.map((entry) => {
    if (typeof entry !== "object" || entry === null || Object.keys(entry).sort().join() !== "day,end,start") throw new InputError(AVAILABILITY_ERROR);
    const { day, start, end } = entry as Record<string, unknown>;
    const from = typeof start === "string" ? toMinutes(start) : null;
    const until = typeof end === "string" ? toMinutes(end) : null;
    if (from === null || until === null) throw new InputError("Enter a start and end time for each day.");
    if (until <= from) throw new InputError("Each day's end time must be after its start time.");
    return { day: day as number, start: from, end: until };
  });
  // Also rejects days outside Sunday to Saturday and repeated days.
  if (!isValidAvailability(windows)) throw new InputError(AVAILABILITY_ERROR);
  return windows;
}

/** Maps the listing form onto the service schema. Throws InputError with a message for the user. */
export function parseListingForm(form: FormData): { input: ListingInput; images: File[] } {
  if ([...form.keys()].some((key) => !FIELDS.includes(key))) throw new InputError("This request contains fields that cannot be set.");
  const title = text(form, "title");
  if (!title) throw new InputError("Add a title.");
  const genreId = text(form, "genreId");
  if (!/^[a-f\d]{24}$/i.test(genreId)) throw new InputError("Choose a category.");
  const description = text(form, "description");
  if (!description) throw new InputError("Add a description.");
  const deliveryMode = text(form, "deliveryMode");
  if (deliveryMode !== "remote" && deliveryMode !== "in_person" && deliveryMode !== "either") throw new InputError("Choose a delivery method.");
  // Remote listings may skip the ZIP code; anything in person needs one to appear on the map.
  const zipCode = text(form, "zipCode");
  if (zipCode ? !/^\d{5}$/.test(zipCode) : deliveryMode !== "remote") throw new InputError("Enter a 5-digit ZIP code.");
  const coins = text(form, "coins");
  if (!/^\d{1,6}$/.test(coins) || Number(coins) < 1) throw new InputError("Enter a whole number of coins from 1 to 999999.");
  const per = text(form, "per");
  if (per !== "hour" && per !== "service") throw new InputError("Choose whether the price is per hour or per service.");
  const frequency = parseFrequency(text(form, "frequency"), text(form, "interval"), text(form, "unit"));
  const availability = parseAvailability(text(form, "availability"));
  const images = form.getAll("images");
  if (images.length > MAX_LISTING_IMAGES) throw new InputError(`Add at most ${MAX_LISTING_IMAGES} photos.`);
  if (images.some((image) => !(image instanceof File))) throw new InputError("Photos must be uploaded as files.");
  return {
    input: {
      genreId: new ObjectId(genreId), title, description, deliveryMode,
      ...(zipCode ? { zipCode, countryCode: "US" } : {}),
      pricingType: per === "hour" ? "hourly" : "fixed", creditRate: Number(coins) * 100,
      frequency, availability, status: "active",
    },
    images: images as File[],
  };
}

// Bounds the entire multipart body, including chunked requests, before parsing.
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("Send the listing as a multipart form.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.byteLength;
    if (size > MAX_LISTING_BODY_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
}

export async function createListing(request: Request, auth: Auth, db: Db, client: MongoClient, origin: string) {
  const bucket = new GridFSBucket(db, { bucketName: "images" });
  let uploaded: ObjectId[] = [];
  try {
    if (request.headers.get("origin") !== origin) return apiError(403, "INVALID_ORIGIN", "This request is not allowed.");
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!isProfileComplete(session.user)) return apiError(403, "PROFILE_INCOMPLETE", "Complete your profile to continue.");
    if (!await consumeProfileLimit(db, session.user.id)) return apiError(429, "RATE_LIMITED", "Too many changes. Please wait a minute and try again.");
    const body = await readBody(request);
    if (!body) return apiError(413, "LISTING_TOO_LARGE", "Your photos are too large. Remove one or choose smaller photos.");
    let form: FormData;
    try { form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData(); }
    catch { throw new InputError("Send the listing as a multipart form."); }
    const { input, images } = parseListingForm(form);
    // Check everything before storing photos, so invalid listings leave nothing behind.
    validateService(input);
    const photos = await Promise.all(images.map(async (image) => {
      const buffer = Buffer.from(await image.arrayBuffer());
      validateProfileImage(buffer, image.type);
      return { buffer, contentType: image.type };
    }));
    const userId = new ObjectId(session.user.id);
    for (const photo of photos) {
      const stream = bucket.openUploadStream("listing-photo", { metadata: { contentType: photo.contentType, ownerId: userId, purpose: "service" } });
      uploaded.push(stream.id);
      await new Promise<void>((resolve, reject) => { stream.on("finish", resolve); stream.on("error", reject); stream.end(photo.buffer); });
    }
    const service = await createExchangeService(db, client).createService(userId, { ...input, images: uploaded });
    uploaded = [];
    return Response.json({ success: true, id: service._id.toHexString() }, { status: 201 });
  } catch (error) {
    // The listing was not created, so its photos are unreferenced.
    await Promise.all(uploaded.map((id) => bucket.delete(id).catch(() => {})));
    if (error instanceof InputError) return apiError(400, "INVALID_INPUT", error.message);
    logAuthFailure("Listing creation", error);
    return apiError(503, "UNAVAILABLE", "We could not publish your listing. Please try again.");
  }
}

/** Owner-only replacement of editable fields, or irreversible removal from discovery. */
export async function modifyListing(request: Request, id: string, auth: Auth, db: Db, origin: string) {
  const bucket = new GridFSBucket(db, { bucketName: "images" });
  let uploaded: ObjectId[] = [];
  try {
    if (request.headers.get("origin") !== origin) return apiError(403, "INVALID_ORIGIN", "This request is not allowed.");
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!isProfileComplete(session.user)) return apiError(403, "PROFILE_INCOMPLETE", "Complete your profile to continue.");
    if (!await consumeProfileLimit(db, session.user.id)) return apiError(429, "RATE_LIMITED", "Too many changes. Please wait a minute and try again.");
    if (!/^[a-f\d]{24}$/i.test(id)) return apiError(400, "INVALID_INPUT", "Invalid listing ID.");
    const services = db.collection<Service>("service");
    const filter = { _id: new ObjectId(id), userId: new ObjectId(session.user.id), status: { $in: ["active", "paused"] as Service["status"][] } };
    const existing = await services.findOne(filter);
    if (!existing) return apiError(404, "NOT_FOUND", "This listing is no longer available.");
    if (request.method === "DELETE") {
      const result = await services.updateOne(filter, { $set: { status: "archived", updatedAt: new Date() } });
      if (!result.matchedCount) return apiError(404, "NOT_FOUND", "This listing is no longer available.");
      return Response.json({ success: true });
    }
    const body = await readBody(request);
    if (!body) return apiError(413, "LISTING_TOO_LARGE", "Your photos are too large. Remove one or choose smaller photos.");
    let form: FormData;
    try { form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData(); }
    catch { throw new InputError("Send the listing as a multipart form."); }
    let retained: unknown;
    try { retained = JSON.parse(text(form, "retainedImageIds")); }
    catch { throw new InputError("Choose which existing photos to keep."); }
    if (!Array.isArray(retained) || retained.some(id => typeof id !== "string" || !(existing.images ?? []).some(image => image.toHexString() === id)) || new Set(retained).size !== retained.length) {
      throw new InputError("Choose photos belonging to this listing.");
    }
    form.delete("retainedImageIds");
    const { input, images } = parseListingForm(form);
    if (retained.length + images.length > MAX_LISTING_IMAGES) throw new InputError(`Add at most ${MAX_LISTING_IMAGES} photos.`);
    validateService(input);
    if (!await db.collection("genre").findOne({ _id: input.genreId, isActive: true })) throw new InputError("Choose an active category.");
    const photos = await Promise.all(images.map(async image => {
      const buffer = Buffer.from(await image.arrayBuffer());
      validateProfileImage(buffer, image.type);
      return { buffer, contentType: image.type };
    }));
    for (const photo of photos) {
      const stream = bucket.openUploadStream("listing-photo", { metadata: { contentType: photo.contentType, ownerId: filter.userId, purpose: "service" } });
      uploaded.push(stream.id);
      await new Promise<void>((resolve, reject) => { stream.on("finish", resolve); stream.on("error", reject); stream.end(photo.buffer); });
    }
    // Do not overwrite status: another request may have paused or archived the listing.
    const { status: _status, ...fields } = input;
    void _status;
    const result = await services.updateOne({ ...filter, updatedAt: existing.updatedAt }, {
      $set: { ...fields, availability: [...input.availability!].sort((a, b) => a.day - b.day), images: [...retained.map(id => new ObjectId(id)), ...uploaded], updatedAt: new Date() },
      ...(!input.zipCode ? { $unset: { zipCode: "", countryCode: "" } } : {}),
    });
    if (!result.matchedCount) {
      await Promise.all(uploaded.map(id => bucket.delete(id).catch(() => {})));
      uploaded = [];
      return apiError(409, "CONFLICT", "This listing changed. Close the editor and refresh before trying again.");
    }
    // Existing images can still be referenced by booking snapshots.
    uploaded = [];
    return Response.json({ success: true, id });
  } catch (error) {
    await Promise.all(uploaded.map(id => bucket.delete(id).catch(() => {})));
    if (error instanceof InputError) return apiError(400, "INVALID_INPUT", error.message);
    logAuthFailure("Listing modification", error);
    return apiError(503, "UNAVAILABLE", "We could not change your listing. Please try again.");
  }
}
