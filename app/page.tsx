import { requireSession } from "@/lib/session";
import { Explorer } from "@/components/xchg/explorer";
import {
  getServices,
  getZipAreas,
  notifications,
} from "@/lib/xchg/data";

export const dynamic =
  "force-dynamic";

export default async function Home() {
  await requireSession();
  const services = await getServices();
  const zipAreas = getZipAreas(services);
  return (
    <Explorer
      services={services}
      areas={zipAreas}
      notifications={notifications}
      initialZip="10027"
      // Browsers always see a Maps JavaScript API key, so restrict it to your
      // domains in Google Cloud.
      mapsApiKey={process.env.GOOGLE_MAPS_API_KEY}
      mapsMapId={process.env.GOOGLE_MAPS_MAP_ID}
    />
  );
}
