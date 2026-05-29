import Link from "next/link";
import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SignUpButton } from "@clerk/nextjs";

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  const features = [
    { title: "Find your match", body: "Filter by gym, experience, and goals to find compatible partners." },
    { title: "Chat & schedule", body: "Message your matches and plan workouts together." },
    { title: "Track progress", body: "Log your lifts and watch your numbers climb over time." },
  ];

  return (
    <main className="mx-auto max-w-5xl px-4">
      {/* Tagline */}
      <section className="py-20 text-center">
        <Image
          src="/spotme-logo.png"
          alt="SpotMe"
          width={1154}
          height={264}
          className="mx-auto h-16 w-auto"
          priority
        />
        <p className="mt-6 text-2xl font-semibold text-ink">
          Find the right buddies - to learn from, to lift with.
        </p>
        <p className="mx-auto mt-4 max-w-xl text-ink/70">
          Only 2.36% of the world has a gym membership. We're building for
          everyone else - the beginners who find the gym intimidating, and the
          regulars looking for someone to train with.
        </p>
        <div className="mt-8">
          <SignUpButton>
            <button className="bg-flame px-8 py-3 text-lg font-semibold text-cream hover:opacity-90">
              Get started
            </button>
          </SignUpButton>
        </div>
      </section>

      {/* Features */}
      <section className="grid gap-6 pb-20 md:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-lg border border-ink/10 bg-white p-6">
            <h3 className="text-lg font-bold text-flame">{f.title}</h3>
            <p className="mt-2 text-sm text-ink/70">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}