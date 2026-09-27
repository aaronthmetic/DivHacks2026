import { requireSession } from "@/lib/session";
import { Explorer } from "@/components/barter/explorer";
import { notifications, services, zipAreas } from "@/lib/barter/data";

export default async function Home({ searchParams }: { searchParams: Promise<{ search?: string | string[] }> }) {
  await requireSession();
  const { search } = await searchParams;
  return (
    <Explorer
      services={services}
      areas={zipAreas}
      notifications={notifications}
      initialZip="10027"
      query={typeof search === "string" ? search.trim() : ""}
      // Browsers always see a Maps JavaScript API key, so restrict it to your
      // domains in Google Cloud.
      mapsApiKey={process.env.GOOGLE_MAPS_API_KEY}
      mapsMapId={process.env.GOOGLE_MAPS_MAP_ID}
    />
  );
}
