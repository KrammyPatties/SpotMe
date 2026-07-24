export default function Avatar({
  url,
  name,
  size = 40,
}: {
  url: string | null;
  name: string;
  size?: number;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div
      className="shrink-0 rounded-full overflow-hidden bg-flame/15 flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          className="w-full h-full object-cover"
        />
      ) : (
        <span
          className="font-semibold text-flame"
          style={{ fontSize: size * 0.4 }}
        >
          {initial}
        </span>
      )}
    </div>
  );
}