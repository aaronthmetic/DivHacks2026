import { GridFSBucket, ObjectId, type Db } from "mongodb";
import type { Auth } from "./auth-config";
import { apiError, consumeProfileLimit } from "./profile-service";
import { isProfileComplete, InputError } from "./auth-validation";
import { DEFAULT_AVATAR } from "./profile-display";
import { logAuthFailure } from "./auth-errors";

export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
export function validateProfileImage(buffer: Buffer, mime: string) {
  if (!buffer.length || buffer.length > MAX_PROFILE_IMAGE_BYTES) throw new InputError("Choose an image up to 5 MiB.");
  const valid = mime === "image/jpeg" ? buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    : mime === "image/png" ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === "image/webp" ? buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" : false;
  if (!valid) throw new InputError("Choose a valid JPEG, PNG, or WebP image.");
}
async function removeOwnedImage(db: Db, bucket: GridFSBucket, image: unknown, userId: ObjectId) {
  if (typeof image !== "string") return;
  const match = /^\/api\/images\/([a-f\d]{24})$/.exec(image);
  if (!match) return;
  const id = new ObjectId(match[1]);
  const file = await db.collection("images.files").findOne({ _id: id, "metadata.ownerId": userId, "metadata.purpose": "profile" });
  if (!file || await db.collection("service").findOne({ images: id }) || await db.collection("user").findOne({ image })) return;
  await bucket.delete(id);
}
export async function updateProfileImage(request: Request, auth: Auth, db: Db, origin: string) {
  try {
    if (request.headers.get("origin") !== origin) return apiError(403, "INVALID_ORIGIN", "This request is not allowed.");
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!isProfileComplete(session.user)) return apiError(403, "PROFILE_INCOMPLETE", "Complete your profile to continue.");
    if (!await consumeProfileLimit(db, session.user.id)) return apiError(429, "RATE_LIMITED", "Too many changes. Please wait a minute and try again.");
    const userId = new ObjectId(session.user.id);
    const bucket = new GridFSBucket(db, { bucketName: "images" });
    let image = DEFAULT_AVATAR;
    let uploaded: ObjectId | undefined;
    if (request.method === "POST") {
      // Bound the entire multipart body, including chunked requests, before parsing.
      const maxBody = MAX_PROFILE_IMAGE_BYTES + 64 * 1024;
      const reader = request.body?.getReader();
      if (!reader) throw new InputError("Choose an image.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBody) { await reader.cancel(); return apiError(413, "IMAGE_TOO_LARGE", "Choose an image up to 5 MiB."); }
        chunks.push(value);
      }
      let form: FormData;
      try { form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") || "" } }).formData(); }
      catch { throw new InputError("Send a multipart image upload."); }
      const file = form.get("image");
      if (!(file instanceof File) || [...form.keys()].some(key => key !== "image") || form.getAll("image").length !== 1) throw new InputError("Choose one image.");
      const buffer = Buffer.from(await file.arrayBuffer());
      validateProfileImage(buffer, file.type);
      const stream = bucket.openUploadStream("profile-photo", { metadata: { contentType: file.type, ownerId: userId, purpose: "profile" } });
      uploaded = stream.id;
      try {
        await new Promise<void>((resolve, reject) => { stream.on("finish", resolve); stream.on("error", reject); stream.end(buffer); });
      } catch (error) { await stream.abort().catch(() => {}); await bucket.delete(uploaded).catch(() => {}); throw error; }
      image = `/api/images/${uploaded.toHexString()}`;
    } else if (request.method !== "DELETE") return apiError(405, "METHOD_NOT_ALLOWED", "Unsupported operation.");
    let previous;
    try {
      // Return the replaced image atomically so concurrent uploads clean up safely.
      previous = await db.collection("user").findOneAndUpdate({ _id: userId }, { $set: { image, updatedAt: new Date() } }, { returnDocument: "before" });
      if (!previous) throw new Error("User no longer exists");
    } catch (error) { if (uploaded) await bucket.delete(uploaded).catch(() => {}); throw error; }
    await removeOwnedImage(db, bucket, previous.image, userId).catch(error => logAuthFailure("Profile image cleanup", error));
    return Response.json({ success: true, image });
  } catch (error) {
    if (error instanceof InputError) return apiError(400, "INVALID_INPUT", error.message);
    logAuthFailure("Profile image update", error);
    return apiError(503, "UNAVAILABLE", "We could not save your photo. Please try again.");
  }
}
