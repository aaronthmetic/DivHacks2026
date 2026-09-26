    import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import { getMongo } from "@/lib/mongodb";
import { getImageBucket } from "@/lib/gridfs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      return new Response("Invalid image ID", {
        status: 400,
      });
    }

    const { db } = await getMongo();
    const bucket = await getImageBucket();

    const objectId = new ObjectId(id);

    // Get file metadata so we know the content type
    const file = await db
      .collection("images.files")
      .findOne({ _id: objectId });

    if (!file) {
      return new Response("Image not found", {
        status: 404,
      });
    }

    // Download image from GridFS
    const stream = bucket.openDownloadStream(objectId);

    // Convert Node stream -> Web stream
    const readableStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => {
          controller.enqueue(chunk);
        });

        stream.on("end", () => {
          controller.close();
        });

        stream.on("error", (error) => {
          controller.error(error);
        });
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type":
          file.metadata?.contentType ??
          "application/octet-stream",

        "Cache-Control":
          "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error(error);

    return new Response("Failed to load image", {
      status: 500,
    });
  }
}