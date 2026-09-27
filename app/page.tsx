import { requireSession } from "@/lib/session";
import { getMongo } from "@/lib/mongodb";
import { getExplorerData } from "@/lib/listing-data";
import { Explorer } from "@/components/barter/explorer";
import { zipAreas } from "@/lib/barter/data";
import { getCurrentUserNotifications } from "@/lib/notification-data";

export default async function Home({ searchParams }: { searchParams: Promise<{ search?: string | string[] }> }) {
  const { user } = await requireSession();
  const { search } = await searchParams;
  const { db } = await getMongo();
  const { listings, categories, balance } = await getExplorerData(db, user.id);
  const {
    notifications,
    unreadCount,
  } = await getCurrentUserNotifications();
  return (
    <Explorer
      services={listings}
      categories={categories}
      balance={balance}
      areas={zipAreas}
      notifications={notifications}
      unreadCount={unreadCount}
      initialZip="10027"
      query={typeof search === "string" ? search.trim() : ""}
      // Browsers always see a Maps JavaScript API key, so restrict it to your
      // domains in Google Cloud.
      mapsApiKey={process.env.GOOGLE_MAPS_API_KEY}
    />
  );
}
