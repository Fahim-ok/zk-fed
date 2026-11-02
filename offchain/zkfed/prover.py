"""Groth16 proof generation for the norm-bound circuit (draft).

The circuit outputs the Poseidon commitment, so snarkjs returns the
commitment as public signal [0] together with the proof.
"""

from __future__ import annotations

import numpy as np

from .config import NodeConfig
from .quantize import field_encode, pad_to_dim


def build_circuit_input(q_update: np.ndarray, salt: int, round_id: int, client: str, norm_bound_sq: int, dim: int) -> dict:
    """Creates the JSON input expected by circuits/norm_bound.circom."""
    return {
        "normBoundSq": str(norm_bound_sq),
        "roundId": str(round_id),
        "client": str(int(client, 16)),
        "delta": field_encode(pad_to_dim(q_update, dim)),
        "salt": str(salt),
    }


def prove(cfg: NodeConfig, circuit_input: dict) -> tuple[int, dict, list[str]]:
    """Returns (commitment, proof {a, b, c}, public signals).

    TODO: run `snarkjs groth16 fullprove` with cfg.circuit_wasm / cfg.circuit_zkey
    and convert the output with `snarkjs zkey export soliditycalldata`.
    """
    raise NotImplementedError
