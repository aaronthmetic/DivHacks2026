import Link from "next/link";
import { ObjectId } from "mongodb";
import { ProfileForm, LogoutButton } from "@/components/auth/forms";
import { ContactForm, PasswordForm, PhotoForm } from "@/components/profile/edit";
import { requireSession } from "@/lib/session";
import { getMongo } from "@/lib/mongodb";

export default async function EditProfilePage() {
  const { user } = await requireSession();
  const { db } = await getMongo();
  const credential = await db.collection("account").findOne({ userId: new ObjectId(user.id), providerId: "credential" }, { projection: { password: 1 } });
  const hasPassword = Boolean(credential?.password);
  return <main className="min-h-screen bg-muted/30 px-4 py-8"><div className="mx-auto max-w-2xl space-y-6"><Link href="/profile" className="underline">Back to profile</Link><h1 className="text-3xl font-bold text-xchg-navy">Edit profile</h1><PhotoForm image={user.image} name={user.name} /><section className="rounded-xl border bg-background p-6"><h2 className="mb-4 text-xl font-semibold">Name</h2><ProfileForm firstName={user.firstName ?? ""} lastName={user.lastName ?? ""} /></section><ContactForm email={user.email} phone={user.phoneNumber ?? ""} hasPassword={hasPassword} /><PasswordForm hasPassword={hasPassword} /><LogoutButton /></div></main>;
}
