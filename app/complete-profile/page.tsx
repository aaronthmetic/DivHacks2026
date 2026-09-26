import { redirect } from "next/navigation";
import { ProfileForm, LogoutButton } from "@/components/auth/forms";
import { AuthShell } from "@/components/auth/shell";
import { requireSession } from "@/lib/session";
import { isProfileComplete } from "@/lib/auth-validation";

export default async function CompleteProfilePage() {
  const { user } = await requireSession(false);
  if (isProfileComplete(user)) redirect("/");
  return <AuthShell title="Confirm your profile" description="Check your name and add a phone number to finish creating your account.">
    <ProfileForm firstName={user.firstName ?? ""} lastName={user.lastName ?? ""} complete />
    <div className="mt-6"><LogoutButton /></div>
  </AuthShell>;
}
