import { Readable } from "node:stream";
import { ObjectId } from "mongodb";

import { getMongo } from "@/lib/mongodb";
import { getImageBucket } from "@/lib/gridfs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const { id } =
    await params;

  if (
    !ObjectId.isValid(id)
  ) {
    return new Response(
      "Invalid image ID",
      {
        status: 400,
      },
    );
  }

  const objectId =
    new ObjectId(id);

  const { db } =
    await getMongo();

  /*
   * GridFS bucket name = "images"
   *
   * therefore metadata is stored in:
   *
   * images.files
   */
  const file =
    await db
      .collection(
        "images.files",
      )
      .findOne({
        _id: objectId,
      });

  if (!file) {
    console.error(
      "[GridFS] Image not found:",
      id,
    );

    return new Response(
      "Image not found",
      {
        status: 404,
      },
    );
  }

  const bucket =
    await getImageBucket();

  const downloadStream =
    bucket.openDownloadStream(
      objectId,
    );

  /*
   * Convert MongoDB's Node Readable stream
   * into a Web ReadableStream for Next.js Response.
   */
  const webStream =
    Readable.toWeb(
      downloadStream,
    ) as ReadableStream;

  const contentType =
    file.metadata
      ?.contentType ??
    file.contentType ??
    "application/octet-stream";

  return new Response(
    webStream,
    {
      status: 200,

      headers: {
        "Content-Type":
          contentType,

        "Content-Length":
          String(
            file.length,
          ),

        "Cache-Control":
          "public, max-age=31536000, immutable",
      },
    },
  );
}