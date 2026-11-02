"""web3.py wrapper around the deployed ZK-FedChain contracts (draft).

ABIs will be read from the Hardhat artifacts and addresses from
deployments/<network>.json, both produced by the JavaScript tool-chain, so
the Python nodes never hard-code contract details.
"""

from __future__ import annotations

from typing import Any

from .config import NodeConfig

# Must match FedTypes.Phase in contracts/libraries/FedTypes.sol
PHASES = ["None", "Commit", "Reveal", "Aggregate", "Challenge", "Disputed", "Finalized"]


class FedChain:
    """Connection to RoundManager, Registry and DisputeResolver for one account."""

    def __init__(self, cfg: NodeConfig):
        self.cfg = cfg
        # TODO: create the Web3 provider, load the account from cfg.private_key,
        # and build contract objects from artifacts + deployments/<network>.json.

    # Reads ------------------------------------------------------------
    def current_round(self) -> int:
        raise NotImplementedError

    def get_round(self, round_id: int) -> dict[str, Any]:
        """Returns FedTypes.Round as a dict, with the phase name resolved via PHASES."""
        raise NotImplementedError

    def latest_model(self) -> tuple[bytes, str, int]:
        """(model hash, IPFS CID, round that produced it)."""
        raise NotImplementedError

    # Writes (one per contract entry point used by the nodes) ------------
    def submit_update(self, round_id: int, commitment: int, proof: dict):
        raise NotImplementedError

    def reveal_update(self, round_id: int, update_cid: str, salt: int):
        raise NotImplementedError

    def post_aggregate(self, round_id: int, model_hash: bytes, model_cid: str, accepted_bitmap: int, bond_wei: int):
        raise NotImplementedError

    def open_challenge(self, round_id: int, claimed_hash: bytes, evidence_cid: str, bond_wei: int):
        raise NotImplementedError

    def cast_vote(self, dispute_id: int, support_challenger: bool):
        raise NotImplementedError
