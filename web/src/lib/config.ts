import { defineChain, type Address } from "viem";
import { foundry, bsc, bscTestnet } from "viem/chains";
import { deployments } from "./generated/deployments";

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97);

const local = defineChain({ ...foundry, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
const CHAINS = {
  97: { chain: bscTestnet, rpc: "https://data-seed-prebsc-1-s1.bnbchain.org:8545", explorer: "https://testnet.bscscan.com", faucet: "https://www.bnbchain.org/en/testnet-faucet" },
  56: { chain: bsc, rpc: "https://bsc-dataseed.bnbchain.org", explorer: "https://bscscan.com", faucet: null },
  31337: { chain: local, rpc: "http://127.0.0.1:8545", explorer: null, faucet: null },
} as const;
const cfg = CHAINS[CHAIN_ID as keyof typeof CHAINS] ?? CHAINS[97];

export const chain = cfg.chain;
export const PUBLIC_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? cfg.rpc;
export const EXPLORER: string | null = cfg.explorer;
/** Where to get testnet gas for this chain (shown in "not enough gas" errors). */
export const FAUCET: string | null = cfg.faucet;
export const GAS_SYMBOL = chain.nativeCurrency.symbol;

type Deployment = {
  chainId: number;
  deployBlock: number;
  usdc: Address;
  registry: Address;
  mandate: Address;
  vault: Address;
  executor: Address;
  /** Chainlink CRE forwarder allowed to deliver reports to KriyaExecutor. */
  forwarder: Address;
  /** Atlas feed used by the executor's onchain peg guard (zero address = disabled). */
  pegFeed: Address;
  agent: Address;
  strategyA: Address;
  strategyB: Address;
  strategyC: Address;
};

const all = deployments as unknown as Record<string, Deployment>;
const dep = all[String(CHAIN_ID)];
if (!dep) {
  throw new Error(`No KRIYA deployment for chain ${CHAIN_ID}. Deploy contracts, then run \`npm run sync\`.`);
}
export const deployment: Deployment = dep;

export const USDC_DECIMALS = 6;

export const DEMO_MANDATE = {
  capital: 1_000,
  objective: "Maximize risk-adjusted yield",
  maxRisk: 40,
  maxExposureBps: 4000,
  maxDrawdownBps: 500,
  minReserveBps: 2500,
  autoRebalance: true,
};

export const txUrl = (hash: string) => (EXPLORER ? `${EXPLORER}/tx/${hash}` : null);
export const addressUrl = (a: string) => (EXPLORER ? `${EXPLORER}/address/${a}` : null);

/** A live mandate judges can open read-only from the landing page, per chain. */
export const DEMO_VIEW_ADDRESS: string | null =
  ({ 31337: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" } as Record<number, string>)[CHAIN_ID] ?? null;
