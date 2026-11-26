// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {KriyaMandate} from "./KriyaMandate.sol";
import {KriyaVault} from "./KriyaVault.sol";
import {KriyaStrategyRegistry} from "./KriyaStrategyRegistry.sol";

/// @notice Read interface of an Atlas Oracle single-feed contract (AggregatorV3-compatible).
interface IAtlasFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title KriyaExecutor - the enforcement layer
/// @notice AI proposes. Rules constrain. Market data verifies. Smart contracts enforce.
///
///         The KRIYA agent key (`executeAllocation`) is the only execution path, and every
///         allocation passes the user's onchain mandate check: anything outside it reverts.
///         The agent cannot move funds anywhere except between the vault and allowlisted strategies.
///
///         Atlas peg guard: when an Atlas Oracle feed for the settlement stablecoin is configured,
///         every execution reads it onchain. If the stablecoin is off-peg by more than
///         `maxDepegBps`, no position may grow (exits and reductions still go through), and a
///         stale feed blocks execution entirely.
contract KriyaExecutor is Ownable {
    uint16 public constant RESERVE_RISK = 2;
    uint16 public constant BPS = 10_000;

    KriyaMandate public immutable mandate;
    KriyaVault public immutable vault;
    KriyaStrategyRegistry public immutable registry;

    address public agent;
    bool public paused;
    uint256 public executionCount;

    IAtlasFeed public pegFeed;
    uint16 public maxDepegBps;
    uint32 public maxFeedAge;

    struct Health {
        uint256 totalValue;
        uint16 portfolioRisk;
        uint16 maxHeldRisk;
        uint16 maxExposureBps;
        uint16 reserveBps;
        bool allocated;
        bool violated;
    }

    event AllocationExecuted(
        address indexed user,
        uint256 indexed executionId,
        address[] strategies,
        uint16[] bps,
        uint16 reserveBps,
        uint16 portfolioRisk,
        uint256 totalValue,
        string rationale
    );
    event PegGuardSet(address indexed feed, uint16 maxDepegBps, uint32 maxFeedAge);
    event PegChecked(address indexed feed, int256 price, uint256 updatedAt, uint16 depegBps, bool deploymentsFrozen);
    event AgentSet(address agent);
    event PausedSet(bool paused);

    error NotAgent();
    error ProtocolPaused();
    error InvalidPegGuard();
    error StalePegFeed(uint256 updatedAt, uint32 maxAge);
    error DeploymentFrozenByPeg(address strategy, uint16 depegBps, uint16 maxDepegBps);
    error MandateInactive(address user);
    error AutoRebalanceDisabled(address user);
    error NothingToAllocate(address user);
    error LengthMismatch();
    error DuplicateStrategy(address strategy);
    error StrategyNotAllowed(address strategy);
    error ExposureExceeded(address strategy, uint16 bps, uint16 maxBps);
    error StrategyRiskExceeded(address strategy, uint16 risk, uint16 maxRisk);
    error AllocationOverflow(uint256 totalBps);
    error ReserveBelowMinimum(uint16 reserveBps, uint16 minReserveBps);
    error PortfolioRiskExceeded(uint16 risk, uint16 maxRisk);
    error DrawdownExceeded(uint256 value, uint256 floor);

    constructor(KriyaMandate _mandate, KriyaVault _vault, KriyaStrategyRegistry _registry, address _agent)
        Ownable(msg.sender)
    {
        mandate = _mandate;
        vault = _vault;
        registry = _registry;
        agent = _agent;
        emit AgentSet(_agent);
    }

    // ------------------------------------------------------------------ admin

    function setAgent(address _agent) external onlyOwner {
        agent = _agent;
        emit AgentSet(_agent);
    }

    /// @notice Configure the Atlas peg guard. `feed == address(0)` disables it.
    /// @param _maxDepegBps max distance from $1.00 before deployments freeze (e.g. 100 = 1%)
    /// @param _maxFeedAge max seconds since the feed's last update before it counts as stale
    function setPegGuard(address feed, uint16 _maxDepegBps, uint32 _maxFeedAge) external onlyOwner {
        if (feed != address(0) && (_maxDepegBps == 0 || _maxDepegBps > 2_000 || _maxFeedAge == 0)) revert InvalidPegGuard();
        pegFeed = IAtlasFeed(feed);
        maxDepegBps = _maxDepegBps;
        maxFeedAge = _maxFeedAge;
        emit PegGuardSet(feed, _maxDepegBps, _maxFeedAge);
    }

    /// @notice Emergency pause: stops all executions.
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    // ------------------------------------------------------------------ entry points

    /// @notice The only execution path. Validated against the user's mandate onchain.
    function executeAllocation(
        address user,
        address[] calldata strategies,
        uint16[] calldata bps,
        string calldata rationale
    ) external {
        if (msg.sender != agent) revert NotAgent();
        _execute(user, strategies, bps, rationale);
    }

    // ------------------------------------------------------------------ Atlas peg guard

    /// @notice Current reading of the Atlas peg feed.
    /// @return enabled whether a feed is configured
    /// @return price raw feed answer
    /// @return decimals feed decimals
    /// @return updatedAt feed timestamp
    /// @return depegBps distance from $1.00 in basis points
    /// @return stale whether the feed is older than `maxFeedAge`
    /// @return frozen whether new deployments are frozen (depeg above `maxDepegBps`)
    function pegStatus()
        public
        view
        returns (bool enabled, int256 price, uint8 decimals, uint256 updatedAt, uint16 depegBps, bool stale, bool frozen)
    {
        if (address(pegFeed) == address(0)) return (false, 0, 0, 0, 0, false, false);
        enabled = true;
        decimals = pegFeed.decimals();
        (, price,, updatedAt,) = pegFeed.latestRoundData();
        stale = updatedAt == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > maxFeedAge;
        int256 one = int256(10 ** uint256(decimals));
        uint256 diff = price >= one ? uint256(price - one) : uint256(one - price);
        uint256 dBps = (diff * BPS) / uint256(one);
        depegBps = dBps > type(uint16).max ? type(uint16).max : uint16(dBps);
        frozen = depegBps > maxDepegBps;
    }

    /// @dev Reads the feed onchain, emits the reading as evidence, returns whether growth is frozen.
    function _checkPeg() internal returns (bool frozen) {
        (bool enabled, int256 price,, uint256 updatedAt, uint16 depegBps, bool stale, bool isFrozen) = pegStatus();
        if (!enabled) return false;
        if (stale) revert StalePegFeed(updatedAt, maxFeedAge);
        emit PegChecked(address(pegFeed), price, updatedAt, depegBps, isFrozen);
        return isFrozen;
    }

    // ------------------------------------------------------------------ validation

    /// @notice Reverts with a descriptive custom error if the allocation violates the mandate.
    /// @return portfolioRisk weighted risk of the proposed portfolio (reserve included)
    /// @return reserveBps share left in the USDC reserve
    function validateAllocation(address user, address[] memory strategies, uint16[] memory bps)
        public
        view
        returns (uint16 portfolioRisk, uint16 reserveBps)
    {
        KriyaMandate.Mandate memory m = mandate.getMandate(user);
        if (!m.active) revert MandateInactive(user);
        if (strategies.length != bps.length) revert LengthMismatch();

        uint256 totalBps;
        uint256 weightedRisk;
        for (uint256 i = 0; i < strategies.length; i++) {
            address s = strategies[i];
            for (uint256 j = 0; j < i; j++) {
                if (strategies[j] == s) revert DuplicateStrategy(s);
            }
            if (!registry.isStrategy(s) || !mandate.isAllowed(user, s)) revert StrategyNotAllowed(s);
            if (bps[i] > m.params.maxExposureBps) revert ExposureExceeded(s, bps[i], m.params.maxExposureBps);
            uint16 risk = registry.riskOf(s);
            if (bps[i] > 0 && risk > m.params.maxRisk) revert StrategyRiskExceeded(s, risk, m.params.maxRisk);
            totalBps += bps[i];
            weightedRisk += uint256(bps[i]) * risk;
        }
        if (totalBps > BPS) revert AllocationOverflow(totalBps);
        reserveBps = uint16(BPS - totalBps);
        if (reserveBps < m.params.minReserveBps) revert ReserveBelowMinimum(reserveBps, m.params.minReserveBps);

        weightedRisk += uint256(reserveBps) * RESERVE_RISK;
        portfolioRisk = uint16(weightedRisk / BPS);
        if (portfolioRisk > m.params.maxRisk) revert PortfolioRiskExceeded(portfolioRisk, m.params.maxRisk);
    }

    /// @notice Live mandate health computed from current positions and verified risk scores.
    function mandateHealth(address user) public view returns (Health memory h) {
        KriyaMandate.Mandate memory m = mandate.getMandate(user);
        (address[] memory list, uint256[] memory amounts, uint256 idle, uint256 total) = vault.positionsOf(user);
        h.totalValue = total;
        if (total == 0) return h;

        uint256 weighted = idle * RESERVE_RISK;
        for (uint256 i = 0; i < list.length; i++) {
            if (amounts[i] == 0) continue;
            h.allocated = true;
            uint16 risk = registry.riskOf(list[i]);
            weighted += amounts[i] * risk;
            if (risk > h.maxHeldRisk) h.maxHeldRisk = risk;
            uint16 share = uint16((amounts[i] * BPS) / total);
            if (share > h.maxExposureBps) h.maxExposureBps = share;
            if (risk > m.params.maxRisk) h.violated = true;
            if (!mandate.isAllowed(user, list[i])) h.violated = true;
        }
        h.portfolioRisk = uint16(weighted / total);
        h.reserveBps = uint16((idle * BPS) / total);
        if (h.portfolioRisk > m.params.maxRisk) h.violated = true;
        if (h.maxExposureBps > m.params.maxExposureBps) h.violated = true;
    }

    // ------------------------------------------------------------------ execution

    function _execute(
        address user,
        address[] memory strategies,
        uint16[] memory bps,
        string memory rationale
    ) internal {
        if (paused) revert ProtocolPaused();

        Health memory before = mandateHealth(user);
        if (before.totalValue == 0) revert NothingToAllocate(user);
        if (before.allocated && !mandate.getMandate(user).params.autoRebalance) revert AutoRebalanceDisabled(user);

        (uint16 portfolioRisk, uint16 reserveBps) = validateAllocation(user, strategies, bps);
        _checkDrawdown(user, before.totalValue);
        bool frozen = _checkPeg();

        _rebalance(user, strategies, bps, before.totalValue, frozen);
        vault.syncHighWaterMark(user);

        uint256 id = ++executionCount;
        emit AllocationExecuted(user, id, strategies, bps, reserveBps, portfolioRisk, before.totalValue, rationale);
    }

    function _checkDrawdown(address user, uint256 value) internal view {
        uint16 maxDd = mandate.getMandate(user).params.maxDrawdownBps;
        uint256 floor = (vault.highWaterMark(user) * (BPS - maxDd)) / BPS;
        if (value < floor) revert DrawdownExceeded(value, floor);
    }

    /// @dev Delta-based: first shrink over-weight positions into the reserve, then grow under-weight ones.
    ///      While the Atlas peg guard is frozen, growing any position reverts.
    function _rebalance(address user, address[] memory strategies, uint16[] memory bps, uint256 total, bool frozen)
        internal
    {
        address[] memory list = registry.strategies();
        uint256[] memory targets = new uint256[](list.length);
        for (uint256 i = 0; i < list.length; i++) {
            for (uint256 j = 0; j < strategies.length; j++) {
                if (strategies[j] == list[i]) {
                    targets[i] = (total * bps[j]) / BPS;
                    break;
                }
            }
        }
        for (uint256 i = 0; i < list.length; i++) {
            uint256 pos = vault.positionOf(user, list[i]);
            if (pos > targets[i]) vault.moveFromStrategy(user, list[i], pos - targets[i]);
        }
        for (uint256 i = 0; i < list.length; i++) {
            uint256 pos = vault.positionOf(user, list[i]);
            if (pos < targets[i]) {
                if (frozen) revert DeploymentFrozenByPeg(list[i], _depegBps(), maxDepegBps);
                vault.moveToStrategy(user, list[i], targets[i] - pos);
            }
        }
    }

    function _depegBps() internal view returns (uint16 d) {
        (,,,, d,,) = pegStatus();
    }
}
