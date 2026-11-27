# KRIYA: mandate-bound AI capital on BNB Chain

> **Stop programming transactions. Start programming financial objectives.**

KRIYA lets a user program a **financial mandate** onchain (an objective plus hard limits) instead of individual transactions. Then it runs that mandate:

1. **Market truth.** The **KRIYA Market Risk Engine** turns live **CoinMarketCap** market data, **Atlas** onchain oracle prices and **Cournot** event probabilities into a risk score for every strategy, including a **tokenized T-Bill (RWA)** vault.
2. **Verify.** **Chainlink CRE** reads the risk feed with DON consensus and writes the verified scores onchain on **BNB Chain** through a signed report (the keeper is the fallback path).
3. **Decide.** **Claude** proposes an allocation, with persistent memory of past market regimes and its own past decisions from **Living Brain** (ChatAndBuild).
4. **Enforce.** **KriyaExecutor** checks every allocation against the mandate onchain, and reads the **Atlas** stablecoin feed onchain as a depeg circuit breaker. Anything outside the limits reverts.

**AI proposes · market data sets the risk · rules constrain · Chainlink CRE verifies · BNB Chain contracts enforce.**

Built for **BNB Bangkok 2026**: Developer Track (RWA + onchain AI agents), CoinMarketCap × Atlas, Cournot, and ChatAndBuild Living Brain.

---

## Live on BNB Chain testnet (chain 97)

