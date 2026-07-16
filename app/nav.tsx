"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function MatchIcon() {
  return (
    <svg viewBox="0 0 21 21" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <g transform="translate(1.5 3)">
        <path d="m5.5.5h6c1.1045695 0 2 .8954305 2 2v10c0 1.1045695-.8954305 2-2 2h-6c-1.1045695 0-2-.8954305-2-2v-10c0-1.1045695.8954305-2 2-2zm8 2.5h1c1.1045695 0 2 .8954305 2 2v5c0 1.1045695-.8954305 2-2 2h-1z" />
        <path d="m.5 3h1c1.1045695 0 2 .8954305 2 2v5c0 1.1045695-.8954305 2-2 2h-1z" transform="matrix(-1 0 0 1 4 0)" />
      </g>
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 21 21" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="m8 13.5172414c4.418278 0 8-3.2845583 8-7.0172414 0-3.73268314-3.581722-6.5-8-6.5s-8 3.02593755-8 6.75862069c0 1.45741942.5460328 2.80709561 1.47469581 3.91098161l-.97469581 4.5803977 3.91607376-2.4472652c1.07810761.4571647 2.29544433.7145066 3.58392624.7145066z" transform="translate(2.25 3)" />
    </svg>
  );
}

function TrackIcon() {
  return (
    <svg viewBox="0 0 21 21" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <g transform="translate(2.5 3)">
        <path d="m.5.5v11c0 1.1045695.8954305 2 2 2h11" />
        <path d="m2.5 9.5 3-3 2 2 5-5" />
        <path d="m12.5 6.5v-3h-3" />
      </g>
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 21 21" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="m7.5.5c1.65685425 0 3 1.34314575 3 3v2c0 1.65685425-1.34314575 3-3 3s-3-1.34314575-3-3v-2c0-1.65685425 1.34314575-3 3-3zm7 14v-.7281753c0-3.1864098-3.6862915-5.2718247-7-5.2718247s-7 2.0854149-7 5.2718247v.7281753c0 .5522847.44771525 1 1 1h12c.5522847 0 1-.4477153 1-1z" transform="translate(2.5 2)" />
    </svg>
  );
}

const TABS = [
  { href: "/match", label: "Match", Icon: MatchIcon },
  { href: "/messages", label: "Chat", Icon: ChatIcon },
  { href: "/progress", label: "Track", Icon: TrackIcon },
  { href: "/profile", label: "Profile", Icon: ProfileIcon },
];

export function Nav() {
  const pathname = usePathname();

  // Hide inside a chatroom - it's a focused sub-view with its own back link.
  if (pathname.startsWith("/messages/")) return null;

  return (
    <nav className="fixed inset-x-0 bottom-4 z-40 px-4">
      <div className="mx-auto flex max-w-md items-center justify-around gap-1 rounded-2xl border border-ink/10 bg-cream/95 p-2 shadow-lg backdrop-blur">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium ${
                active ? "bg-flame/10 text-flame" : "text-ink/60 hover:text-ink"
              }`}
            >
              <Icon />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}