import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { displayCrewName } from "@/lib/spotify-user-names";
import { buildWrappedGuess } from "@/lib/wrapped-guess";
import {
  captureErrorDetail,
  isNextControlFlowError,
} from "@/lib/next-control-flow";
import { CrashCard } from "@/components/crash-card";
import { WrappedStory } from "@/components/wrapped/wrapped-story";

export const dynamic = "force-dynamic";
export const metadata = { title: "Guess Spotify Wrapped" };

export default async function WrappedPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/");

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) notFound();

    const guess = await buildWrappedGuess(user.id);
    return (
      <section className="-mt-6">
        <WrappedStory
          guess={guess}
          name={displayCrewName(user)}
          isSelf={session.user.id === user.id}
          dashboardHref={`/dashboard/${user.id}`}
        />
      </section>
    );
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    const detail = captureErrorDetail(error);
    console.error("[wrapped-guess.failed]", {
      userId,
      viewer: session.user.id,
      ...detail,
    });
    return (
      <section className="flex flex-col gap-6 py-6">
        <CrashCard
          title="Couldn't put the Wrapped guess together"
          subtitle="Caught while reading the listening archive (ListeningPlay / ListeningSnapshot) or pulling the current top lists from Spotify. Reload to retry; if it keeps failing, check the tables on /troubleshooting."
          detail={detail}
        />
      </section>
    );
  }
}
