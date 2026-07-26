export function parseAdminIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return parseAdminIds(process.env.ADMIN_CLERK_IDS).includes(userId);
}