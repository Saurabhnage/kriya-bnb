import "server-only";
import { parseAbi, parseAbiItem, type Address, type Log } from "viem";
import { LOG_RANGE, logsClient, publicClient } from "./chain";
import { deployment } from "../config";
import {
  KriyaExecutorAbi,
  KriyaMandateAbi,
  KriyaStrategyRegistryAbi,
  KriyaVaultAbi,
  MockUSDCAbi,
} from "../generated/abis";
import type { MandateParams, StrategyView } from "../policy";
import { readJournal, type JournalEntry } from "./store";
import type { RiskPoint } from "./lastRun";

export type Snapshot = {
  user: Address;
  strategies: StrategyView[];
  mandate: { exists: boolean; active: boolean; params: MandateParams; allowed: Address[]; createdAt: number };
  positions: { strategy: Address; amount: bigint }[];
  idle: bigint;
  total: bigint;
  highWaterMark: bigint;
  health: {
    totalValue: bigint;
    portfolioRisk: number;
    maxHeldRisk: number;
    maxExposureBps: number;
    reserveBps: number;
    allocated: boolean;
    violated: boolean;
  };
  walletUsdc: bigint;
  allowance: bigint;
  paused: boolean;
  executionCount: number;
  block: bigint;
};

export async function readStrategies(): Promise<StrategyView[]> {
  const [addrs, infos] = await publicClient.readContract({
    address: deployment.registry,
    abi: KriyaStrategyRegistryAbi,
    functionName: "getAll",
  });
  return addrs.map((address, i) => ({
    address,
    name: infos[i].name,
    apyBps: infos[i].apyBps,
    risk: infos[i].risk,
  }));
}

export async function readSnapshot(user: Address): Promise<Snapshot> {
  const v = { address: deployment.vault, abi: KriyaVaultAbi } as const;
  const e = { address: deployment.executor, abi: KriyaExecutorAbi } as const;
  const [strategies, m, pos, health, hwm, walletUsdc, allowance, paused, executionCount, block] = await Promise.all([
    readStrategies(),
    publicClient.readContract({ address: deployment.mandate, abi: KriyaMandateAbi, functionName: "getMandate", args: [user] }),
    publicClient.readContract({ ...v, functionName: "positionsOf", args: [user] }),
    publicClient.readContract({ ...e, functionName: "mandateHealth", args: [user] }),
    publicClient.readContract({ ...v, functionName: "highWaterMark", args: [user] }),
    publicClient.readContract({ address: deployment.usdc, abi: MockUSDCAbi, functionName: "balanceOf", args: [user] }),
    publicClient.readContract({
      address: deployment.usdc,
      abi: MockUSDCAbi,
      functionName: "allowance",
      args: [user, deployment.vault],
    }),
    publicClient.readContract({ ...e, functionName: "paused" }),
    publicClient.readContract({ ...e, functionName: "executionCount" }),
    publicClient.getBlockNumber({ cacheTime: 0 }),
  ]);
  const [list, amounts, idle, total] = pos;
  return {
    user,
    strategies,
    mandate: {
      exists: m.createdAt > 0n,
      active: m.active,
      params: { ...m.params },
      allowed: [...m.allowedStrategies],
      createdAt: Number(m.createdAt),
    },
    positions: list.map((strategy, i) => ({ strategy, amount: amounts[i] })),
    idle,
    total,
    highWaterMark: hwm,
    health: { ...health },
    walletUsdc,
    allowance,
    paused,
    executionCount: Number(executionCount),
    block,
  };
}

export async function listMandateUsers(): Promise<Address[]> {
  return [
    ...(await publicClient.readContract({ address: deployment.mandate, abi: KriyaMandateAbi, functionName: "users" })),
  ];
}

// ------------------------------------------------------------------ activity (onchain events + agent journal)

export type ActivityItem = {
  runId?: string;
  id: string;
  ts: number;
  kind: string;
  title: string;
  detail?: string;
  txHash?: string;
  onchain: boolean;
  source?: "CRE" | "AGENT";
};

const EVENTS = {
  deposited: parseAbiItem("event Deposited(address indexed user, uint256 amount)"),
  withdrawn: parseAbiItem("event Withdrawn(address indexed user, uint256 amount)"),
  exit: parseAbiItem("event EmergencyExit(address indexed user, uint256 recovered)"),
  mandateStatus: parseAbiItem("event MandateStatusChanged(address indexed user, bool active)"),
  risk: parseAbiItem("event RiskUpdated(address indexed strategy, uint16 oldRisk, uint16 newRisk, address indexed updater)"),
  executed: parseAbiItem(
    "event AllocationExecuted(address indexed user, uint256 indexed executionId, uint8 source, address[] strategies, uint16[] bps, uint16 reserveBps, uint16 portfolioRisk, uint256 totalValue, string rationale)",
  ),
  peg: parseAbiItem("event PegChecked(address indexed feed, int256 price, uint256 updatedAt, uint16 depegBps, bool deploymentsFrozen)"),
};

const CHUNK = LOG_RANGE.chunk;
// keyed by block hash: block numbers repeat across chain resets and reorgs, hashes do not
const blockTimes = new Map<string, number>();