| Contract | Address |
| --- | --- |
| KriyaExecutor (CRE receiver) | [`0xADEead25f7aB15483889A669C450e51Ec978ba36`](https://testnet.bscscan.com/address/0xADEead25f7aB15483889A669C450e51Ec978ba36) |
| KriyaVault | [`0x914768800B7fB80762ecdef092dfc9a889bd8331`](https://testnet.bscscan.com/address/0x914768800B7fB80762ecdef092dfc9a889bd8331) |
| KriyaMandate | [`0xBd28D5cE0d59d8aE7BB9d1797734FD55c41f06e8`](https://testnet.bscscan.com/address/0xBd28D5cE0d59d8aE7BB9d1797734FD55c41f06e8) |
| KriyaStrategyRegistry | [`0xCC09b2740980af77382Aa89Dc570edAd86Cd5351`](https://testnet.bscscan.com/address/0xCC09b2740980af77382Aa89Dc570edAd86Cd5351) |
| Test USDC | [`0xA8dcD36C47a3152aa0049D5D333646E179578738`](https://testnet.bscscan.com/address/0xA8dcD36C47a3152aa0049D5D333646E179578738) |
| Strategy A / B / C | [`0x67E7969Acc61d73C0ef9dc0239476332dcBAd219`](https://testnet.bscscan.com/address/0x67E7969Acc61d73C0ef9dc0239476332dcBAd219) · [`0x6Bb7E8ec50Ce23a13473165cA4c7b7ed2888284A`](https://testnet.bscscan.com/address/0x6Bb7E8ec50Ce23a13473165cA4c7b7ed2888284A) · [`0xfA4c91A632A23F1cC800B857d2e0EFe3A8D959B9`](https://testnet.bscscan.com/address/0xfA4c91A632A23F1cC800B857d2e0EFe3A8D959B9) |
| Chainlink CRE MockKeystoneForwarder (`binance_smart_chain-testnet`) | `0xA238e42cb8782808DBb2F37E19859244ec4779B0` |
| Atlas feeds read by the engine (BNB/USD, USDT/USD) | [`0x3957d289ee9c38272377786787ea34f9dd29788d`](https://testnet.bscscan.com/address/0x3957d289ee9c38272377786787ea34f9dd29788d) · [`0x9dfd7992952bb9e8fb4bc6065fdc3518addc4e8b`](https://testnet.bscscan.com/address/0x9dfd7992952bb9e8fb4bc6065fdc3518addc4e8b) (Atlas publishes no USDC/USD feed on testnet) |
| Atlas feed read **onchain by KriyaExecutor** (peg guard) | `TODO` |

| Step | Tx |
| --- | --- |
| Open mandate | [`0x021110a8…`](https://testnet.bscscan.com/tx/0x021110a8cde60cff08df33539290da050af902e30c377c07d3035634550e5901) |
| Initial allocation (live market pushed B to risk 41 > max 40, so Claude chose A 40 · C 35 · reserve 25) | [`0x9690269f…`](https://testnet.bscscan.com/tx/0x9690269febdb83a72a0ec3d87b73a4bde07640557bc2eb5890c077fa309bcbca) |
| Guardrail revert (`ExposureExceeded`, B 60% > 40%) | [`0x01717230…`](https://testnet.bscscan.com/tx/0x0171723039f8666d36308c4a22f17988b7880a515cad0e4367b52eb3c5084c76) |
| Market Risk Engine → VERIFY (risk written onchain: A 27, B 41, C 17) | [`0x0f9ebcd2…`](https://testnet.bscscan.com/tx/0x0f9ebcd26068675948c9af9dca8d53e6ca4832b7f4f197e4e2104c7b668046d9) |
| Rebalance driven by live market risk | `TODO` |
| Chainlink CRE workflow run on BNB Chain (risk report + allocation report) | `TODO` |

Live app: `TODO` · Demo video: `TODO` · One-page write-up: [docs/BNB_BANGKOK_WRITEUP.md](docs/BNB_BANGKOK_WRITEUP.md)

---

## How it works

```
CoinMarketCap Pro API ─┐  BNB volatility, Fear & Greed, stablecoin quotes
Atlas feeds (BNB Chain)┼─► KRIYA Market Risk Engine ─► risk feed ─► CRE / keeper VERIFY ─► KriyaStrategyRegistry (onchain)
Cournot oracle ────────┘  P(market-stress event)      web/src/lib/riskModel.ts (pure, unit-tested)        │
                                                                                                         ▼
Living Brain ◄── remembers regimes + decisions ◄── Claude DECIDE (recalls memory) ◄── DETECT mandate breach
                                                        │
                                    CONSTRAIN (policy engine) → EXECUTE: KriyaExecutor (CRE report or agent key)
                                                                  ├─ validateAllocation (mandate, onchain)
                                                                  └─ Atlas peg guard (reads the feed onchain)
```

| Strategy | Live risk factors (added to the base score) |
| --- | --- |
| A, Stable Lending (base 21) | Stablecoin peg: worst USDT/USDC deviation × 20, max +30 (Atlas preferred, CMC fallback) · extreme fear (Fear & Greed ≤ 20) +3 |
| B, BNB/USDT LP Yield (base 34) | BNB volatility: \|24h\|×1.5 + \|7d\|×0.5, max +25 (CMC) · Atlas vs CMC BNB price gap > 2% +5 · Fear & Greed ≥ 80 +3 or ≤ 20 +5 · Cournot stress probability: round(max(0, p − 0.2) × 25) |
| C, Tokenized T-Bill, RWA (base 15) | Stablecoin peg at half weight (settles in a stablecoin) |

Example, tested end to end onchain: BNB −9.4% in 24h and −14.2% over 7d pushes Strategy B above a max-risk-40 mandate. CRE (or the keeper) writes the new score onchain, Claude exits B, and KriyaExecutor enforces the new allocation.

Demo mandate: $1,000 · max risk 40 · max exposure 40% · min reserve 25% · max drawdown 5% · auto-rebalance on.

| | Allocation | Portfolio risk |
| --- | --- | --- |
| Initial | B 40% · A 35% · Reserve 25% | 21 / 40 |
| Market sell-off | B breaches max risk 40 → **MANDATE AT RISK** | — |
| After rebalance | A 40% · C 35% · Reserve 25% | 14 / 40 |
| Unsafe proposal (B 60%) | **reverts onchain** with `ExposureExceeded` | — |
| USDT off peg (Atlas) | **no position may grow** (`DeploymentFrozenByPeg`); exits still allowed | — |

The strategies are mock vaults that **really hold the test stablecoin** (every move is a real ERC-20 transfer). APYs and base risk scores are demo parameters and are labelled as such.

---

## CoinMarketCap × Atlas

**CoinMarketCap Pro API** (`web/src/lib/server/market/cmc.ts`, server-side only)

| Endpoint | Why |
| --- | --- |
| `/v2/cryptocurrency/quotes/latest` (BNB, USDT, USDC) | BNB 24h/7d moves set the LP strategy's volatility risk (impermanent-loss exposure). USDT/USDC quotes are the peg fallback. |
| `/v3/fear-and-greed/latest` | Market regime: extreme fear adds withdrawal and liquidity risk, extreme greed adds reversal risk. |

Every call is logged (endpoint, HTTP status, credits) and shown in the dashboard under *CoinMarketCap call log*, and in `GET /api/market` → `evidence.cmcCalls`. The key never reaches the browser or the repository. Responses are cached for 60 seconds to protect credits.

**Atlas Oracle** is used in two places:

1. **Offchain risk engine** (`web/src/lib/server/market/atlas.ts`): reads the AggregatorV3-compatible Atlas feeds on BNB Chain (`ATLAS_FEED_BNB_USD`, `ATLAS_FEED_USDT_USD`, `ATLAS_FEED_USDC_USD`). Atlas is the primary source for stablecoin pegs (stale feeds are ignored), and Atlas BNB/USD is cross-checked against CoinMarketCap.
2. **Onchain enforcement** (`contracts/src/KriyaExecutor.sol`): with `setPegGuard(feed, maxDepegBps, maxFeedAge)`, every execution reads the Atlas stablecoin feed **inside the transaction** and emits `PegChecked(feed, price, updatedAt, depegBps, frozen)` as verifiable evidence. If the stablecoin is more than `maxDepegBps` off $1, no position may grow (`DeploymentFrozenByPeg`), and a stale feed blocks execution (`StalePegFeed`). Exits and reductions still go through. `pegStatus()` exposes the live reading, and the dashboard shows it under *Onchain peg guard*.

## Cournot Integration

- **Where it's called:** `web/src/lib/server/market/cournot.ts`, from the dashboard's *Market intelligence → Event risk* panel through `POST /api/market/cournot`. `resolve` (free) matches the claim to Cournot markets. `assess` calls `POST /intelligence/v1/probability`, with the `COURNOT-API-KEY` header kept server-side. Calls are user-triggered only and never retried.
- **How the probability is used:** the user marks the claim as a *stress* or *relief* scenario. The stress probability `p` adds an event-risk premium of `round(max(0, p − 0.2) × 25)` to the BNB LP strategy's risk (`web/src/lib/riskModel.ts`). If that pushes the strategy above the mandate's max risk, the next loop writes the score onchain and Claude moves the capital out. Without a live assessment the factor is simply absent: mocked, hardcoded or static probabilities are never used.
- **Where users see the claim and evidence:** the *Event risk* panel shows the exact claim, the returned probability, the Cournot request ID and market IDs, and Cournot's `result` and `basis` rendered **verbatim** under *Evidence returned by Cournot*. KRIYA's own explanation sits in a separate box labelled **"Added by KRIYA, not by Cournot"**. The *Live risk per strategy* list shows the resulting "Event risk (forward-looking)" factor tagged `[Cournot]`.
- **Proof of a successful call:** every call's sanitized request and response is stored with an ID and request ID (`GET /api/market` → `evidence.cournotProofs`). Example: `TODO proof id / request id`.

## Chainlink CRE

`cre/kriya-workflow/main.ts` is a Chainlink CRE workflow (TypeScript compiled to WASM) targeting **BNB Chain testnet** (`binance_smart_chain-testnet`). On a cron trigger it runs the whole loop with decentralized verification:

```
OBSERVE   HTTP: KRIYA risk feed (Market Risk Engine output), DON consensus
          EVM read: strategies, mandates, positions on BNB Chain
VERIFY    risk changed? → signed report (kind 1) → KriyaExecutor.onReport → registry update
DETECT    mandate health under the verified risk
DECIDE    HTTP POST → KRIYA agent (Claude + Living Brain) → allocation JSON
CONSTRAIN the same policy module the agent uses (web/src/lib/policy.ts) re-validates it in the workflow
EXECUTE   signed report (kind 2) → KriyaExecutor.onReport → mandate check + Atlas peg guard → rebalance
```

Only the configured Keystone forwarder can deliver reports (`ReceiverTemplate`), and a CRE allocation passes exactly the same onchain checks as the agent path, including the Atlas peg guard. The dashboard attributes every step to CRE or the keeper.

Run it after deploying (needs the [CRE CLI](https://docs.chain.link/cre) and Bun, plus a funded BSC testnet key in `cre/.env` as `CRE_ETH_PRIVATE_KEY`):

```bash
cd cre && cre workflow simulate kriya-workflow --target bnb-settings --non-interactive --trigger-index 0 --broadcast
```

## Living Brain (ChatAndBuild)

`web/src/lib/server/memory.ts` uses `@living-brain/sdk`, with one isolated subject for the market and one per mandate owner.

- **Remember:** every market regime (when scores move, or every 30 minutes), every decision (trigger, market, allocation, rationale), and every onchain execution or refusal.
- **Retrieve:** before each decision, KRIYA searches for similar past regimes and the mandate's own decision history.
- **Connect:** the memories go into Claude's context, and Claude is told to cite them when they change its decision. The decision card shows exactly what was recalled and whether it came from Living Brain or the local fallback. *Generate weekly market brief* asks Living Brain to synthesize everything KRIYA observed.

---

## Setup

Requirements: Node 20+, [Foundry](https://book.getfoundry.sh/getting-started/installation).

### Run locally (Anvil, no keys or testnet funds needed)

```bash
cd contracts && forge test
```

```bash
anvil
```

```bash
cd contracts && PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 AGENT_ADDRESS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

```bash
cd web && npm install && npm run sync && npm run dev
```

`web/.env.local` for Anvil (public Anvil dev keys):

```
NEXT_PUBLIC_CHAIN_ID=31337
ADMIN_PRIVATE_KEY=<anvil account 0>
AGENT_PRIVATE_KEY=<anvil account 2>
ANTHROPIC_API_KEY=<optional: without it the deterministic optimizer decides>
```

Add the Anvil network to MetaMask (RPC `http://127.0.0.1:8545`, chain id 31337), import an Anvil account and open http://localhost:3000. Any mandate can be viewed read-only at `/?view=<address>`.

The full market flow also runs locally with no keys: `./scripts/e2e-market-local.sh` starts Anvil, deploys Atlas-style mock feeds, switches on the peg guard, and serves CoinMarketCap and Cournot from local fixtures.

### Deploy to BNB Chain testnet

Fund two wallets with tBNB (https://www.bnbchain.org/en/testnet-faucet), then:

```bash
PRIVATE_KEY=0x... AGENT_ADDRESS=0x... ATLAS_PEG_FEED=0x... ./scripts/deploy-bsc.sh
```

`ATLAS_PEG_FEED` (an Atlas USDT/USD or USDC/USD feed on BSC testnet) is optional: the script checks that it answers `latestRoundData()` before deploying. Add `ETHERSCAN_API_KEY` to verify the contracts on testnet.bscscan.com. The script writes `contracts/deployments/97.json`, syncs the web app and writes the CRE config `cre/kriya-workflow/config.bnb.json` (set `AGENT_URL` to where the web app is reachable).

Then copy `web/.env.example` to `web/.env.local`, set `NEXT_PUBLIC_CHAIN_ID=97` and the keys (`AGENT_PRIVATE_KEY`, `ADMIN_PRIVATE_KEY`, `ANTHROPIC_API_KEY`, `CMC_API_KEY`, `ATLAS_FEED_*`, `COURNOT_API_KEY`, `LIVING_BRAIN_API_KEY`), and run `npm run dev`. All keys are used server-side only.

---

## Repository

| Path | What |
| --- | --- |
| `contracts/` | Foundry: `KriyaVault`, `KriyaMandate`, `KriyaExecutor` (CRE receiver, mandate enforcement, Atlas peg guard), `KriyaStrategyRegistry`, mock stablecoin, strategy vaults and Atlas-style feed |
| `cre/` | Chainlink CRE project: `kriya-workflow` (TypeScript → WASM) on BNB Chain testnet |
| `web/` | Next.js dashboard and agent server: Market Risk Engine, Claude decision engine, Living Brain memory, policy engine, keeper loop |
| `scripts/deploy-bsc.sh` | Deploy to BNB Chain testnet and wire the web app and the CRE workflow |
| `scripts/e2e-market-local.sh` | Market end-to-end run on Anvil with no keys |

### Contracts

- **KriyaMandate** stores each user's `Params { maxRisk, maxExposureBps, maxDrawdownBps, minReserveBps, autoRebalance, objective }` and allowlisted strategies. The user can pause it at any time.
- **KriyaVault** handles custody and per-user accounting. Funds move **only** between the vault and registered strategies (executor-only) or back to their owner. `emergencyExit()` pulls everything back to the reserve and pauses the mandate.
- **KriyaExecutor** is the enforcement layer. Two entry points run the *same* validation (`validateAllocation` and the Atlas peg guard):
  - `onReport` (Chainlink Keystone forwarder only): report kind `1` = verified risk update, `2` = allocation
  - `executeAllocation` (agent key): a fallback path with no extra powers

  Typed reverts: `ExposureExceeded`, `StrategyRiskExceeded`, `PortfolioRiskExceeded`, `ReserveBelowMinimum`, `StrategyNotAllowed`, `DuplicateStrategy`, `DrawdownExceeded`, `MandateInactive`, `AutoRebalanceDisabled`, `ProtocolPaused`, `DeploymentFrozenByPeg`, `StalePegFeed`.
- **KriyaStrategyRegistry** holds the allowlisted strategy universe and the verified risk scores (written by CRE reports through the executor, or by the keeper's owner key).

Risk rule: every held strategy's risk must be ≤ `maxRisk`, and portfolio risk `(Σ bps·risk + reserveBps·2) / 10000` must be ≤ `maxRisk`.

## Testing

| Layer | What runs | Command |
| --- | --- | --- |
| Contracts | 30 unit tests (including the CRE report path and the Atlas peg guard: on-peg, depeg freeze for agent and CRE, exits during depeg, stale feed, access control) + 4 fuzz properties (1,000 runs each: funds conserved, validator agrees with execution, every execution leaves the mandate compliant, a strategy above max risk is never held) | `cd contracts && forge test` |
| Web | 47 tests: policy engine (incl. 2,000 random mandates), Market Risk Engine model, demo flow, errors, streaming | `cd web && npm test` |
| End to end | 15 checks against Anvil + the real API + wallet transactions: open mandate, allocate, guardrail revert, risk spike, verified rebalance, emergency exit, input validation, rate limits | `cd web && npm run e2e` (setup in `web/scripts/e2e.mjs`) |
| CRE workflow | Typecheck (and WASM build with the CRE CLI) | `cd cre/kriya-workflow && bun install && bunx tsc --noEmit` |
| Market end to end | 11 checks: CMC + Atlas scoring, Chainlink CRE report path, sell-off breach, onchain verify and exit, Atlas `PegChecked` evidence, depeg freeze and recovery, Living Brain recall, Cournot premium, scenario overrides | `./scripts/e2e-market-local.sh` |

GitHub Actions runs all of it on every push (`.github/workflows/ci.yml`).

## 3-minute demo script

1. **Program (0:00):** connect a wallet on BSC testnet and set the limits. *Program mandate* mints test USDC, approves and calls `openMandate`.
2. **Market (0:20):** *Market intelligence* shows live CoinMarketCap quotes and Fear & Greed, Atlas feeds, the onchain peg guard, and the risk score per strategy with every factor and its source.
3. **Decide (0:45):** *Run loop* (or the CRE workflow) streams OBSERVE → VERIFY → DETECT → DECIDE → CONSTRAIN → EXECUTE. Claude allocates **B 40 · A 35 · Reserve 25** onchain, and the activity log shows the Atlas peg check the executor made inside that transaction.
4. **Guard (1:15):** *Guardrail test* submits an unsafe 60% allocation from the agent key. It **reverts onchain** with `ExposureExceeded`.
5. **Event risk (1:35):** enter a claim (e.g. "BNB below $500 before December 31, 2026", stress), *Find markets*, *Assess*. Cournot's probability, claim and verbatim evidence appear, and the LP strategy's risk rises.
6. **Rebalance (2:15):** if the mandate is breached (or with *Spike B → 48* as a scenario override), *Run loop* or CRE writes the risk onchain, Claude exits B citing what Living Brain recalled, and the risk chart steps down from 21 to 14.

## Security model

- The AI holds no keys and never controls funds. Its output is schema-constrained JSON, validated offchain, validated in CRE, and validated onchain.
- Only the configured Keystone forwarder can deliver CRE reports. The agent key can only call `executeAllocation`, which runs the same checks. Funds can only move between the vault and allowlisted strategies.
- The Atlas peg guard stops capital from being deployed during a stablecoin depeg and refuses to act on a stale feed.
- User override: pause the mandate, `emergencyExit()` (which also pauses the mandate, so the agent cannot redeploy the capital) and `withdraw()`. Owner emergency pause: `KriyaExecutor.setPaused`.
- API keys stay server-side. Gas- and credit-spending API routes are rate limited.

## Business model and roadmap

- **Revenue:** a management fee on capital under mandate (0.25–0.5% a year), plus a B2B API that lets wallets and RWA issuers offer "mandates, not transactions" to their users.
- **Next:** real BNB Chain venues for each strategy (lending markets, PancakeSwap LP, tokenized T-bill issuers), CoinMarketCap DEX data for LP pool depth, Atlas RWA/NAV feeds, a per-user vault factory, an audit, then mainnet.

## Build timeline and originality

KRIYA's core (mandate, vault, executor, Claude decision engine, dashboard) existed before this hackathon: the first commit is 2026-10-06, and it was previously entered at Monad Metropolis and TOKEN2049 Origins on other chains. The full history is in this repository.

**Built during BNB Bangkok (25–27 November 2026),** from commit `12eb51c` onward: BNB Chain deployment and app support, the Market Risk Engine (CoinMarketCap + Atlas + Cournot), the Chainlink CRE target for BNB Chain, the onchain Atlas peg guard in KriyaExecutor, Living Brain memory for the agent, the Market intelligence panel, and the tests for all of it. The earlier chains (Ethereum Sepolia, Monad) were removed so the project runs on BNB Chain only.

## AI disclosure

This project was built with an AI coding assistant (Claude Code, Anthropic) for code generation, testing, debugging and documentation, under the author's direction and review. The product also uses an LLM at runtime: Claude (via the Anthropic API) proposes allocations, which are always re-validated by the policy engine, the CRE workflow and the executor contract.

## Third-party code and attribution

| Component | Source | License |
| --- | --- | --- |
| `contracts/src/cre/ReceiverTemplate.sol`, `IReceiver.sol` | Adapted from Chainlink's CRE consumer-contract template ([docs](https://docs.chain.link/cre)) | MIT |
| `@chainlink/cre-sdk` | [Chainlink](https://www.npmjs.com/package/@chainlink/cre-sdk) | see package |
| OpenZeppelin Contracts (`ERC20`, `Ownable`, `SafeERC20`, `ReentrancyGuard`) | [OpenZeppelin](https://github.com/OpenZeppelin/openzeppelin-contracts) | MIT |
| forge-std | [Foundry](https://github.com/foundry-rs/forge-std) | MIT / Apache-2.0 |
| `@living-brain/sdk` | ChatAndBuild | see package |
| `@anthropic-ai/sdk` | [Anthropic](https://github.com/anthropics/anthropic-sdk-typescript) | MIT |
| Next.js, React, viem, wagmi, TanStack Query, Tailwind CSS, zod | npm | MIT |

## Team

Saurabh Nage · X [@saurabhnage624](https://x.com/saurabhnage624) · `TODO email / Telegram`

## License

[MIT](LICENSE)
