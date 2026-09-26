import { Explorer } from "@/components/xchg/explorer";
import { notifications, services, zipAreas } from "@/lib/xchg/data";

export default function Home() {
  return (
    <Explorer
      services={services}
      areas={zipAreas}
      notifications={notifications}
      selectedZip="10027"
      // Browsers always see a Maps JavaScript API key, so restrict it to your
      // domains in Google Cloud.
      mapsApiKey={process.env.GOOGLE_MAPS_API_KEY}
    />
  );
}
