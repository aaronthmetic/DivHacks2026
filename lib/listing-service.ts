import { GridFSBucket, ObjectId, type Db, type MongoClient } from "mongodb";
import type { Auth } from "./auth-config";
import { InputError, isProfileComplete } from "./auth-validation";
import { logAuthFailure } from "./auth-errors";
import { createExchangeService, validateService } from "./exchange-service";
import type { Service, ServiceFrequency } from "./exchange-schema";
import { apiError, consumeProfileLimit } from "./profile-service";
import { validateProfileImage } from "./profile-image";

export const MAX_LISTING_IMAGES = 5;
/** Stays under the 4.5 MB request limit of Vercel functions; the form shrinks photos first. */
export const MAX_LISTING_BODY_BYTES = 4 * 1024 * 1024;
const FIELDS = ["title", "genreId", "description", "deliveryMode", "zipCode", "coins", "per", "frequency", "interval", "unit", "images"];

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
  const images = form.getAll("images");
  if (images.length > MAX_LISTING_IMAGES) throw new InputError(`Add at most ${MAX_LISTING_IMAGES} photos.`);
  if (images.some((image) => !(image instanceof File))) throw new InputError("Photos must be uploaded as files.");
  return {
    input: {
      genreId: new ObjectId(genreId), title, description, deliveryMode,
      ...(zipCode ? { zipCode, countryCode: "US" } : {}),
      pricingType: per === "hour" ? "hourly" : "fixed", creditRate: Number(coins) * 100,
      frequency, status: "active",
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
