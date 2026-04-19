export type EnvVarStatus = {
  name: string;
  set: boolean;
  note?: string;
};

const REQUIRED_VARS: { name: string; aliases?: string[]; note?: string }[] = [
  { name: "SPOTIFY_CLIENT_ID" },
  { name: "SPOTIFY_CLIENT_SECRET" },
  {
    name: "NEXTAUTH_SECRET",
    aliases: ["AUTH_SECRET"],
    note: "Either NEXTAUTH_SECRET or AUTH_SECRET works.",
  },
  { name: "DATABASE_URL" },
  { name: "ALLOWED_EMAILS" },
];

export function checkRequiredEnv(): EnvVarStatus[] {
  return REQUIRED_VARS.map(({ name, aliases = [], note }) => {
    const candidates = [name, ...aliases];
    const set = candidates.some((k) => Boolean(process.env[k]?.trim()));
    return { name, set, note };
  });
}

export function missingRequiredEnv(): EnvVarStatus[] {
  return checkRequiredEnv().filter((v) => !v.set);
}
