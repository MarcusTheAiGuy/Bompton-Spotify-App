"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WrappedGuess, WrappedItem } from "@/lib/wrapped-guess";
import { SpotifyErrorBanner } from "@/components/spotify/section-header";

// A story of full-bleed slides in the style of Spotify Wrapped. Each slide
// advances by itself when its bar at the top fills; tap the right of the
// card to skip ahead, the left to go back, and hold to pause.

type Tone = "dark" | "light";
type Slide = { id: string; background: string; tone: Tone; content: ReactNode };

const HOLD_MS = 300;

export function WrappedStory({
  guess,
  name,
  isSelf,
  dashboardHref,
}: {
  guess: WrappedGuess;
  name: string;
  isSelf: boolean;
  dashboardHref: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const pressedAt = useRef(0);
  const held = useRef(false);

  const hasData =
    guess.topTracks.length > 0 ||
    guess.topArtists.length > 0 ||
    guess.minutes !== null;
  const slides = buildSlides(guess, name, isSelf, hasData, dashboardHref, () =>
    setIndex(0),
  );
  const last = slides.length - 1;
  const slide = slides[Math.min(index, last)];
  const go = (delta: number) =>
    setIndex((i) => Math.min(last, Math.max(0, i + delta)));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setIndex((i) => Math.min(last, i + 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  const press = {
    onPointerDown: () => {
      // A long press the browser swallowed (no click) must not eat the
      // next tap, so every press starts out as a tap.
      held.current = false;
      pressedAt.current = Date.now();
      setPaused(true);
    },
    onPointerUp: () => {
      held.current = Date.now() - pressedAt.current > HOLD_MS;
      setPaused(false);
    },
    onPointerLeave: () => setPaused(false),
    onPointerCancel: () => setPaused(false),
  };
  // A press held long enough to pause is not also a tap.
  const tap = (delta: number) => () => {
    if (held.current) {
      held.current = false;
      return;
    }
    go(delta);
  };

  const track = slide.tone === "dark" ? "bg-black/20" : "bg-white/30";
  const fill = slide.tone === "dark" ? "bg-black/80" : "bg-white";

  // Layers, bottom to top: the tap zones, the shapes, the slide (which
  // lets taps through except on its own links and buttons), then the
  // progress bars and the close button.
  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-4">
      <StoryFrame
        className={`select-none [-webkit-touch-callout:none] ${slide.background} ${slide.tone === "dark" ? "text-black" : "text-white"}`}
      >
        <button
          type="button"
          aria-label="Previous slide"
          className="absolute inset-y-0 left-0 w-1/3 cursor-w-resize focus:outline-none"
          onClick={tap(-1)}
          {...press}
        />
        <button
          type="button"
          aria-label="Next slide"
          className="absolute inset-y-0 right-0 w-2/3 cursor-e-resize focus:outline-none"
          onClick={tap(1)}
          {...press}
        />

        <Shapes variant={index} tone={slide.tone} />

        {/* The live region stays mounted so each new slide is announced. */}
        <div aria-live="polite" className="pointer-events-none relative h-full">
          <div key={slide.id} className="flex h-full flex-col px-7 pb-8 pt-14">
            {slide.content}
          </div>
        </div>

        <div className="absolute inset-x-3 top-3 z-10 flex gap-1" aria-hidden>
          {slides.map((s, i) => (
            <div
              key={s.id}
              className={`h-1 flex-1 overflow-hidden rounded-full ${track}`}
            >
              {i < index ? <div className={`h-full w-full ${fill}`} /> : null}
              {i === index ? (
                <div
                  className={`h-full w-full origin-left animate-wrapped-fill ${fill}`}
                  style={{ animationPlayState: paused ? "paused" : "running" }}
                  onAnimationEnd={() => go(1)}
                />
              ) : null}
            </div>
          ))}
        </div>

        <Link
          href={dashboardHref}
          aria-label="Close and go back to the dashboard"
          className="absolute right-3 top-6 z-10 flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none opacity-80 transition hover:opacity-100"
        >
          ×
        </Link>
      </StoryFrame>
      {guess.basis.liveError ? (
        <SpotifyErrorBanner
          title={`Couldn't pull fresh top lists from Spotify, so this guess uses stored data only. ${guess.basis.liveError.title}.`}
          detail={guess.basis.liveError.detail}
        />
      ) : null}
      {guess.basis.notes.length > 0 ? (
        <SpotifyErrorBanner
          tone="muted"
          title="Parts of this guess are missing"
          detail={guess.basis.notes.join("\n\n")}
        />
      ) : null}
    </div>
  );
}

// The phone-sized card the story plays in; the loading screen uses it too.
export function StoryFrame({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative mx-auto h-[calc(100dvh-8rem)] max-h-[760px] min-h-[540px] w-full max-w-[420px] overflow-hidden rounded-3xl shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

function buildSlides(
  guess: WrappedGuess,
  name: string,
  isSelf: boolean,
  hasData: boolean,
  dashboardHref: string,
  restart: () => void,
): Slide[] {
  const your = isSelf ? "Your" : `${name}'s`;
  const yours = isSelf ? "your" : `${name}'s`;
  const you = isSelf ? "you" : name;
  const notPlayed = `Top of ${yours} charts on the days we looked.`;
  const { topTracks, topArtists, topGenres, minutes, year } = guess;
  const slides: Slide[] = [];

  slides.push({
    id: "intro",
    background: "bg-[#1ED760]",
    tone: "dark",
    content: (
      <div className="my-auto flex flex-col gap-4">
        <Rise>
          <p className="text-sm font-bold uppercase tracking-[0.2em]">
            Bompton guesses
          </p>
        </Rise>
        <Rise delay={150}>
          <h1 className="text-6xl font-black leading-[0.9] tracking-tighter">
            {your}
            <br />
            {year}
            <br />
            Wrapped
          </h1>
        </Rise>
        <Rise delay={300}>
          <p className="text-lg font-semibold">
            Our best guess at what Spotify will show {you}, before it does.
          </p>
        </Rise>
        <Rise delay={450}>
          <p className="text-sm font-semibold opacity-70">Tap to start →</p>
        </Rise>
      </div>
    ),
  });

  if (!hasData) {
    slides.push({
      id: "empty",
      background: "bg-[#121212]",
      tone: "light",
      content: (
        <div className="my-auto flex flex-col gap-4">
          <Rise>
            <h2 className="text-4xl font-black tracking-tight">
              Not enough to go on yet
            </h2>
          </Rise>
          <Rise delay={150}>
            <p className="text-base text-white/80">
              We guess from the daily snapshots of {yours} top tracks and
              artists and the plays we catch, and there are none from {year}{" "}
              yet. Open {yours} dashboard (sign in again if it asks), then come
              back tomorrow.
            </p>
          </Rise>
          <Rise delay={300} className="self-start">
            <Link
              href={dashboardHref}
              className="btn-spotify pointer-events-auto normal-case tracking-normal"
            >
              Back to the dashboard
            </Link>
          </Rise>
        </div>
      ),
    });
    return slides;
  }

  if (minutes) {
    slides.push({
      id: "minutes",
      background: "bg-[#F573A0]",
      tone: "dark",
      content: (
        <div className="my-auto flex flex-col gap-3">
          <Rise>
            <p className="text-xl font-bold">
              {minutes.extrapolated
                ? `This year ${you} listened for about`
                : `Since ${minutes.trackedSince} ${you} listened for at least`}
            </p>
          </Rise>
          <Rise delay={200}>
            <p className="break-words text-7xl font-black leading-none tracking-tighter">
              {minutes.estimate.toLocaleString("en-US")}
            </p>
          </Rise>
          <Rise delay={300}>
            <p className="text-3xl font-black tracking-tight">minutes</p>
          </Rise>
          <Rise delay={500}>
            <p className="mt-4 text-sm font-semibold opacity-80">
              {minutes.extrapolated
                ? `A guess: we caught ${plural(minutes.caught, "minute")} of plays since ${minutes.trackedSince} and kept that pace for the whole year.`
                : `Counted from the ${plural(guess.basis.playsCaught, "play")} we caught since ${minutes.trackedSince}.`}{" "}
              Spotify only shows us the last 50 plays at a time, so the real
              number is probably higher.
            </p>
          </Rise>
        </div>
      ),
    });
  }

  if (topGenres.length > 0) {
    slides.push({
      id: "genres",
      background: "bg-[#6B4EFF]",
      tone: "light",
      content: (
        <div className="my-auto flex flex-col gap-5">
          <Rise>
            <p className="text-xl font-bold">{your} top genres</p>
          </Rise>
          <ol className="flex flex-col gap-2">
            {topGenres.map((genre, i) => (
              <Rise
                key={genre}
                as="li"
                delay={150 + i * 120}
                className="flex items-baseline gap-3 text-3xl font-black tracking-tight"
              >
                <span className="w-8 shrink-0 text-xl opacity-70">{i + 1}</span>
                <span className="min-w-0 break-words">{genre}</span>
              </Rise>
            ))}
          </ol>
          <Rise delay={900}>
            <p className="text-sm font-semibold opacity-80">
              From the Last.fm tags on {yours} top artists.
            </p>
          </Rise>
        </div>
      ),
    });
  }

  const [topArtist] = topArtists;
  if (topArtist) {
    slides.push({
      id: "top-artist",
      background: "bg-[#FF6437]",
      tone: "dark",
      content: (
        <div className="my-auto flex flex-col gap-4">
          <Rise>
            <p className="text-xl font-bold">{your} top artist</p>
          </Rise>
          <Rise delay={150}>
            <Art
              item={topArtist}
              round
              className="mx-auto h-48 w-48 shadow-card"
            />
          </Rise>
          <Rise delay={350}>
            <h2 className="break-words text-5xl font-black leading-none tracking-tighter">
              {topArtist.name}
            </h2>
          </Rise>
          <Rise delay={500}>
            <p className="text-sm font-semibold opacity-80">
              {topArtist.plays > 0
                ? `We caught ${plural(topArtist.plays, "play")} of them this year, ${plural(topArtist.minutes ?? 0, "minute")} in all.`
                : notPlayed}
            </p>
          </Rise>
        </div>
      ),
    });
    if (topArtists.length > 1) {
      slides.push({
        id: "top-artists",
        background: "bg-[#2D46B9]",
        tone: "light",
        content: (
          <TopList title={`${your} top artists`} items={topArtists} round />
        ),
      });
    }
  }

  const [topTrack] = topTracks;
  if (topTrack) {
    slides.push({
      id: "top-song",
      background: "bg-[#CDF564]",
      tone: "dark",
      content: (
        <div className="my-auto flex flex-col gap-4">
          <Rise>
            <p className="text-xl font-bold">{your} top song</p>
          </Rise>
          <Rise delay={150}>
            <Art item={topTrack} className="mx-auto h-52 w-52 shadow-card" />
          </Rise>
          <Rise delay={350}>
            <h2 className="break-words text-4xl font-black leading-none tracking-tighter">
              {topTrack.name}
            </h2>
            {topTrack.subtitle ? (
              <p className="mt-2 text-lg font-bold opacity-80">
                {topTrack.subtitle}
              </p>
            ) : null}
          </Rise>
          <Rise delay={500}>
            <p className="text-sm font-semibold opacity-80">
              {topTrack.plays > 0
                ? `Played at least ${plural(topTrack.plays, "time")} this year.`
                : notPlayed}
            </p>
          </Rise>
        </div>
      ),
    });
    if (topTracks.length > 1) {
      slides.push({
        id: "top-songs",
        background: "bg-[#E91429]",
        tone: "light",
        content: <TopList title={`${your} top songs`} items={topTracks} />,
      });
    }
  }

  slides.push({
    id: "summary",
    background: "bg-[#121212]",
    tone: "light",
    content: (
      <Summary
        guess={guess}
        title={`${your} ${year} Wrapped, guessed`}
        dashboardHref={dashboardHref}
        restart={restart}
      />
    ),
  });

  return slides;
}

function Summary({
  guess,
  title,
  dashboardHref,
  restart,
}: {
  guess: WrappedGuess;
  title: string;
  dashboardHref: string;
  restart: () => void;
}) {
  const { topTracks, topArtists, topGenres, minutes, basis } = guess;
  const sources = [
    basis.snapshotDays > 0
      ? `${plural(basis.snapshotDays, "day")} of top-50 snapshots${basis.firstSnapshotDay ? ` since ${basis.firstSnapshotDay}` : ""}`
      : null,
    basis.playsCaught > 0
      ? `${plural(basis.playsCaught, "play")} caught this year`
      : null,
  ].filter(Boolean);

  return (
    <div className="flex h-full flex-col gap-4">
      <Rise>
        <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-[#1ED760] via-[#6B4EFF] to-[#F573A0] p-3">
          {topArtists[0] ? (
            <Art
              item={topArtists[0]}
              className="h-16 w-16 shrink-0 shadow-card"
            />
          ) : null}
          <p className="text-lg font-black leading-tight tracking-tight text-black">
            {title}
          </p>
        </div>
      </Rise>
      <Rise delay={150}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
          <SummaryList heading="Top artists" items={topArtists} />
          <SummaryList heading="Top songs" items={topTracks} />
          {minutes ? (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-white/60">
                Minutes listened
              </p>
              <p className="text-2xl font-black">
                {minutes.estimate.toLocaleString("en-US")}
              </p>
            </div>
          ) : null}
          {topGenres[0] ? (
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest text-white/60">
                Top genre
              </p>
              <p className="truncate text-2xl font-black">{topGenres[0]}</p>
            </div>
          ) : null}
        </div>
      </Rise>
      <Rise delay={300} className="mt-auto flex flex-col gap-3">
        <p className="text-xs text-white/60">
          {sources.length > 0
            ? `Guessed from ${sources.join(" and ")}`
            : "Guessed"}
          {basis.livePulled > 0
            ? ", plus a fresh pull from Spotify just now"
            : ""}
          . The real Wrapped counts every stream since 1 January.
        </p>
        <div className="pointer-events-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={restart}
            className="btn-spotify px-5 py-2 normal-case tracking-normal"
          >
            Watch again
          </button>
          <Link href={dashboardHref} className="btn-ghost">
            Back to the dashboard
          </Link>
        </div>
      </Rise>
    </div>
  );
}

function SummaryList({
  heading,
  items,
}: {
  heading: string;
  items: WrappedItem[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase tracking-widest text-white/60">
        {heading}
      </p>
      <ol className="mt-1 flex flex-col gap-0.5">
        {items.map((item, i) => (
          <li key={`${item.name}-${i}`} className="flex gap-2 font-bold">
            <span className="w-3 shrink-0 text-white/60">{i + 1}</span>
            <span className="truncate">{item.name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TopList({
  title,
  items,
  round = false,
}: {
  title: string;
  items: WrappedItem[];
  round?: boolean;
}) {
  return (
    <div className="my-auto flex flex-col gap-5">
      <Rise>
        <p className="text-2xl font-black tracking-tight">{title}</p>
      </Rise>
      <ol className="flex flex-col gap-3">
        {items.map((item, i) => (
          <Rise
            key={`${item.name}-${i}`}
            as="li"
            delay={150 + i * 120}
            className="flex items-center gap-3"
          >
            <span className="w-6 shrink-0 text-2xl font-black">{i + 1}</span>
            <Art item={item} round={round} className="h-14 w-14 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate text-lg font-black leading-tight">
                {item.name}
              </span>
              {item.subtitle ? (
                <span className="block truncate text-sm font-semibold opacity-80">
                  {item.subtitle}
                </span>
              ) : null}
            </span>
          </Rise>
        ))}
      </ol>
    </div>
  );
}

function Art({
  item,
  round = false,
  className = "",
}: {
  item: WrappedItem;
  round?: boolean;
  className?: string;
}) {
  const shape = round ? "rounded-full" : "rounded-md";
  if (item.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.imageUrl}
        alt=""
        className={`${shape} bg-black/20 object-cover ${className}`}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`${shape} flex items-center justify-center bg-gradient-to-br from-black/40 to-black/10 text-3xl font-black text-white ${className}`}
    >
      {item.name.charAt(0).toUpperCase()}
    </div>
  );
}

// Fades its content up into place.
function Rise({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li";
}) {
  return (
    <Tag
      className={`animate-wrapped-rise motion-reduce:animate-none ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

// Big soft shapes behind the text, moved around a little on each slide.
function Shapes({ variant, tone }: { variant: number; tone: Tone }) {
  const color = tone === "dark" ? "bg-black/10" : "bg-white/10";
  const layouts = [
    [
      "-right-20 -top-16 h-64 w-64 rounded-full",
      "-bottom-24 -left-16 h-72 w-72 rotate-12 rounded-[4rem]",
    ],
    [
      "-left-24 top-10 h-60 w-60 rotate-45 rounded-[3rem]",
      "-bottom-20 -right-10 h-64 w-64 rounded-full",
    ],
    [
      "-right-16 bottom-24 h-56 w-56 rounded-full",
      "-left-20 -top-20 h-64 w-64 rotate-[20deg] rounded-[4rem]",
    ],
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {layouts[variant % layouts.length].map((shape) => (
        <div key={shape} className={`absolute ${color} ${shape}`} />
      ))}
    </div>
  );
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;
}
