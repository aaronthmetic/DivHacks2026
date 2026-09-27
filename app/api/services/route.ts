import {
  ObjectId,
  type Db,
} from "mongodb";
import {
  NextResponse,
} from "next/server";

import { getMongo } from "@/lib/mongodb";
import { addService } from "@/lib/exchange-actions";
import {
  deleteImage,
  uploadImage,
} from "@/lib/gridfs";

export const runtime = "nodejs";

const MAX_PHOTOS = 5;

const MAX_TOTAL_BYTES =
  3.8 * 1024 * 1024;

const PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

function errorResponse(
  message: string,
  status = 400,
) {
  return NextResponse.json(
    {
      error: {
        message,
      },
    },
    {
      status,
    },
  );
}

export async function POST(
  request: Request,
) {
  const uploadedImageIds: ObjectId[] =
    [];

  try {
    const form =
      await request.formData();

    // --------------------------------
    // Read form fields
    // --------------------------------

    const title = String(
      form.get("title") ?? "",
    ).trim();

    const genreId = String(
      form.get("genreId") ?? "",
    ).trim();

    const description = String(
      form.get("description") ??
        "",
    ).trim();

    const zipCode = String(
      form.get("zipCode") ?? "",
    ).trim();

    const deliveryModeValue =
      String(
        form.get(
          "deliveryMode",
        ) ?? "",
      );

    const coinsValue = String(
      form.get("coins") ?? "",
    );

    const per = String(
      form.get("per") ?? "",
    );

    const imageFiles = form
      .getAll("images")
      .filter(
        (
          value,
        ): value is File =>
          value instanceof File &&
          value.size > 0,
      );

    // --------------------------------
    // Validate text
    // --------------------------------

    if (!title) {
      return errorResponse(
        "Title is required.",
      );
    }

    if (title.length > 200) {
      return errorResponse(
        "Title is too long.",
      );
    }

    if (!description) {
      return errorResponse(
        "Description is required.",
      );
    }

    if (
      description.length > 10000
    ) {
      return errorResponse(
        "Description is too long.",
      );
    }

    // --------------------------------
    // Validate genre
    // --------------------------------

    if (
      !genreId ||
      !ObjectId.isValid(genreId)
    ) {
      return errorResponse(
        "Invalid category.",
      );
    }

    // --------------------------------
    // Validate delivery mode
    // --------------------------------

    if (
      deliveryModeValue !==
        "remote" &&
      deliveryModeValue !==
        "in_person" &&
      deliveryModeValue !==
        "either"
    ) {
      return errorResponse(
        "Invalid delivery method.",
      );
    }

    const deliveryMode:
      | "remote"
      | "in_person"
      | "either" =
      deliveryModeValue;

    // Your addService() requires a
    // zipCode string. Remote listings
    // are allowed to use "".
    if (
      deliveryMode !== "remote" &&
      !/^\d{5}$/.test(zipCode)
    ) {
      return errorResponse(
        "Enter a valid 5-digit ZIP code.",
      );
    }

    if (
      zipCode &&
      !/^\d{5}$/.test(zipCode)
    ) {
      return errorResponse(
        "Enter a valid 5-digit ZIP code.",
      );
    }

    // --------------------------------
    // Pricing
    // --------------------------------

    const creditRate =
      Number(coinsValue);

    if (
      !Number.isInteger(
        creditRate,
      ) ||
      creditRate < 1 ||
      creditRate > 999999
    ) {
      return errorResponse(
        "Enter a valid number of coins.",
      );
    }

    let pricingType:
      | "hourly"
      | "fixed";

    if (per === "hour") {
      pricingType = "hourly";
    } else if (
      per === "service"
    ) {
      pricingType = "fixed";
    } else {
      return errorResponse(
        "Invalid pricing model.",
      );
    }

    // --------------------------------
    // Images
    // --------------------------------

    if (
      imageFiles.length >
      MAX_PHOTOS
    ) {
      return errorResponse(
        `You can upload up to ${MAX_PHOTOS} photos.`,
      );
    }

    const totalImageBytes =
      imageFiles.reduce(
        (total, file) =>
          total + file.size,
        0,
      );

    if (
      totalImageBytes >
      MAX_TOTAL_BYTES
    ) {
      return errorResponse(
        "Your photos are too large.",
      );
    }

    for (const file of imageFiles) {
      if (
        !PHOTO_TYPES.includes(
          file.type,
        )
      ) {
        return errorResponse(
          "Images must be JPEG, PNG, or WebP.",
        );
      }
    }

    // --------------------------------
    // MongoDB
    // --------------------------------

    const { db } =
      await getMongo();

    // --------------------------------
    // USER ID
    // --------------------------------
    //
    // Replace this with your actual
    // authenticated user's MongoDB
    // ObjectId string.
    //
    // Example:
    //
    // const userId =
    //   session.user.id;
    //
    // For temporary testing you can
    // use a valid user ObjectId:
    //
    const userId =
      "68d712345678901234567890";

    if (
      !ObjectId.isValid(userId)
    ) {
      return errorResponse(
        "Invalid user.",
        401,
      );
    }

    // --------------------------------
    // Make sure genre exists
    // --------------------------------

    const genreExists =
      await db
        .collection("genre")
        .findOne({
          _id: new ObjectId(
            genreId,
          ),
        });

    if (!genreExists) {
      return errorResponse(
        "Category was not found.",
      );
    }

    // --------------------------------
    // Upload files into GridFS
    // --------------------------------

    for (const file of imageFiles) {
      const imageId =
        await uploadImage(file);

      uploadedImageIds.push(
        imageId,
      );
    }

    // --------------------------------
    // Call YOUR addService()
    // --------------------------------

    const service =
      await addService(db, {
        userId,
        genreId,

        title,
        description,

        zipCode,
        countryCode: "US",

        deliveryMode,
        pricingType,

        creditRate,

        images:
          uploadedImageIds,
      });

    // --------------------------------
    // Return service
    // --------------------------------

    return NextResponse.json(
      {
        service: {
          _id:
            service._id.toString(),

          userId:
            service.userId.toString(),

          genreId:
            service.genreId.toString(),

          title:
            service.title,

          description:
            service.description,

          zipCode:
            service.zipCode,

          countryCode:
            service.countryCode,

          deliveryMode:
            service.deliveryMode,

          pricingType:
            service.pricingType,

          creditRate:
            service.creditRate,

          status:
            service.status,

          images:
            service.images.map(
              (imageId) =>
                imageId.toString(),
            ),

          createdAt:
            service.createdAt,

          updatedAt:
            service.updatedAt,
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error(
      "Failed to publish service:",
      error,
    );

    // If GridFS succeeded but
    // addService failed, clean up the
    // uploaded files.
    await Promise.allSettled(
      uploadedImageIds.map(
        (imageId) =>
          deleteImage(imageId),
      ),
    );

    return NextResponse.json(
      {
        error: {
          message:
            "We could not publish your listing. Please try again.",
        },
      },
      {
        status: 500,
      },
    );
  }
}