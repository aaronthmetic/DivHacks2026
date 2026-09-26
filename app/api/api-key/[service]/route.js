import { NextResponse } from "next/server";


const API_KEYS = {
  googleMaps: process.env.GOOGLE_MAPS_API_KEY,
};

export async function GET(request, { params }) {
  const { service } = await params;

  // Browser Maps keys are public; only expose the explicit supported service.
  const apiKey = service === "googleMaps" ? API_KEYS.googleMaps : undefined;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: `API key not found for service: ${service}`,
      },
      {
        status: 404,
      }
    );
  }

  return NextResponse.json({
    service,
    apiKey,
  });
}