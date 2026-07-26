import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { isUuid } from "@/lib/uuid";
import { validateReportResolution } from "@/lib/moderation";

const MAX_NOTE_LENGTH = 1000;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { decision, note } = (body ?? {}) as {
    decision?: unknown;
    note?: unknown;
  };

  let resolutionNote: string | null = null;
  if (note !== undefined && note !== null) {
    if (typeof note !== "string") {
      return NextResponse.json({ error: "note must be a string" }, { status: 400 });
    }
    const trimmed = note.trim();
    if (trimmed.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { error: `note must be at most ${MAX_NOTE_LENGTH} characters` },
        { status: 400 }
      );
    }
    resolutionNote = trimmed.length ? trimmed : null;
  }

  const { data: report, error: fetchError } = await supabaseAdmin
    .from("reports")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    console.error("report fetch failed:", fetchError);
    return NextResponse.json({ error: "Failed to resolve" }, { status: 500 });
  }
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const validated = validateReportResolution(report.status, decision);
  if (!validated.ok) {
    const status = report.status === "open" ? 400 : 409;
    return NextResponse.json({ error: validated.error }, { status });
  }

  const { data, error } = await supabaseAdmin
    .from("reports")
    .update({
      status: validated.value,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
      resolution_note: resolutionNote,
    })
    .eq("id", id)
    .eq("status", "open")
    .select()
    .maybeSingle();

  if (error) {
    console.error("report update failed:", error);
    return NextResponse.json({ error: "Failed to resolve" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Report is no longer open" },
      { status: 409 }
    );
  }

  return NextResponse.json({ report: data }, { status: 200 });
}