import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { ThemeInit } from "@/components/theme-init";
import { getCurrentUser } from "@/lib/session";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Janis", template: "%s - Janis" },
  description: "Janis: canale telematico SDICoop per la fatturazione elettronica",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  return (
    <html
      lang="it"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <ThemeInit />
        <AppShell user={user ? { email: user.email, role: user.role, mustChangePassword: user.mustChangePassword } : null}>{children}</AppShell>
      </body>
    </html>
  );
}
