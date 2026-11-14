import { prisma } from "@/lib/prisma";
import type { CrewMember } from "@/lib/bompton";

// Where the crew lives. Timestamps are stored in UTC; convert with this
// before saying anything about a local date or hour.
export const CREW_TIME_ZONE = "America/Halifax";

// Every user with a linked Spotify account, oldest sign-up first.
export async function loadCrew(): Promise<CrewMember[]> {
  const users = await prisma.user.findMany({
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
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    spotifyUserId: u.accounts[0]?.providerAccountId ?? null,
  }));
}
