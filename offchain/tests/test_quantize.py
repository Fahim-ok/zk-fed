"""Unit tests for the fixed-point encoding shared with the circuit.

Run from the repository root:  python -m pytest offchain/tests
"""

import numpy as np

from offchain.zkfed.aggregator import to_bitmap
from offchain.zkfed.quantize import BN254_P, INT16_MAX, field_encode, quantize, squared_norm


def test_quantize_scales_rounds_and_clips():
    q = quantize(np.array([0.5, -0.25, 100.0]), scale=2**12)
    assert q.tolist() == [2048, -1024, INT16_MAX]
    assert squared_norm(q) == 2048**2 + 1024**2 + INT16_MAX**2


def test_negative_values_map_to_field():
    assert field_encode(np.array([-1, 3])) == [str(BN254_P - 1), "3"]


def test_bitmap():
    assert to_bitmap([0, 2, 3]) == 0b1101
