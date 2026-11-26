// Writes kriya-workflow/config.bnb.json from ../contracts/deployments/97.json (BNB Chain testnet).
// Usage: node sync-config.mjs [agentUrl]
import { readFileSync, writeFileSync } from "node:fs";
const agentUrl = process.argv[2] ?? "http://localhost:3000";
const chainId = 97;
const target = { name: "binance_smart_chain-testnet", files: ["config.bnb.json"] };
const dep = JSON.parse(readFileSync(new URL(`../contracts/deployments/${chainId}.json`, import.meta.url), "utf8"));
const config = {
  schedule: "*/30 * * * * *",
  agentUrl,
  chainName: target.name,
  executorAddress: dep.executor,
  registryAddress: dep.registry,
  mandateAddress: dep.mandate,
  vaultAddress: dep.vault,
  gasLimit: "1500000",
};
for (const f of target.files) writeFileSync(new URL(`./kriya-workflow/${f}`, import.meta.url), JSON.stringify(config, null, 2) + "\n");
console.log("CRE config written:", target.files.join(", "), config);