// All KRIYA contract events, scanned once and cached per server instance. Each poll only scans the
// blocks since the last one, in one eth_getLogs per block range (every event and contract at once),
// so /api/state stays fast on hosted deployments where the public RPC is range-capped.
type DecodedLog = Log & { eventName: string; args: Record<string, unknown> };
const LOG_CONCURRENCY = 4;
const SCAN_BUDGET_MS = 8_000;
const logCache: { scannedTo: bigint | null; logs: DecodedLog[]; inflight: Promise<void> | null } = {
  scannedTo: null,
  logs: [],
  inflight: null,
};

async function scanTo(latest: bigint) {
  const deployed = BigInt(deployment.deployBlock);
  let from = logCache.scannedTo === null ? deployed : logCache.scannedTo + 1n;
  if (LOG_RANGE.lookback !== null && logCache.scannedTo === null && latest - LOG_RANGE.lookback > deployed) from = latest - LOG_RANGE.lookback;
  const address = [deployment.vault, deployment.mandate, deployment.registry, deployment.executor];
  const events = Object.values(EVENTS);
  while (from <= latest) {
    // a batch of ranges in parallel; results are committed in order so scannedTo never skips a gap
    const ranges: [bigint, bigint][] = [];
    for (let f = from; f <= latest && ranges.length < LOG_CONCURRENCY; f += CHUNK + 1n) ranges.push([f, f + CHUNK > latest ? latest : f + CHUNK]);
    const results = await Promise.all(
      ranges.map(([fromBlock, toBlock]) =>
        logsClient.getLogs({ address, events, fromBlock, toBlock } as unknown as Parameters<typeof logsClient.getLogs>[0]),
      ),
    );
    for (const r of results) logCache.logs.push(...(r as unknown as DecodedLog[]));
    logCache.scannedTo = ranges[ranges.length - 1][1];
    from = logCache.scannedTo + 1n;
  }
}

/** Brings the cache up to `latest`, waiting at most SCAN_BUDGET_MS; a longer scan keeps going in the background. */
async function syncLogs(latest: bigint) {
  if (logCache.scannedTo !== null && logCache.scannedTo >= latest) return;
  if (!logCache.inflight) {
    logCache.inflight = scanTo(latest)
      .catch((err) => console.error("KRIYA log scan failed", err))
      .finally(() => {
        logCache.inflight = null;
      });
  }
  await Promise.race([logCache.inflight, new Promise((r) => setTimeout(r, SCAN_BUDGET_MS))]);
}

function cachedLogs(address: Address, event: (typeof EVENTS)[keyof typeof EVENTS], args?: Record<string, unknown>) {
  const user = (args?.user as string | undefined)?.toLowerCase();
  return logCache.logs.filter(
    (l) =>
      l.address.toLowerCase() === address.toLowerCase() &&
      l.eventName === event.name &&
      (!user || (l.args.user as string | undefined)?.toLowerCase() === user),
  );
}

const fmtUsdc = (v: bigint) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

export type ActivityResult = { items: ActivityItem[]; riskHistory: RiskPoint[]; journal: JournalEntry[] };

