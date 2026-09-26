import { ProfileForm, LogoutButton } from "@/components/auth/forms";
import { AuthShell } from "@/components/auth/shell";
import { requireSession } from "@/lib/session";

export default async function ProfilePage() {
  const { user } = await requireSession();
  return <AuthShell title="Your profile" description="Keep your name up to date." backToApp>
    <dl className="mb-6 space-y-3 rounded-[10px] border-[3px] border-barter-line p-4 text-center text-sm lg:text-left">
      <div><dt className="font-bold text-barter-gray">Email</dt><dd className="break-all">{user.email}</dd></div>
      <div><dt className="font-bold text-barter-gray">Phone number</dt><dd>{user.phoneNumber}</dd></div>
    </dl>
    <ProfileForm firstName={user.firstName ?? ""} lastName={user.lastName ?? ""} />
    <div className="mt-6 border-t-[3px] border-barter-line pt-6"><LogoutButton /></div>
  </AuthShell>;
}
