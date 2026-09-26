import { AuthForm } from "@/components/auth/forms";
import { AuthShell } from "@/components/auth/shell";
import { googleEnabled } from "@/lib/auth";
import { redirectIfSignedIn } from "@/lib/session";

export default async function RegisterPage() {
  await redirectIfSignedIn();
  return <AuthShell title="Create your account" description="Enter your details to get started. All fields are required.">
    <AuthForm mode="register" googleEnabled={googleEnabled()} />
  </AuthShell>;
}
