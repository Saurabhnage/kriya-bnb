import { readIntel, marketEnabled, refreshIfStale } from "@/lib/server/market/engine";
import { cmcEnabled, readCmcCalls } from "@/lib/server/market/cmc";
import { atlasFeeds } from "@/lib/server/market/atlas";
import { latestAssessment, readCournotProofs } from "@/lib/server/market/cournot";
import { memoryMode } from "@/lib/server/memory";
import { fail, json } from "@/lib/server/http";
import { publicClient } from "@/lib/server/chain";
import { KriyaExecutorAbi } from "@/lib/generated/abis";
import { deployment } from "@/lib/config";

/** The executor's onchain Atlas peg guard, read live from BNB Chain (null when not configured). */
async function readPegGuard() {
  const e = { address: deployment.executor, abi: KriyaExecutorAbi } as const;
  const [status, feed, maxDepegBps, maxFeedAge] = await Promise.all([
    publicClient.readContract({ ...e, functionName: "pegStatus" }),
    publicClient.readContract({ ...e, functionName: "pegFeed" }),
    publicClient.readContract({ ...e, functionName: "maxDepegBps" }),
    publicClient.readContract({ ...e, functionName: "maxFeedAge" }),
  ]);
  const [enabled, price, decimals, updatedAt, depegBps, stale, frozen] = status;
  if (!enabled) return null;
  return { feed, price: Number(price) / 10 ** decimals, updatedAt: Number(updatedAt) * 1000, depegBps, maxDepegBps, maxFeedAge, stale, frozen };
}

export const dynamic = "force-dynamic";

// Market intelligence for the dashboard, plus verifiable usage evidence for judges
// (CoinMarketCap call log, Atlas feed addresses, Cournot proofs). Secrets are never included.
export async function GET() {
  try {
    const [intel, cmcCalls, cournot, proofs, pegGuard] = await Promise.all([
      // first visit on a fresh deployment: pull live data once instead of showing an empty panel
      readIntel().then((i) => i ?? (marketEnabled() ? refreshIfStale() : null)),
      readCmcCalls(),
      latestAssessment(),
      readCournotProofs(),
      readPegGuard().catch(() => null),
    ]);
    return json({
      enabled: {
        market: marketEnabled(),
        coinmarketcap: cmcEnabled(),
        atlasFeeds: atlasFeeds(),
        cournot: process.env.COURNOT_API_KEY ? "prepaid key" : "free quota (3 calls per IP)",
        memory: memoryMode(),
        llm: process.env.KRIYA_LLM !== "off",
      },
      intel,
      cournot,
      pegGuard,
      evidence: {
        cmcCalls: cmcCalls.slice(-10).reverse(),
        cournotProofs: proofs.slice(-5).reverse().map((p) => ({ id: p.id, endpoint: p.endpoint, status: p.status, requestId: p.requestId, ts: p.ts })),
      },
    });
  } catch (err) {
    return fail(err, 400);
  }
}
