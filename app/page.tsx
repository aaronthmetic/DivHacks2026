import { requireSession } from "@/lib/session";
import { SessionRefresh } from "@/components/auth/session-refresh";
import { Explorer } from "@/components/xchg/explorer";
import { notifications, services, zipAreas } from "@/lib/xchg/data";

export default async function Home() {
  await requireSession();
  return (
    <>
      <SessionRefresh />
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
    </>
  );
}
