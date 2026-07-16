import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  Show,
  UserButton,
} from "@clerk/nextjs";
import "./globals.css";
import Image from "next/image";
import { Nav } from "./nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SpotMe",
  description: "Find the right gym buddies.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
        <body className="min-h-full flex flex-col pb-24">
          <header className="border-b border-ink/10 bg-cream">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
              <a href="/" className="flex items-center gap-2">
                <Image
                  src="/spotme-logo.png"
                  alt="SpotMe"
                  width={1154}
                  height={264}
                  className="h-8 w-auto"
                  priority
                />
              </a>
              <div className="flex items-center gap-3">
                <Show when="signed-out">
                  <SignInButton>
                    <button className="text-sm font-medium text-ink hover:text-flame">
                      Sign in
                    </button>
                  </SignInButton>
                  <SignUpButton>
                    <button className="bg-flame px-4 py-2 text-sm font-semibold text-cream hover:opacity-90">
                      Sign up
                    </button>
                  </SignUpButton>
                </Show>
                <Show when="signed-in">
                  <UserButton />
                </Show>
              </div>
            </div>
          </header>
          {children}
          <Show when="signed-in">
            <Nav />
          </Show>
        </body>
      </html>
    </ClerkProvider>
  );
}