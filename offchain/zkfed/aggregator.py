"""Aggregator node (draft).

Planned responsibilities in one round:
  1. read the revealed submissions (CID + salt) from the contract,
  2. download each update from IPFS and re-check it against its commitment,
  3. run a deterministic robust aggregation rule (Multi-Krum / trimmed mean),
  4. upload the new global adapter to IPFS and call postAggregate with a bond.

Aggregation must be deterministic because challengers re-run it exactly.
"""

from __future__ import annotations

import numpy as np

from .config import NodeConfig


def multi_krum(updates: np.ndarray, num_byzantine: int, num_selected: int | None = None) -> tuple[np.ndarray, list[int]]:
    """Multi-Krum (Blanchard et al., 2017). Returns (aggregate, selected indices)."""
    raise NotImplementedError


def trimmed_mean(updates: np.ndarray, trim_ratio: float = 0.1) -> np.ndarray:
    """Coordinate-wise trimmed mean (Yin et al., 2018)."""
    raise NotImplementedError


def to_bitmap(indices: list[int]) -> int:
    """Encodes accepted submission indices as the uint256 bitmap used on-chain."""
    bitmap = 0
    for i in indices:
        bitmap |= 1 << i
    return bitmap


class Aggregator:
    def __init__(self, cfg: NodeConfig, num_byzantine: int = 1):
        self.cfg = cfg
        self.num_byzantine = num_byzantine

    def fetch_revealed_updates(self, round_id: int) -> list[tuple[int, str, np.ndarray]]:
        """Returns (submission index, client, quantized update) for each revealed submission."""
        raise NotImplementedError

    def commitment_matches(self, update: np.ndarray, salt: int, round_id: int, client: str, commitment: int) -> bool:
        """Recomputes the Poseidon commitment off-chain and compares it."""
        raise NotImplementedError

    def run_round(self, round_id: int) -> None:
        raise NotImplementedError
