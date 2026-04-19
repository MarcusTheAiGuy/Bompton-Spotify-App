export type EnvVarStatus = {
  name: string;
  set: boolean;
  length: number;
  hasWhitespace: boolean;
  shapeOk: boolean;
  shapeNote?: string;
  preview?: string;
  note?: string;
};

type Spec = {
  name: string;
  aliases?: string[];
  note?: string;
  validate?: (value: string) => { ok: boolean; note?: string };
};

const REQUIRED_VARS: Spec[] = [
  {
    name: "SPOTIFY_CLIENT_ID",
    validate: (v) => ({
      ok: /^[0-9a-f]{32}$/i.test(v),
      note: "Expected 32 hex characters (Spotify dashboard client ID)",
    }),
  },
  {
    name: "SPOTIFY_CLIENT_SECRET",
    validate: (v) => ({
      ok: /^[0-9a-f]{32}$/i.test(v),
      note: "Expected 32 hex characters (Spotify dashboard client secret)",
    }),
  },
  {
    name: "NEXTAUTH_SECRET",
    aliases: ["AUTH_SECRET"],
    note: "Either NEXTAUTH_SECRET or AUTH_SECRET works.",
    validate: (v) => ({
      ok: v.length >= 32,
      note: "Expected at least 32 characters (`openssl rand -base64 32`)",
    }),
  },
  {
    name: "DATABASE_URL",
    validate: (v) => ({
      ok: /^postgres(ql)?:\/\//.test(v),
      note: "Expected to start with postgres:// or postgresql://",
    }),
  },
  {
    name: "ALLOWED_EMAILS",
    validate: (v) => ({
      ok: v.split(",").some((e) => /@/.test(e.trim())),
      note: "Expected one or more comma-separated email addresses",
    }),
  },
];

function previewValue(value: string): string {
  if (value.length <= 8) return `${value.length} chars`;
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

export function checkRequiredEnv(): EnvVarStatus[] {
  return REQUIRED_VARS.map(({ name, aliases = [], note, validate }) => {
    const candidates = [name, ...aliases];
    const rawHit = candidates
      .map((k) => ({ k, raw: process.env[k] }))
      .find((c) => c.raw !== undefined && c.raw !== "");
    const raw = rawHit?.raw;
    const set = raw !== undefined && raw.trim() !== "";
    const trimmed = raw?.trim() ?? "";
    const hasWhitespace = set && raw !== trimmed;
    const validation = validate && set ? validate(trimmed) : { ok: set };
    return {
      name,
      set,
      length: raw?.length ?? 0,
      hasWhitespace,
      shapeOk: validation.ok,
      shapeNote: validation.note,
      preview: set ? previewValue(trimmed) : undefined,
      note,
    };
  });
}

export function missingRequiredEnv(): EnvVarStatus[] {
  return checkRequiredEnv().filter((v) => !v.set);
}

export function unhealthyRequiredEnv(): EnvVarStatus[] {
  return checkRequiredEnv().filter(
    (v) => !v.set || !v.shapeOk || v.hasWhitespace,
  );
}