export async function readActivity(user: Address, strategies: StrategyView[], latest: bigint): Promise<ActivityResult> {
  const name = (a: string) => strategies.find((s) => s.address.toLowerCase() === a.toLowerCase())?.name ?? a.slice(0, 8);
  await syncLogs(latest);
  const get = async (address: Address, event: (typeof EVENTS)[keyof typeof EVENTS], args?: Record<string, unknown>) =>
    cachedLogs(address, event, args);

  const dep = await get(deployment.vault, EVENTS.deposited, { user });
  const wd = await get(deployment.vault, EVENTS.withdrawn, { user });
  const ex = await get(deployment.vault, EVENTS.exit, { user });
  const ms = await get(deployment.mandate, EVENTS.mandateStatus, { user });
  const risk = await get(deployment.registry, EVENTS.risk);
  const exec = await get(deployment.executor, EVENTS.executed, { user });
  // Atlas peg readings the executor made onchain inside this user's executions
  const execTxs = new Set((exec as Log[]).map((l) => l.transactionHash));
  const peg = execTxs.size ? ((await get(deployment.executor, EVENTS.peg)) as Log[]).filter((l) => execTxs.has(l.transactionHash)) : [];

  type AnyLog = Log & { args: Record<string, unknown> };
  // a risk score written through the executor came from a Chainlink CRE report
  const viaCre = (l: AnyLog) => (l.args.updater as string).toLowerCase() === deployment.executor.toLowerCase();
  const items: {
    log: AnyLog;
    kind: string;
    title: string;
    detail?: string;
    source?: "CRE" | "AGENT";
    point?: Omit<RiskPoint, "ts" | "txHash" | "order">;
  }[] = [];
  for (const l of dep as AnyLog[]) items.push({ log: l, kind: "deposit", title: `Deposited ${fmtUsdc(l.args.amount as bigint)} USDC` });
  for (const l of wd as AnyLog[]) items.push({ log: l, kind: "withdraw", title: `Withdrew ${fmtUsdc(l.args.amount as bigint)} USDC` });
  for (const l of ex as AnyLog[])
    items.push({ log: l, kind: "override", title: "Human override: emergency exit to reserve", detail: `${fmtUsdc(l.args.recovered as bigint)} USDC recovered` });
  for (const l of ms as AnyLog[])
    items.push({ log: l, kind: "mandate", title: l.args.active ? "Mandate active: KRIYA authorized" : "Mandate paused by user" });
  for (const l of risk as AnyLog[]) {
    const up = (l.args.newRisk as number) > (l.args.oldRisk as number);
    items.push({
      log: l,
      kind: up ? "risk-up" : "risk-down",
      title: `Verified risk ${up ? "increase" : "change"}: ${name(l.args.strategy as string)} ${l.args.oldRisk} → ${l.args.newRisk}`,
      detail: viaCre(l) ? "Written by Chainlink CRE report" : "Written by the KRIYA keeper from the Market Risk Engine",
      source: viaCre(l) ? "CRE" : "AGENT",
      point: {
        portfolioRisk: null,
        kind: "risk-change",
        up: (l.args.newRisk as number) > (l.args.oldRisk as number),
        label: `${name(l.args.strategy as string).split(" - ")[0]} ${l.args.oldRisk} → ${l.args.newRisk}`,
        source: viaCre(l) ? "CRE" : "AGENT",
      },
    });
  }
  for (const l of exec as AnyLog[]) {
    const a = l.args as { executionId: bigint; source: number; strategies: string[]; bps: number[]; reserveBps: number; portfolioRisk: number; rationale: string };
    const parts = a.strategies.map((s, i) => `${name(s).split(" - ")[0]} ${a.bps[i] / 100}%`);
    parts.push(`Reserve ${a.reserveBps / 100}%`);
    items.push({
      log: l,
      kind: "execute",
      title: `Allocation #${a.executionId} executed via ${a.source === 1 ? "Chainlink CRE" : "KRIYA agent"} · risk ${a.portfolioRisk}`,
      detail: `${parts.join(" · ")}${a.rationale ? ` — ${a.rationale}` : ""}`,
      source: a.source === 1 ? "CRE" : "AGENT",
      point: { portfolioRisk: a.portfolioRisk, kind: "execution", label: `Allocation #${a.executionId}`, source: a.source === 1 ? "CRE" : "AGENT" },
    });
  }
  const pegDecimals = peg.length
    ? await publicClient.readContract({ address: (peg[0] as AnyLog).args.feed as Address, abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" })
    : 8;
  for (const l of peg as AnyLog[]) {
    const a = l.args as { feed: string; price: bigint; depegBps: number; deploymentsFrozen: boolean };
    items.push({
      log: l,
      kind: a.deploymentsFrozen ? "risk-up" : "verify",
      title: `Atlas peg check onchain: $${(Number(a.price) / 10 ** pegDecimals).toFixed(4)} (${a.depegBps} bps off peg)${a.deploymentsFrozen ? " · new deployments frozen" : ""}`,
      detail: `KriyaExecutor read Atlas feed ${a.feed} inside this execution`,
    });
  }

  const blocks = [...new Set(items.map((i) => i.log.blockHash!))].filter((h) => !blockTimes.has(h));
  for (let i = 0; i < blocks.length; i += LOG_CONCURRENCY) {
    await Promise.all(
      blocks.slice(i, i + LOG_CONCURRENCY).map(async (b) => {
        blockTimes.set(b, Number((await publicClient.getBlock({ blockHash: b })).timestamp) * 1000);
      }),
    );
  }

  const onchain: ActivityItem[] = items.map((i) => ({
    id: `${i.log.transactionHash}-${i.log.logIndex}`,
    ts: blockTimes.get(i.log.blockHash!) ?? 0,
    kind: i.kind,
    title: i.title,
    detail: i.detail,
    txHash: i.log.transactionHash ?? undefined,
    onchain: true,
    source: i.source,
  }));
  const riskHistory: RiskPoint[] = items
    .filter((i) => i.point)
    .map((i) => ({
      ...i.point!,
      ts: blockTimes.get(i.log.blockHash!) ?? 0,
      order: Number(i.log.blockNumber!) * 1e6 + (i.log.logIndex ?? 0),
      txHash: i.log.transactionHash ?? undefined,
    }))
    .sort((a, b) => a.order - b.order);
  const journal = await readJournal(user);
  const offchain: (ActivityItem & { seq: number })[] = journal
    .filter((j) => j.kind !== "run")
    .map((j: JournalEntry, seq) => ({
    seq,
    runId: j.runId,
    id: j.id,
    ts: j.ts,
    kind: j.kind,
    title: j.title,
    detail: j.detail,
    txHash: j.txHash,
    onchain: false,
  }));
  // newest first; journal entries written in the same millisecond keep their write order
  const sorted = [...onchain.map((o) => ({ ...o, seq: -1 })), ...offchain]
    .sort((a, b) => b.ts - a.ts || b.seq - a.seq)
    .map((item) => ({ ...item, seq: undefined }));
  return { items: sorted, riskHistory, journal };
}
