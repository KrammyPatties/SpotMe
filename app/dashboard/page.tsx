import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("display_name")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!profile) redirect("/onboarding");

  const tiles = [
    { href: "/match",    title: "Find a match", body: "Browse compatible gym partners." },
    { href: "/messages", title: "Messages",     body: "Chat with your matches." },
    { href: "/progress", title: "Progress",     body: "Log and track your lifts." },
    { href: "/profile",  title: "Profile",      body: "View and edit your details." },
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold">
        Welcome back, {profile.display_name}!
      </h1>
      <p className="mt-1 text-ink/70">What would you like to do today?</p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-lg border border-ink/10 bg-white p-6 transition hover:border-flame"
          >
            <h2 className="text-xl font-bold text-flame">{t.title}</h2>
            <p className="mt-2 text-sm text-ink/70">{t.body}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}