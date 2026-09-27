import { ProfileShell } from "@/components/profile/shell";
import { profileCard } from "@/components/profile/styles";
import { ObjectId } from "mongodb";
import { ProfileForm } from "@/components/auth/forms";
import { ContactForm, PasswordForm, PhotoForm } from "@/components/profile/edit";
import { requireSession } from "@/lib/session";
import { getMongo } from "@/lib/mongodb";

export default async function EditProfilePage() {
  const { user } = await requireSession();
  const { db } = await getMongo();
  const credential = await db.collection("account").findOne({ userId: new ObjectId(user.id), providerId: "credential" }, { projection: { password: 1 } });
  const hasPassword = Boolean(credential?.password);
  return (
    <ProfileShell backHref="/profile" backLabel="Back to profile">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-3xl font-bold text-barter-navy">Edit profile</h1>
        <PhotoForm image={user.image} name={user.name} />
        <section className={profileCard}>
          <h2 className="mb-4 text-xl font-bold">Name</h2>
          <ProfileForm firstName={user.firstName ?? ""} lastName={user.lastName ?? ""} />
        </section>
        <ContactForm email={user.email} phone={user.phoneNumber ?? ""} hasPassword={hasPassword} />
        <PasswordForm hasPassword={hasPassword} />
      </div>
    </ProfileShell>
  );
}
