import { notFound } from "next/navigation";
import { getDeveloperSession } from "@/lib/dev/access";
import { DevClient } from "./DevClient";

export const dynamic = "force-dynamic";

/** Developer tools. Only owner accounts listed in DEVELOPER_EMAILS; everyone else gets a 404. */
export default async function DevPage() {
  const session = await getDeveloperSession();
  if (!session) notFound();
  return <DevClient email={session.email} />;
}
