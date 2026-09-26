const NYC_ZIP_API =
  "https://data.cityofnewyork.us/api/v3/views/35j5-n34v/query.json";

export async function GET(request, { params }) {
  try {
    const { zipcode } = await params;

    const zipCode = String(zipcode ?? "").trim();

    console.log("PARAMS:", await params);
    console.log("ZIP:", zipCode);

    if (!/^\d{5}$/.test(zipCode)) {
      return Response.json(
        {
          error: "Invalid ZIP code",
          received: zipCode,
        },
        { status: 400 }
      );
    }

    const response = await fetch(NYC_ZIP_API, {
      next: {
        revalidate: 86400,
      },
    });

    if (!response.ok) {
      throw new Error(
        `NYC Open Data returned ${response.status}`
      );
    }

    const data = await response.json();

    // Find matching ZIP
    const zipData = data.find(
      (item) =>
        String(item.zcta5).trim() === zipCode
    );

    if (!zipData) {
      return Response.json(
        {
          error: `ZIP ${zipCode} was not found in NYC`,
        },
        {
          status: 404,
        }
      );
    }

    return Response.json({
      zipCode: zipData.zcta5,

      center: {
        lat: Number(zipData.intptlat),
        lng: Number(zipData.intptlon),
      },

      geometry: zipData.the_geom,
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      { error: "Failed to retrieve ZIP boundary" },
      { status: 500 }
    );
  }
}