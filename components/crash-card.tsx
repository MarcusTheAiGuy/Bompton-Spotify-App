import type { CaughtErrorDetail } from "@/lib/next-control-flow";

export function CrashCard({
  title,
  subtitle,
  detail,
}: {
  title: string;
  subtitle?: string;
  detail: CaughtErrorDetail;
}) {
  return (
    <section className="card border border-red-500/40 bg-red-500/10 text-red-200">
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm">{subtitle}</p> : null}
      <dl className="mt-4 flex flex-col gap-2 text-sm">
        <Row label="Name" value={detail.name} mono />
        <Row label="Message" value={detail.message} mono wrap />
        {detail.digest ? (
          <Row label="Digest" value={detail.digest} mono />
        ) : null}
        {detail.stack ? (
          <div>
            <dt className="text-xs uppercase tracking-widest text-red-300/70">
              Stack
            </dt>
            <dd className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-3 font-mono text-xs">
              {detail.stack}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function Row({
  label,
  value,
  mono,
  wrap,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-red-300/70">
        {label}
      </dt>
      <dd
        className={[
          "mt-0.5",
          mono ? "font-mono" : "",
          wrap ? "whitespace-pre-wrap" : "",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}
