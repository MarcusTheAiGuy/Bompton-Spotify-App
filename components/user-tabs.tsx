import Link from "next/link";

export type TabUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

export function UserTabs({
  users,
  activeUserId,
}: {
  users: TabUser[];
  activeUserId: string;
}) {
  return (
    <nav
      aria-label="Crew members"
      className="flex gap-2 overflow-x-auto border-b border-spotify-border pb-3"
    >
      {users.map((user) => {
        const active = user.id === activeUserId;
        const label = user.name ?? user.email ?? user.id;
        return (
          <Link
            key={user.id}
            href={`/dashboard/${user.id}`}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "flex items-center gap-2 whitespace-nowrap rounded-full bg-spotify-green px-4 py-2 text-sm font-bold text-black"
                : "flex items-center gap-2 whitespace-nowrap rounded-full border border-spotify-border bg-transparent px-4 py-2 text-sm font-semibold text-spotify-text transition hover:bg-spotify-highlight"
            }
          >
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt=""
                className="h-6 w-6 rounded-full object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className={
                  active
                    ? "flex h-6 w-6 items-center justify-center rounded-full bg-black/10 text-xs font-bold"
                    : "flex h-6 w-6 items-center justify-center rounded-full bg-spotify-highlight text-xs font-bold"
                }
              >
                {label.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
