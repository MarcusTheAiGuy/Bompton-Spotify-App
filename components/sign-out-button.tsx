import { signOut } from "@/auth";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button type="submit" className={className ?? "btn-ghost"}>
        Sign out
      </button>
    </form>
  );
}
