import { NextResponse } from "next/server";
import { getMongo } from "@/lib/mongodb";


const API_KEYS = {
  googleMaps: process.env.GOOGLE_MAPS_API_KEY,
};

export async function GET(request, { params }) {
  const { service } = await params;

  const apiKey = API_KEYS[service];

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