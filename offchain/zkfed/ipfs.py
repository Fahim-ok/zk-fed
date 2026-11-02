"""Client for the IPFS (Kubo) HTTP API (draft).

Update and model files are stored on a private IPFS cluster run by the
members; only their CIDs are written on-chain.
"""

from __future__ import annotations


class IPFSClient:
    def __init__(self, api_url: str = "http://127.0.0.1:5001"):
        self.api = api_url.rstrip("/") + "/api/v0"

    def add_bytes(self, data: bytes, name: str = "blob") -> str:
        """Uploads and pins bytes; returns the CID. TODO: POST /api/v0/add."""
        raise NotImplementedError

    def cat(self, cid: str) -> bytes:
        """Downloads the content addressed by `cid`. TODO: POST /api/v0/cat."""
        raise NotImplementedError
