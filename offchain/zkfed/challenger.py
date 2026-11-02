"""Challenger / voter node (draft).

During the Challenge phase a member re-runs the deterministic aggregation
and compares the model hash with the one posted by the aggregator; on a
mismatch it opens a dispute, and other members use the same check to vote.
"""

from __future__ import annotations

from .aggregator import Aggregator


class Challenger(Aggregator):
    def recompute_model_hash(self, round_id: int) -> bytes:
        raise NotImplementedError

    def challenge_if_wrong(self, round_id: int, evidence_cid: str = "") -> int | None:
        """Opens a dispute when the posted aggregate is wrong; returns the dispute id."""
        raise NotImplementedError

    def vote(self, dispute_id: int) -> None:
        raise NotImplementedError
