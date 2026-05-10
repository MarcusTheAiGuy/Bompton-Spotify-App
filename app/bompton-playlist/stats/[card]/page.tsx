import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadBomptonDataFromDb } from "@/lib/bompton-playlist-db";
import {
  buildBomptonStats,
  enrichTracks,
  flattenAllSeasons,
  getDedicationDetails,
  STATS_CARD_META,
  STATS_CARD_SLUGS,
  type StatsCardSlug,
} from "@/lib/bompton-stats";
import { getArtistGenresForIds } from "@/lib/artist-genres";
import type { CrewMember } from "@/lib/bompton";
import {
  GenreDetail,
  DedicationDetail,
  TopArtistsDetail,
  TopAlbumsDetail,
  OnTimeDetail,
  TimeOfDayDetail,
  DayOfWeekDetail,
  TrackLengthDetail,
  ExplicitDetail,
} from "@/components/bompton/stats-detail";

export const dynamic = "force-dynamic";

function isCardSlug(value: string): value is StatsCardSlug {
  return (STATS_CARD_SLUGS as readonly string[]).includes(value);
}

export default async function StatsCardDetailPage({
  params,
}: {
  params: Promise<{ card: string }>;
}) {
  const { card } = await params;
  if (!isCardSlug(card)) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [crewRecords, bomptonData] = await Promise.all([
    prisma.user.findMany({
      where: { accounts: { some: { provider: "spotify" } } },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        accounts: {
          where: { provider: "spotify" },
          select: { providerAccountId: true },
          take: 1,
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    loadBomptonDataFromDb(),
  ]);

  const crew: CrewMember[] = crewRecords.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    spotifyUserId: u.accounts[0]?.providerAccountId ?? null,
  }));

  const flat = flattenAllSeasons(bomptonData);
  const enriched = enrichTracks(flat, crew);
  const stats = await buildBomptonStats(bomptonData, crew, session.user.id);

  // Genres detail needs the resolved per-artist genre map (which the
  // bundle aggregates into top-3s but doesn't expose). The other cards
  // already have everything they need on the bundle + enriched tracks.
  const meta = STATS_CARD_META[card];

  let detailNode: React.ReactNode = null;
  if (card === "genres") {
    // Re-resolve the artist→genres map (the bundle aggregates this into
    // top-3 lists but doesn't expose the per-artist data the detail
    // page needs to render every artist + their tags).
    const artistIds = new Set<string>();
    for (const { track } of flat) {
      for (const a of track.track?.artists ?? []) {
        if (a?.id) artistIds.add(a.id);
      }
    }
    const lookup = await getArtistGenresForIds(
      session.user.id,
      [...artistIds],
    );
    detailNode = (
      <GenreDetail
        flat={flat}
        crew={crew}
        artistGenres={lookup.artists}
        artistTableMissing={lookup.tableMissing}
      />
    );
  } else if (card === "dedication") {
    const details = await getDedicationDetails(bomptonData, crew);
    detailNode = (
      <DedicationDetail
        plays={details.plays}
        tableMissing={details.tableMissing}
        crew={crew}
      />
    );
  } else if (card === "top-artists") {
    detailNode = <TopArtistsDetail enriched={enriched} crew={crew} />;
  } else if (card === "top-albums") {
    detailNode = <TopAlbumsDetail enriched={enriched} crew={crew} />;
  } else if (card === "on-time") {
    detailNode = (
      <OnTimeDetail
        onTime={stats.onTime}
        bomptonData={bomptonData}
        crew={crew}
      />
    );
  } else if (card === "time-of-day") {
    detailNode = <TimeOfDayDetail enriched={enriched} crew={crew} />;
  } else if (card === "day-of-week") {
    detailNode = <DayOfWeekDetail enriched={enriched} />;
  } else if (card === "track-length") {
    detailNode = <TrackLengthDetail enriched={enriched} />;
  } else if (card === "explicit") {
    detailNode = <ExplicitDetail enriched={enriched} crew={crew} />;
  }

  return (
    <section className="flex flex-col gap-8 py-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/bompton-playlist/stats"
          className="text-xs font-semibold uppercase tracking-widest text-spotify-subtext transition hover:text-spotify-text"
        >
          ← Back to deep stats
        </Link>
        <p className="text-xs uppercase tracking-widest text-spotify-subtext">
          {meta.subtitle}
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight">
          {meta.title}
        </h1>
        <p className="max-w-3xl text-sm text-spotify-subtext">{meta.blurb}</p>
      </header>

      {detailNode}
    </section>
  );
}
