import { supabaseAdmin } from "@/lib/supabase/server";

export default async function GymsTestPage() {
  const { data: gyms, error } = await supabaseAdmin
    .from("gyms")
    .select("*")
    .order("name");

  if (error) {
    return <div style={{ padding: "2rem", color: "red" }}>Error: {error.message}</div>;
  }

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Gyms (connection test)</h1>
      <ul>
        {gyms?.map((g) => (
          <li key={g.id}>
            {g.name} — {g.outlet} ({g.region})
          </li>
        ))}
      </ul>
    </div>
  );
}