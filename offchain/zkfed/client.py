"""FL client node (draft).

Planned steps for one round:
  1. download the latest global adapter (RoundManager.latestModel -> IPFS),
  2. fine-tune LoRA adapters on the local private dataset,
  3. quantize the update to signed 16-bit fixed point,
  4. prove with Groth16 that its squared norm is within the on-chain bound,
  5. submitUpdate(roundId, commitment, proof) during the Commit phase,
  6. upload the update to IPFS and revealUpdate(roundId, cid, salt).
"""

from __future__ import annotations

import numpy as np

from .config import NodeConfig


class FLClient:
    def __init__(self, cfg: NodeConfig, data_dir: str):
        self.cfg = cfg
        self.data_dir = data_dir

    def train_local(self, global_adapter: bytes) -> np.ndarray:
        """Fine-tunes LoRA adapters (DistilBERT, rank 4) and returns the flattened update."""
        raise NotImplementedError

    def commit(self, round_id: int, update: np.ndarray) -> None:
        """Quantizes, proves and submits the update (steps 3-5)."""
        raise NotImplementedError

    def reveal(self, round_id: int) -> str:
        """Uploads the committed update to IPFS and reveals its CID and salt (step 6)."""
        raise NotImplementedError

    def run_round(self, round_id: int) -> None:
        raise NotImplementedError
