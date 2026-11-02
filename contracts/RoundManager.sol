// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRoundManager} from "./interfaces/IRoundManager.sol";
import {IRegistry} from "./interfaces/IRegistry.sol";
import {IGroth16Verifier} from "./interfaces/IGroth16Verifier.sol";
import {IFedRewardToken} from "./interfaces/IFedRewardToken.sol";
import {FedTypes} from "./libraries/FedTypes.sol";

/**
 * @title RoundManager
 * @notice On-chain coordinator of ZK-FedChain. It takes the place of the
 *         trusted FL server: it schedules rounds, accepts only updates that
 *         carry a valid norm-bound proof, keeps a tamper-evident history of
 *         global models, and settles rewards and penalties.
 *
 * @dev What lives on-chain: round phases and deadlines, Poseidon commitments,
 *      IPFS CIDs, model hashes and the accepted set. What stays off-chain:
 *      LoRA training, proof generation, update files (IPFS) and robust
 *      aggregation.
 *
 *      Milestone status: round creation and the Commit and Reveal phases are
 *      implemented. Aggregation, finalization and the dispute hooks are
 *      defined by IRoundManager and marked TODO below.
 */
contract RoundManager is IRoundManager, AccessControl, ReentrancyGuard {
    bytes32 public constant DISPUTE_RESOLVER_ROLE = keccak256("DISPUTE_RESOLVER_ROLE");

    /// @dev Reason code passed to Registry.slash when a proof fails.
    bytes32 public constant REASON_INVALID_PROOF = "INVALID_PROOF";

    /// @dev The accepted set is a uint256 bitmap, so a round holds at most 256 updates.
    uint16 public constant MAX_SUBMISSIONS = 256;

    IRegistry public immutable registry;
    IGroth16Verifier public immutable verifier;
    IFedRewardToken public immutable rewardToken;

    FedTypes.RoundConfig private _config;
    uint256 private _currentRoundId;

    bytes32 private _latestModelHash;
    string private _latestModelCID;
    uint256 private _latestModelRound;

    mapping(uint256 => FedTypes.Round) private _rounds;
    mapping(uint256 => mapping(address => FedTypes.Submission)) private _submissions;
    mapping(uint256 => address[]) private _submitters;

    error WrongPhase(FedTypes.Phase expected, FedTypes.Phase actual);
    error PreviousRoundOpen(uint256 roundId);
    error DeadlinePassed();
    error PhaseNotOver();
    error NotEligible(address account);
    error AggregatorCannotSubmit();
    error AlreadySubmitted();
    error RoundFull();
    error NoSubmission();
    error AlreadyRevealed();
    error EmptyField();
    error NoEligibleAggregator();
    error NotImplemented();

    /**
     * @param registry_ Membership and stake contract.
     * @param verifier_ Groth16 verifier generated from circuits/norm_bound.circom.
     * @param rewardToken_ ERC-20 reward token (this contract must hold MINTER_ROLE).
     * @param config_ Round durations, norm bound, rewards, bonds and penalties.
     * @param genesisModelHash keccak256 of the initial (pre-trained) adapter.
     * @param genesisModelCID IPFS CID of the initial adapter.
     * @param admin Governance address that may update the config between rounds.
     */
    constructor(
        IRegistry registry_,
        IGroth16Verifier verifier_,
        IFedRewardToken rewardToken_,
        FedTypes.RoundConfig memory config_,
        bytes32 genesisModelHash,
        string memory genesisModelCID,
        address admin
    ) {
        registry = registry_;
        verifier = verifier_;
        rewardToken = rewardToken_;
        _config = config_;
        _latestModelHash = genesisModelHash;
        _latestModelCID = genesisModelCID;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Updates protocol parameters. Only allowed when no round is open.
    function setConfig(FedTypes.RoundConfig calldata newConfig) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireNoOpenRound();
        _config = newConfig;
    }

    // ------------------------------------------------------------------
    // Round lifecycle
    // ------------------------------------------------------------------

    /// @inheritdoc IRoundManager
    function startRound() external returns (uint256 roundId) {
        _requireNoOpenRound();

        roundId = ++_currentRoundId;
        FedTypes.Round storage r = _rounds[roundId];
        r.phase = FedTypes.Phase.Commit;

        // Deadlines are fixed up front so every client sees the same schedule.
        uint64 t = uint64(block.timestamp);
        r.commitDeadline = t + _config.commitDuration;
        r.revealDeadline = r.commitDeadline + _config.revealDuration;
        r.aggregateDeadline = r.revealDeadline + _config.aggregateDuration;
        r.challengeDeadline = r.aggregateDeadline + _config.challengeDuration;

        r.prevModelHash = _latestModelHash;
        r.aggregator = _selectAggregator(roundId);

        emit RoundStarted(roundId, r.aggregator, r.prevModelHash, r.commitDeadline);
    }

    /// @inheritdoc IRoundManager
    function submitUpdate(uint256 roundId, uint256 commitment, FedTypes.Proof calldata proof)
        external
        nonReentrant
    {
        FedTypes.Round storage r = _requirePhase(roundId, FedTypes.Phase.Commit);
        if (block.timestamp > r.commitDeadline) revert DeadlinePassed();
        if (!registry.isEligible(msg.sender)) revert NotEligible(msg.sender);
        if (msg.sender == r.aggregator) revert AggregatorCannotSubmit();
        if (_submissions[roundId][msg.sender].exists) revert AlreadySubmitted();
        if (r.numSubmissions >= MAX_SUBMISSIONS) revert RoundFull();

        // Public signals come from contract state, not from the caller, which
        // binds the proof to this round, this bound and this sender.
        uint256[4] memory pubSignals =
            [commitment, _config.normBoundSq, roundId, uint256(uint160(msg.sender))];

        if (!verifier.verifyProof(proof.a, proof.b, proof.c, pubSignals)) {
            // A failed proof is cryptographic evidence, so the stake is slashed
            // (instead of reverting, which would undo the penalty).
            registry.slash(msg.sender, _config.invalidProofPenalty, REASON_INVALID_PROOF, address(0));
            emit ProofRejected(roundId, msg.sender);
            return;
        }

        uint16 index = r.numSubmissions;
        r.numSubmissions = index + 1;
        _submissions[roundId][msg.sender] = FedTypes.Submission({
            commitment: commitment,
            salt: 0,
            updateCID: "",
            index: index,
            revealed: false,
            exists: true
        });
        _submitters[roundId].push(msg.sender);
        registry.lockStake(msg.sender, r.challengeDeadline);

        emit UpdateSubmitted(roundId, msg.sender, commitment, index);
    }

    /// @inheritdoc IRoundManager
    function revealUpdate(uint256 roundId, string calldata updateCID, uint256 salt) external {
        FedTypes.Round storage r = _requirePhase(roundId, FedTypes.Phase.Reveal);
        if (block.timestamp > r.revealDeadline) revert DeadlinePassed();

        FedTypes.Submission storage s = _submissions[roundId][msg.sender];
        if (!s.exists) revert NoSubmission();
        if (s.revealed) revert AlreadyRevealed();
        if (bytes(updateCID).length == 0) revert EmptyField();

        // The aggregator and challengers recompute the Poseidon commitment
        // off-chain from the IPFS file and the salt.
        s.updateCID = updateCID;
        s.salt = salt;
        s.revealed = true;

        emit UpdateRevealed(roundId, msg.sender, updateCID, salt);
    }

    /// @inheritdoc IRoundManager
    /// @dev TODO (next milestone): check the aggregator, the bond and the
    ///      accepted set, store the model hash/CID and open the challenge window.
    function postAggregate(uint256, bytes32, string calldata, uint256) external payable {
        revert NotImplemented();
    }

    /// @inheritdoc IRoundManager
    /// @dev Commit -> Reveal and Reveal -> Aggregate are implemented.
    ///      TODO: slash clients that never revealed, and handle an aggregator
    ///      that misses the aggregate deadline.
    function advancePhase(uint256 roundId) external {
        FedTypes.Round storage r = _rounds[roundId];

        if (r.phase == FedTypes.Phase.Commit) {
            if (block.timestamp <= r.commitDeadline) revert PhaseNotOver();
            r.phase = r.numSubmissions == 0 ? FedTypes.Phase.Finalized : FedTypes.Phase.Reveal;
        } else if (r.phase == FedTypes.Phase.Reveal) {
            if (block.timestamp <= r.revealDeadline) revert PhaseNotOver();
            r.phase = FedTypes.Phase.Aggregate;
        } else {
            revert NotImplemented();
        }

        emit PhaseAdvanced(roundId, r.phase);
    }

    /// @inheritdoc IRoundManager
    /// @dev TODO (next milestone): mint rewards to accepted clients, lower the
    ///      reputation of filtered clients, refund the aggregator bond and
    ///      record the new global model.
    function finalizeRound(uint256) external pure {
        revert NotImplemented();
    }

    // ------------------------------------------------------------------
    // Dispute hooks (called by DisputeResolver)
    // ------------------------------------------------------------------

    /// @inheritdoc IRoundManager
    /// @dev TODO: move a round from Challenge to Disputed.
    function markDisputed(uint256) external view onlyRole(DISPUTE_RESOLVER_ROLE) {
        revert NotImplemented();
    }

    /// @inheritdoc IRoundManager
    /// @dev TODO: finalize normally if upheld; otherwise slash the aggregator
    ///      and pay its bond to the challenger.
    function resolveDispute(uint256, bool, address) external view onlyRole(DISPUTE_RESOLVER_ROLE) {
        revert NotImplemented();
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @inheritdoc IRoundManager
    function currentRoundId() external view returns (uint256) {
        return _currentRoundId;
    }

    /// @inheritdoc IRoundManager
    function getRound(uint256 roundId) external view returns (FedTypes.Round memory) {
        return _rounds[roundId];
    }

    /// @inheritdoc IRoundManager
    function getSubmission(uint256 roundId, address client) external view returns (FedTypes.Submission memory) {
        return _submissions[roundId][client];
    }

    /// @inheritdoc IRoundManager
    function submittersOf(uint256 roundId) external view returns (address[] memory) {
        return _submitters[roundId];
    }

    /// @inheritdoc IRoundManager
    function getConfig() external view returns (FedTypes.RoundConfig memory) {
        return _config;
    }

    /// @inheritdoc IRoundManager
    function latestModel() external view returns (bytes32 modelHash, string memory modelCID, uint256 roundId) {
        return (_latestModelHash, _latestModelCID, _latestModelRound);
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    /**
     * @dev Picks a staked member as aggregator from a pseudo-random start.
     *      TODO: replace block.prevrandao with a VRF or commit-reveal beacon.
     */
    function _selectAggregator(uint256 roundId) private view returns (address) {
        uint256 n = registry.memberCount();
        if (n == 0) revert NoEligibleAggregator();
        uint256 start = uint256(keccak256(abi.encode(block.prevrandao, roundId))) % n;
        for (uint256 i = 0; i < n; i++) {
            address candidate = registry.memberAt((start + i) % n);
            if (registry.isEligible(candidate)) return candidate;
        }
        revert NoEligibleAggregator();
    }

    function _requirePhase(uint256 roundId, FedTypes.Phase expected)
        private
        view
        returns (FedTypes.Round storage r)
    {
        r = _rounds[roundId];
        if (r.phase != expected) revert WrongPhase(expected, r.phase);
    }

    function _requireNoOpenRound() private view {
        uint256 id = _currentRoundId;
        if (id != 0 && _rounds[id].phase != FedTypes.Phase.Finalized) revert PreviousRoundOpen(id);
    }
}
