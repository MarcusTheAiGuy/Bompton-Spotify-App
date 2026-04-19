export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="text-xs uppercase tracking-widest text-spotify-subtext">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
        {subtitle ? (
          <p className="text-sm text-spotify-subtext">{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function SpotifyErrorBanner({
  title,
  detail,
  tone = "error",
}: {
  title: string;
  detail: string;
  tone?: "error" | "muted";
}) {
  const wrapper =
    tone === "muted"
      ? "rounded-lg border border-spotify-border bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext"
      : "rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200";
  const detailCls =
    tone === "muted"
      ? "mt-1 whitespace-pre-wrap font-mono text-xs opacity-80"
      : "mt-1 whitespace-pre-wrap font-mono text-xs text-red-300/80";
  return (
    <div role={tone === "muted" ? "status" : "alert"} className={wrapper}>
      <p className="font-semibold">{title}</p>
      <p className={detailCls}>{detail}</p>
    </div>
  );
}
