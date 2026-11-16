// src/app/safety/training/[block]/page.tsx  →  /v2/safety/training/:block  (saf-02)
// Server shell for one training block: unknown or not-ready block id → 404. The completion card's name comes from
// the middleware's X-User-Name (the API records the same session identity). Gated on `safety` (middleware, saf-01).
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import PlatformHeader from "@/components/PlatformHeader";
import TrainingBlock from "@/components/safety/TrainingBlock";
import { getBlock } from "@/lib/safety/trainingBlocks";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Safety training — v2",
};

export default async function TrainingBlockPage({ params }: { params: { block: string } }) {
  const block = getBlock(params.block);
  if (!block || !block.ready) notFound();

  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <PlatformHeader
        userName={userName}
        isAdmin={session?.isAdministrator ?? false}
        permissions={session?.permissions ?? {}}
        currentPath="/v2/safety"
        title="Safety · v2"
      />
      <TrainingBlock blockId={block.id} userName={userName} />
    </div>
  );
}
