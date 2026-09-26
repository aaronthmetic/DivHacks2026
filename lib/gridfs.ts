import "server-only";

import { GridFSBucket, ObjectId } from "mongodb";
import { getMongo } from "@/lib/mongodb";

export async function getImageBucket() {
  const { db } = await getMongo();

  return new GridFSBucket(db, {
    bucketName: "images",
  });
}

export async function uploadImage(file: File) {
  const bucket = await getImageBucket();

  const buffer = Buffer.from(
    await file.arrayBuffer(),
  );

  return await new Promise<ObjectId>(
    (resolve, reject) => {
      const stream =
        bucket.openUploadStream(
          file.name,
          {
            metadata: {
              contentType:
                file.type ||
                "application/octet-stream",
            },
          },
        );

      stream.on(
        "error",
        reject,
      );

      stream.on(
        "finish",
        () => {
          resolve(stream.id);
        },
      );

      stream.end(buffer);
    },
  );
}

export function getServiceImageUrls(
  service: {
    images?: Array<
      ObjectId | string
    >;
  },
): string[] {
  return (
    service.images ?? []
  ).map((imageId) => {
    return `/api/images/${imageId.toString()}`;
  });
}