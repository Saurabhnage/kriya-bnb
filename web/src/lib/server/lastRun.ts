// Rebuild the most recent loop run for the pipeline view.
// Pure (no server-only imports) so it is unit-testable. Keeper runs persist their exact steps.
import type { LoopStep } from "../client";

export type RunView = { runId: string; source: "AGENT"; ts: number; steps: LoopStep[] };

export type RiskPoint = {
  ts: number;
  /** block number × 1e6 + log index: exact chain order, unlike timestamps */
  order: number;
  portfolioRisk: number | null;
  kind: "execution" | "risk-change";
  /** risk-change only: true when the verified risk went up */
  up?: boolean;
  label: string;
  txHash?: string;
};

export type JournalLike = {
  ts: number;
  kind: string;
  runId?: string;
  source?: "AGENT";
  title: string;
  detail?: string;
  txHash?: string;
  data?: unknown;
};

export function buildLastRun(journal: JournalLike[]): RunView | null {
  const keeper = [...journal].sort((a, b) => b.ts - a.ts).find((j) => j.kind === "run" && j.runId);
  return keeper
    ? { runId: keeper.runId!, source: "AGENT", ts: keeper.ts, steps: (keeper.data as { steps?: LoopStep[] } | undefined)?.steps ?? [] }
    : null;
}
