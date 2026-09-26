import { ProfileForm, LogoutButton } from "@/components/auth/forms";
import { AuthShell } from "@/components/auth/shell";
import { requireSession } from "@/lib/session";

export default async function ProfilePage() {
  const { user } = await requireSession();
  return <AuthShell title="Your profile" description="Keep your name up to date.">
    <dl className="mb-6 space-y-3 rounded-lg bg-muted p-4 text-sm">
      <div><dt className="text-muted-foreground">Email</dt><dd className="break-all">{user.email}</dd></div>
      <div><dt className="text-muted-foreground">Phone number</dt><dd>{user.phoneNumber}</dd></div>
    </dl>
    <ProfileForm firstName={user.firstName ?? ""} lastName={user.lastName ?? ""} />
    <div className="mt-6 border-t pt-6"><LogoutButton /></div>
  </AuthShell>;
}
