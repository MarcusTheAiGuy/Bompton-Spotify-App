import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadBomptonDataFromDb } from "@/lib/bompton-playlist-db";
import { buildBomptonStats } from "@/lib/bompton-stats";
import type { CrewMember } from "@/lib/bompton";
import { StatsCardGrid } from "@/components/bompton/stats-cards";

export const dynamic = "force-dynamic";

export default async function BomptonStatsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

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

  const stats = buildBomptonStats(bomptonData, crew);

  return (
    <section className="flex flex-col gap-8 py-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/bompton-playlist"
          className="text-xs font-semibold uppercase tracking-widest text-spotify-subtext transition hover:text-spotify-text"
        >
          ← Back to Bompton Playlist
        </Link>
        <p className="text-xs uppercase tracking-widest text-spotify-subtext">
          Deep stats
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight">
          Bompton, dissected
        </h1>
        <p className="max-w-3xl text-sm text-spotify-subtext">
          Nine breakdowns covering the four Bompton seasons. Numbers come
          from the same synced track data the main playlist page uses, so if
          a card says "no data yet," run the extension at{" "}
          <a
            href="/extension-setup"
            className="font-semibold text-spotify-green hover:underline"
          >
            /extension-setup
          </a>{" "}
          to backfill it.
        </p>
      </header>

      <StatsCardGrid stats={stats} />
    </section>
  );
}
