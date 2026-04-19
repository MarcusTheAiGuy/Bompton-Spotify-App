export function CollapsibleSection({
  eyebrow,
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-lg border border-spotify-border bg-spotify-elevated/40 open:bg-spotify-elevated/20"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 transition hover:bg-spotify-highlight/40">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs uppercase tracking-widest text-spotify-subtext">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="truncate text-2xl font-extrabold tracking-tight">
            {title}
          </h2>
          {subtitle ? (
            <p className="text-sm text-spotify-subtext">{subtitle}</p>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className="flex shrink-0 items-center gap-2 rounded-full border border-spotify-border bg-spotify-base px-3 py-1 text-xs font-bold uppercase tracking-widest text-spotify-subtext group-open:bg-spotify-green group-open:text-black"
        >
          <span className="group-open:hidden">Show</span>
          <span className="hidden group-open:inline">Hide</span>
          <Chevron />
        </span>
      </summary>
      <div className="flex flex-col gap-6 px-4 pb-6 pt-2">{children}</div>
    </details>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3 transition-transform group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
