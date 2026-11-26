#!/usr/bin/env bash
# Deploy KRIYA to BNB Chain testnet (chain 97) and wire the web app + Chainlink CRE workflow to the new addresses.
# Required: PRIVATE_KEY (funded deployer, 0x-prefixed; tBNB from https://www.bnbchain.org/en/testnet-faucet)
#           AGENT_ADDRESS (public address of AGENT_PRIVATE_KEY)
# Optional: ATLAS_PEG_FEED (Atlas USDT/USD or USDC/USD feed on BSC testnet: enables the onchain peg guard)
#           PEG_MAX_DEPEG_BPS (default 100) · PEG_MAX_FEED_AGE (seconds, default 86400)
#           CRE_FORWARDER (defaults to the CRE MockKeystoneForwarder on BSC testnet) · AGENT_URL (for the CRE config)
#           BSC_TESTNET_RPC_URL · ETHERSCAN_API_KEY (verifies the contracts on testnet.bscscan.com)
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PRIVATE_KEY:?set PRIVATE_KEY}"
: "${AGENT_ADDRESS:?set AGENT_ADDRESS (public address of AGENT_PRIVATE_KEY)}"
RPC="${BSC_TESTNET_RPC_URL:-https://data-seed-prebsc-1-s1.bnbchain.org:8545}"

if [ -n "${ATLAS_PEG_FEED:-}" ]; then
  echo "Checking Atlas feed $ATLAS_PEG_FEED ..."
  cast call "$ATLAS_PEG_FEED" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url "$RPC" \
    || { echo "ATLAS_PEG_FEED does not answer latestRoundData() on BSC testnet: unset it or fix the address"; exit 1; }
fi

VERIFY=()
[ -n "${ETHERSCAN_API_KEY:-}" ] && VERIFY=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY" --chain 97)
(cd contracts && forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --legacy "${VERIFY[@]}")
(cd web && npm run sync)
node cre/sync-config.mjs "${AGENT_URL:-http://localhost:3000}"
echo "Done. Addresses: contracts/deployments/97.json · set NEXT_PUBLIC_CHAIN_ID=97 in web/.env.local"
