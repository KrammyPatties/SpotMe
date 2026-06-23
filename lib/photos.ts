import { supabaseAdmin } from "@/lib/supabase/server";

const BUCKET = "profile-photos";
const SIGNED_URL_TTL = 60 * 60; // 1 hour, in seconds

/**
 * Generate a signed, time-limited view URL for a stored photo path.
 * Returns null if the path is null/empty or signing fails (caller shows
 * the placeholder avatar instead).
 */
export async function getPhotoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);

  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Batch version: sign many photo paths at once (used by the match feed, where
 * many candidate photos are signed in a single call). Returns a Map of
 * path -> signed URL; paths that fail to sign are simply absent from the map.
 */
export async function getPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL);

  if (error || !data) return result;

  for (const item of data) {
    if (item.signedUrl && item.path) {
      result.set(item.path, item.signedUrl);
    }
  }
  return result;
}