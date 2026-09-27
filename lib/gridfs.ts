import {
  GridFSBucket,
  ObjectId,
} from "mongodb";

import { getMongo } from "@/lib/mongodb";

const IMAGE_BUCKET_NAME =
  "images";

export async function getImageBucket(): Promise<GridFSBucket> {
  const { db } =
    await getMongo();

  return new GridFSBucket(db, {
    bucketName:
      IMAGE_BUCKET_NAME,
  });
}

export async function uploadImage(
  file: File,
): Promise<ObjectId> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} is not an image.`);
  }

  const bucket =
    await getImageBucket();

  const buffer = Buffer.from(
    await file.arrayBuffer(),
  );

  return new Promise<
    ObjectId
  >((resolve, reject) => {
    const uploadStream =
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

    uploadStream.on(
      "error",
      reject,
    );

    uploadStream.on(
      "finish",
      () => {
        resolve(
          uploadStream.id,
        );
      },
    );

    uploadStream.end(buffer);
  });
}

export async function deleteImage(
  imageId:
    | ObjectId
    | string,
): Promise<void> {
  const bucket =
    await getImageBucket();

  const id =
    typeof imageId ===
    "string"
      ? new ObjectId(imageId)
      : imageId;

  await bucket.delete(id);
}

export async function getImageStream(
  imageId:
    | ObjectId
    | string,
) {
  const bucket =
    await getImageBucket();

  const id =
    typeof imageId ===
    "string"
      ? new ObjectId(imageId)
      : imageId;

  return bucket.openDownloadStream(
    id,
  );
}

export async function getImage(
  imageId: ObjectId,
): Promise<Buffer> {
  const stream =
    await getImageStream(
      imageId,
    );

  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk),
    );
  }

  return Buffer.concat(chunks);
}

export async function getServiceImages(
  service: {
    images?: ObjectId[];
  },
): Promise<Buffer[]> {
  return Promise.all(
    (service.images ?? []).map(
      (imageId) =>
        getImage(imageId),
    ),
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
  ).map(
    (imageId) =>
      `/api/images/${imageId.toString()}`,
  );
}