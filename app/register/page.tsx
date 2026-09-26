import { AuthForm } from "@/components/auth/forms";
import { AuthShell } from "@/components/auth/shell";
import { googleEnabled } from "@/lib/auth";
import { redirectIfSignedIn } from "@/lib/session";

export default async function RegisterPage() {
  await redirectIfSignedIn();
  return <AuthShell title="Create an account">
    <AuthForm mode="register" googleEnabled={googleEnabled()} />
  </AuthShell>;
}
