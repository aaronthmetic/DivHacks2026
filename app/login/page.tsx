import { AuthForm } from "@/components/auth/forms";
import { AuthShell } from "@/components/auth/shell";
import { googleEnabled } from "@/lib/auth";
import { redirectIfSignedIn } from "@/lib/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await redirectIfSignedIn();
  const params = await searchParams;
  return <AuthShell title="Welcome back" description="Log in with your email or phone number and password, or continue with Google.">
    <AuthForm mode="login" googleEnabled={googleEnabled()} oauthError={Boolean(params.error)} />
  </AuthShell>;
}
