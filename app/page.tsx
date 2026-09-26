import Image from "next/image";
import { ObjectId } from "mongodb";
import { redirect } from "next/navigation";

import GoogleMap from "../components/GoogleMap.jsx";

import { getMongo } from "@/lib/mongodb";
import {
  addService,
  Service,
} from "@/lib/exchange-actions";

import {
  uploadImage,
  getServiceImageUrls,
} from "@/lib/gridfs";

type PageProps = {
  searchParams: Promise<{
    serviceId?: string;
  }>;
};

export default async function Home({
  searchParams,
}: PageProps) {
  const params = await searchParams;

  /*
   * ======================================================
   * CREATE SERVICE
   * ======================================================
   */
  async function createService(formData: FormData) {
    "use server";

    const { db } = await getMongo();

    /*
     * Get uploaded files
     */
    const files = formData
      .getAll("images")
      .filter(
        (value): value is File =>
          value instanceof File &&
          value.size > 0
      );

    if (files.length === 0) {
      throw new Error(
        "At least one image is required."
      );
    }

    /*
     * Validate images
     */
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        throw new Error(
          `${file.name} is not a valid image.`
        );
      }
    }

    /*
     * Upload images to GridFS.
     *
     * Returns:
     *
     * [
     *   ObjectId(...),
     *   ObjectId(...),
     *   ObjectId(...)
     * ]
     */
    const imageIds = await Promise.all(
      files.map((file) =>
        uploadImage(file)
      )
    );

    /*
     * Create the service and store
     * the GridFS ObjectIds.
     */
    const service = await addService(
      db,
      {
        userId:
          "68d712345678901234567890",

        genreId:
          "68d798765432109876543210",

        title:
          "JavaScript Tutoring",

        description:
          "JavaScript and React tutoring",

        zipCode: "10001",

        countryCode: "US",

        deliveryMode: "either",

        pricingType: "hourly",

        creditRate: 500,

        images: imageIds,
      }
    );

    console.log(
      "Created service:",
      service
    );

    /*
     * Reload the page with the ID
     * of the service we just created.
     */
    redirect(
      `/?serviceId=${service._id.toString()}`
    );
  }

  /*
   * ======================================================
   * LOAD CREATED SERVICE
   * ======================================================
   */

  let service: Service | null = null;

  if (
    params.serviceId &&
    ObjectId.isValid(params.serviceId)
  ) {
    const { db } = await getMongo();

    service = await db
      .collection<Service>("services")
      .findOne({
        _id: new ObjectId(
          params.serviceId
        ),
      });
  }

  /*
   * ======================================================
   * CONVERT GRIDFS IDS -> API URLS
   * ======================================================
   */

  const imageUrls =
    service
      ? getServiceImageUrls(service)
      : [];

  /*
   * imageUrls now looks like:
   *
   * [
   *   "/api/images/68d8...",
   *   "/api/images/68d9...",
   *   "/api/images/68da..."
   * ]
   */

  /*
   * ======================================================
   * PAGE
   * ======================================================
   */

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 font-sans dark:bg-black">

      <main className="flex w-full max-w-3xl flex-col gap-12 bg-white px-16 py-32 dark:bg-black">

        <GoogleMap />

        {/* ============================================
            CREATE SERVICE
        ============================================ */}

        <section className="flex flex-col gap-6">

          <div>

            <h1 className="text-3xl font-semibold text-black dark:text-white">
              Create Example Service
            </h1>

            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              Select multiple images and
              create a JavaScript tutoring
              service.
            </p>

          </div>

          <form
            action={createService}
            className="flex flex-col gap-5"
          >

            <div className="flex flex-col gap-2">

              <label
                htmlFor="images"
                className="font-medium text-black dark:text-white"
              >
                Service Images
              </label>

              <input
                id="images"
                name="images"
                type="file"
                accept="image/*"
                multiple
                required
                className="rounded-lg border border-zinc-300 bg-white p-3 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              />

            </div>

            <button
              type="submit"
              className="h-12 rounded-full bg-black px-6 font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black"
            >
              Create Service
            </button>

          </form>

        </section>

        {/* ============================================
            CREATED SERVICE
        ============================================ */}

        {service && (

          <section className="flex flex-col gap-6 border-t border-zinc-200 pt-10 dark:border-zinc-800">

            {/* SERVICE INFO */}

            <div>

              <p className="text-sm font-medium text-zinc-500">
                Service just created
              </p>

              <h2 className="mt-1 text-2xl font-semibold text-black dark:text-white">
                {service.title}
              </h2>

              <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                {service.description}
              </p>

            </div>

            {/* ========================================
                IMAGES
            ======================================== */}

            <div>

              <h3 className="mb-4 text-lg font-semibold text-black dark:text-white">
                Images
              </h3>

              {imageUrls.length > 0 ? (

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">

                  {imageUrls.map(
                    (imageUrl) => (

                      <div
                        key={imageUrl}
                        className="relative aspect-square overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-900"
                      >

                        <Image
                          src={imageUrl}
                          alt={service.title}
                          fill
                          sizes="(max-width: 640px) 50vw, 33vw"
                          className="object-cover"
                        />

                      </div>

                    )
                  )}

                </div>

              ) : (

                <p className="text-zinc-500">
                  No images found.
                </p>

              )}

            </div>

            {/* ========================================
                SERVICE DETAILS
            ======================================== */}

            <div className="rounded-xl bg-zinc-100 p-5 text-black dark:bg-zinc-900 dark:text-white">

              <div className="flex flex-col gap-2">

                <p>
                  <strong>
                    Service ID:
                  </strong>{" "}
                  {service._id.toString()}
                </p>

                <p>
                  <strong>
                    ZIP:
                  </strong>{" "}
                  {service.zipCode}
                </p>

                <p>
                  <strong>
                    Delivery:
                  </strong>{" "}
                  {service.deliveryMode}
                </p>

                <p>
                  <strong>
                    Pricing:
                  </strong>{" "}
                  {service.pricingType}
                </p>

                <p>
                  <strong>
                    Credit Rate:
                  </strong>{" "}
                  {service.creditRate}
                </p>

                <p>
                  <strong>
                    Images:
                  </strong>{" "}
                  {imageUrls.length}
                </p>

              </div>

            </div>

          </section>

        )}

      </main>

    </div>
  );
}