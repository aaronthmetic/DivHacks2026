import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { getSessionCookie } from "better-auth/cookies";
import { SessionRefresh } from "@/components/auth/session-refresh";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// The monospace face of the auth screens (`font-mono`), loaded as a variable font.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "barter",
  description: "Find and exchange services near you.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Renew sessions on every signed-in page from one place. Only the cookie's presence is
  // checked here (no database access); the refresh request itself validates the session.
  const signedIn = Boolean(getSessionCookie(await headers()));
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{signedIn && <SessionRefresh />}{children}</body>
    </html>
  );
}
