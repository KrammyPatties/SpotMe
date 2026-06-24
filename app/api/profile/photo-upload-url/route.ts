import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";

const BUCKET = "profile-photos";

export async function POST() {
  // Only a signed-in user can request an upload URL.
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Path is namespaced under the user's ID, so they can only ever upload
  // to their own folder. Fixed filename ("avatar") = one photo per user;
  // re-uploading overwrites.
  const path = `${userId}/avatar`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The client needs the path (to save later) and the signed token/url (to upload).
  return NextResponse.json({ path: data.path, token: data.token });
}