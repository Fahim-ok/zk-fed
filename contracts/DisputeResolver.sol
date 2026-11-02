// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IDisputeResolver} from "./interfaces/IDisputeResolver.sol";
import {IRoundManager} from "./interfaces/IRoundManager.sol";
import {IRegistry} from "./interfaces/IRegistry.sol";
import {FedTypes} from "./libraries/FedTypes.sol";

/**
 * @title DisputeResolver
 * @notice Lets any staked member challenge the aggregate posted in a round
 *         and settles the challenge by a vote of the other staked members.
 *
 * @dev Planned flow:
 *        1. openChallenge - challenger locks a bond during the challenge window;
 *                           the round is frozen in the Disputed phase.
 *        2. castVote      - each eligible member re-runs the deterministic
 *                           aggregation off-chain and votes.
 *        3. resolve       - after the voting deadline, the result is sent to
 *                           RoundManager.resolveDispute and bonds are settled.
 *
 *      Milestone status: storage, parameters and function signatures are in
 *      place; the function bodies are scheduled for the next milestone.
 */
contract DisputeResolver is IDisputeResolver, AccessControl {
    IRegistry public immutable registry;
    IRoundManager public immutable roundManager;

    /// @notice ETH a challenger must lock to open a dispute.
    uint256 public challengeBond;
    /// @notice Length of the voting period in seconds.
    uint64 public votingDuration;
    /// @notice Minimum number of votes for a challenger to win.
    uint32 public quorum;

    uint256 private _nextDisputeId;
    mapping(uint256 => FedTypes.Dispute) private _disputes;
    mapping(uint256 => mapping(address => bool)) private _voted;

    /// @notice Latest dispute opened against a round (0 if none).
    mapping(uint256 => uint256) public disputeOfRound;

    error NotImplemented();

    /**
     * @param registry_ Membership and stake contract.
     * @param roundManager_ Round coordinator whose aggregates are challenged.
     * @param challengeBond_ ETH bond required to open a challenge.
     * @param votingDuration_ Voting period in seconds.
     * @param quorum_ Minimum votes needed to overturn an aggregate.
     * @param admin Governance address that may change the parameters.
     */
    constructor(
        IRegistry registry_,
        IRoundManager roundManager_,
        uint256 challengeBond_,
        uint64 votingDuration_,
        uint32 quorum_,
        address admin
    ) {
        registry = registry_;
        roundManager = roundManager_;
        challengeBond = challengeBond_;
        votingDuration = votingDuration_;
        quorum = quorum_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Updates dispute parameters (affects disputes opened afterwards).
    function setParams(uint256 challengeBond_, uint64 votingDuration_, uint32 quorum_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        challengeBond = challengeBond_;
        votingDuration = votingDuration_;
        quorum = quorum_;
    }

    /// @inheritdoc IDisputeResolver
    /// @dev TODO: check eligibility and bond, call roundManager.markDisputed,
    ///      store the Dispute and emit ChallengeOpened.
    function openChallenge(uint256, bytes32, string calldata) external payable returns (uint256) {
        revert NotImplemented();
    }

    /// @inheritdoc IDisputeResolver
    /// @dev TODO: one vote per eligible member; challenger and aggregator excluded.
    function castVote(uint256, bool) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IDisputeResolver
    /// @dev TODO: majority with quorum decides; settle bonds and call
    ///      roundManager.resolveDispute.
    function resolve(uint256) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IDisputeResolver
    function getDispute(uint256 disputeId) external view returns (FedTypes.Dispute memory) {
        return _disputes[disputeId];
    }

    /// @inheritdoc IDisputeResolver
    function hasVoted(uint256 disputeId, address voter) external view returns (bool) {
        return _voted[disputeId][voter];
    }
}
