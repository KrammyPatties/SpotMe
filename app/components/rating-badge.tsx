import type { RatingAggregate } from "@/lib/ratings";

type Props = {
  aggregate: RatingAggregate;
  size?: "sm" | "md";
};

export default function RatingBadge({ aggregate, size = "md" }: Props) {
  const textClass = size === "sm" ? "text-xs" : "text-sm";
  const starClass = size === "sm" ? "text-sm" : "text-base";

  if (aggregate.count === 0) {
    return (
      <span className={`${textClass} text-ink/50`}>No ratings yet</span>
    );
  }

  // Display the RAW mean, not the shrunk average. At a 4.5 prior the shrunk
  // number over-claims (a single 1-star would display as 3.3), and the session
  // count already tells the reader how much the number rests on. Shrinkage
  // belongs in ranking, not in what we show people.
  const shown = (aggregate.mean ?? 0).toFixed(1);
  const filled = Math.round(aggregate.mean ?? 0);

  return (
    <span className={`inline-flex items-center gap-1 ${textClass} text-ink`}>
      <span className={starClass} style={{ color: "#f95311" }} aria-hidden="true">
        {"★".repeat(filled)}
        <span style={{ color: "#c9c2b8" }}>{"★".repeat(5 - filled)}</span>
      </span>
      <span className="font-medium">{shown}</span>
      <span className="text-ink/50">
        from {aggregate.count} {aggregate.count === 1 ? "session" : "sessions"}
      </span>
    </span>
  );
}
