import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function DashboardIndex() {
  const session = await auth();
  if (!session?.user) redirect("/");
  redirect(`/dashboard/${session.user.id}`);
}
