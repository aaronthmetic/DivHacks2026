import { notFound } from "next/navigation";
import { ProfileView } from "@/components/profile/view";
import { getProfileData } from "@/lib/profile-data";
import { getMongo } from "@/lib/mongodb";
import { requireSession } from "@/lib/session";

export default async function MemberProfilePage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ reviewsPage?: string | string[] }> }) {
  const { user } = await requireSession();
  const { userId } = await params;
  const { db } = await getMongo();
  const profile = await getProfileData(db, userId, user.id, (await searchParams).reviewsPage);
  if (!profile) notFound();
  return <ProfileView profile={profile} basePath={`/profile/${profile.id}`} />;
}
