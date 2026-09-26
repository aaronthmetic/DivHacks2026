import { GridFSBucket, ObjectId } from "mongodb";
import { getMongo } from "./mongodb";

export async function getImageBucket(): Promise<GridFSBucket> {
  const { db } = await getMongo();

  return new GridFSBucket(db, {
    bucketName: "images",
  });
}

export async function uploadImage(file: File): Promise<ObjectId> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} is not an image.`);
  }

  const bucket = await getImageBucket();

  const buffer = Buffer.from(await file.arrayBuffer());

  const stream = bucket.openUploadStream(file.name, {
    metadata: {
      contentType: file.type,
    },
  });

  await new Promise<void>((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
    stream.end(buffer);
  });

  return stream.id;
}

/*
 * Pull a single image from GridFS
 */
export async function getImage(
  imageId: ObjectId
): Promise<Buffer> {
  const bucket = await getImageBucket();

  const chunks: Buffer[] = [];

  const stream = bucket.openDownloadStream(imageId);

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    stream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    stream.on("error", reject);
  });
}

/*
 * Pull every image belonging to a service
 */
export async function getServiceImages(
  service: { images: ObjectId[] }
): Promise<Buffer[]> {
  return Promise.all(
    service.images.map((imageId) =>
      getImage(imageId)
    )
  );
}

export function getServiceImageUrls(
  service: { images?: ObjectId[] }
): string[] {
  if (!service.images) {
    return [];
  }

  return service.images.map(
    (imageId) => `/api/images/${imageId.toString()}`
  );
}