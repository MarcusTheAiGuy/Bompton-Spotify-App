import { prisma } from "@/lib/prisma";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

export class SpotifyError extends Error {
  constructor(
    message: string,
    public status: number,
    public path: string,
    public body: string,
  ) {
    super(message);
    this.name = "SpotifyError";
  }
}

export class SpotifyAccountMissingError extends Error {
  constructor(public userId: string) {
    super(
      `No Spotify account linked for user ${userId}. They need to sign in at least once.`,
    );
    this.name = "SpotifyAccountMissingError";
  }
}

export class SpotifyRefreshFailedError extends Error {
  constructor(
    public userId: string,
    public status: number,
    public body: string,
  ) {
    super(
      `Spotify token refresh failed for user ${userId} (HTTP ${status}): ${body}. They likely need to sign out and sign in again.`,
    );
    this.name = "SpotifyRefreshFailedError";
  }
}

async function getFreshAccessToken(userId: string): Promise<string> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "spotify" },
  });
  if (!account) throw new SpotifyAccountMissingError(userId);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = account.expires_at ?? 0;

  if (account.access_token && expiresAt > nowSeconds + 60) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    throw new SpotifyRefreshFailedError(
      userId,
      0,
      "No refresh_token stored on the Account row.",
    );
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new SpotifyRefreshFailedError(
      userId,
      0,
      "SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is not set on the server.",
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refresh_token,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: params,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new SpotifyRefreshFailedError(userId, response.status, text);
  }

  const data = JSON.parse(text) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
  };

  await prisma.account.update({
    where: { id: account.id },
    data: {
      access_token: data.access_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      refresh_token: data.refresh_token ?? account.refresh_token,
      scope: data.scope ?? account.scope,
      token_type: data.token_type ?? account.token_type,
    },
  });

  return data.access_token;
}

export async function spotifyFetch<T>(
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getFreshAccessToken(userId);
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!response.ok) {
    throw new SpotifyError(
      `Spotify API ${response.status} ${response.statusText} on ${path}`,
      response.status,
      path,
      text,
    );
  }

  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export type SpotifyImage = {
  url: string;
  height: number | null;
  width: number | null;
};

export type SpotifyProfile = {
  id: string;
  display_name: string | null;
  email: string;
  country: string;
  product: "premium" | "free" | "open";
  followers: { total: number; href: string | null };
  images: SpotifyImage[];
  external_urls: { spotify: string };
  uri: string;
  href: string;
  type: "user";
  explicit_content: { filter_enabled: boolean; filter_locked: boolean };
};

export async function getSpotifyProfile(userId: string): Promise<SpotifyProfile> {
  return spotifyFetch<SpotifyProfile>(userId, "/me");
}
