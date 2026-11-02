# contracts/verifier

`Groth16Verifier.sol` will be **generated**, not written by hand, with
`snarkjs zkey export solidityverifier` once the trusted setup for the
norm-bound circuit (`circuits/norm_bound.circom`) is done (next milestone).
The generated contract exposes

```solidity
function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB,
                     uint[2] calldata _pC, uint[4] calldata _pubSignals)
    public view returns (bool);
```

which matches `contracts/interfaces/IGroth16Verifier.sol`, so `RoundManager`
can use it directly. Until it exists, local deployments and tests use
`contracts/mocks/MockVerifier.sol`.

The file is re-generated whenever the circuit or its trusted setup changes,
so it is listed in `.gitignore`.
