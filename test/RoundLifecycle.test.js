// Draft tests for the parts of ZK-FedChain implemented in this milestone:
// membership and stake (Registry) and the Commit/Reveal phases (RoundManager).
// The Groth16 verifier is replaced by MockVerifier until the circuit is built.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const MIN_STAKE = ethers.parseEther("1");
const STEP = 600; // seconds per phase
const DUMMY_PROOF = { a: [0, 0], b: [[0, 0], [0, 0]], c: [0, 0] };
const Phase = { None: 0, Commit: 1, Reveal: 2, Aggregate: 3 };

const CONFIG = {
  commitDuration: STEP,
  revealDuration: STEP,
  aggregateDuration: STEP,
  challengeDuration: STEP,
  normBoundSq: 1n << 40n,
  rewardPerUpdate: ethers.parseEther("10"),
  aggregatorReward: ethers.parseEther("5"),
  aggregatorBond: ethers.parseEther("0.5"),
  invalidProofPenalty: ethers.parseEther("0.3"),
  noRevealPenalty: ethers.parseEther("0.1"),
  aggregatorTimeoutPenalty: ethers.parseEther("0.4"),
  badAggregatePenalty: ethers.parseEther("0.6"),
};

async function deployFixture() {
  const [admin, treasury, ...rest] = await ethers.getSigners();
  const members = rest.slice(0, 4);

  const token = await ethers.deployContract("FedRewardToken", [admin.address]);
  const registry = await ethers.deployContract("Registry", [MIN_STAKE, treasury.address, admin.address]);
  const verifier = await ethers.deployContract("MockVerifier");
  const rm = await ethers.deployContract("RoundManager", [
    registry, verifier, token, CONFIG, ethers.id("genesis-adapter"), "ipfs://genesis", admin.address,
  ]);

  await registry.grantRole(await registry.PROTOCOL_ROLE(), rm);
  await token.grantRole(await token.MINTER_ROLE(), rm);

  for (const m of members) {
    await registry.addMember(m.address);
    await registry.connect(m).depositStake({ value: MIN_STAKE });
  }
  return { admin, members, token, registry, verifier, rm };
}

async function startRound(ctx) {
  await ctx.rm.startRound();
  const roundId = await ctx.rm.currentRoundId();
  const round = await ctx.rm.getRound(roundId);
  const clients = ctx.members.filter((m) => m.address !== round.aggregator);
  return { roundId, round, clients };
}

describe("Registry", function () {
  it("tracks membership and stake eligibility", async function () {
    const { registry, members } = await loadFixture(deployFixture);
    expect(await registry.memberCount()).to.equal(4);
    expect(await registry.isEligible(members[0].address)).to.equal(true);

    await registry.connect(members[0]).withdrawStake(MIN_STAKE / 2n);
    expect(await registry.isEligible(members[0].address)).to.equal(false);
  });

  it("only lets allow-listed members stake", async function () {
    const { registry } = await loadFixture(deployFixture);
    const [, , , , , , outsider] = await ethers.getSigners();
    await expect(registry.connect(outsider).depositStake({ value: MIN_STAKE })).to.be.revertedWithCustomError(
      registry,
      "NotMember",
    );
  });
});

describe("RoundManager: commit and reveal (draft)", function () {
  it("starts a round with a staked aggregator and fixed deadlines", async function () {
    const ctx = await loadFixture(deployFixture);
    const { round } = await startRound(ctx);
    expect(round.phase).to.equal(Phase.Commit);
    expect(await ctx.registry.isEligible(round.aggregator)).to.equal(true);
    expect(round.revealDeadline - round.commitDeadline).to.equal(STEP);
  });

  it("accepts a valid proof, locks stake, and moves to Reveal", async function () {
    const ctx = await loadFixture(deployFixture);
    const { roundId, clients } = await startRound(ctx);

    await expect(ctx.rm.connect(clients[0]).submitUpdate(roundId, 123, DUMMY_PROOF))
      .to.emit(ctx.rm, "UpdateSubmitted")
      .withArgs(roundId, clients[0].address, 123, 0);
    await expect(ctx.registry.connect(clients[0]).withdrawStake(1)).to.be.revertedWithCustomError(
      ctx.registry,
      "StakeIsLocked",
    );

    await time.increase(STEP + 1);
    await ctx.rm.advancePhase(roundId);
    await ctx.rm.connect(clients[0]).revealUpdate(roundId, "ipfs://update-0", 42);
    const sub = await ctx.rm.getSubmission(roundId, clients[0].address);
    expect(sub.revealed).to.equal(true);
    expect(sub.updateCID).to.equal("ipfs://update-0");
  });

  it("slashes a client whose proof fails verification", async function () {
    const ctx = await loadFixture(deployFixture);
    const { roundId, clients } = await startRound(ctx);
    await ctx.verifier.setResult(false);

    await expect(ctx.rm.connect(clients[0]).submitUpdate(roundId, 7, DUMMY_PROOF))
      .to.emit(ctx.rm, "ProofRejected")
      .withArgs(roundId, clients[0].address);
    expect(await ctx.registry.stakeOf(clients[0].address)).to.equal(MIN_STAKE - CONFIG.invalidProofPenalty);
  });

  it("rejects a second submission from the same client", async function () {
    const ctx = await loadFixture(deployFixture);
    const { roundId, clients } = await startRound(ctx);
    await ctx.rm.connect(clients[0]).submitUpdate(roundId, 1, DUMMY_PROOF);
    await expect(ctx.rm.connect(clients[0]).submitUpdate(roundId, 1, DUMMY_PROOF)).to.be.revertedWithCustomError(
      ctx.rm,
      "AlreadySubmitted",
    );
  });
});
