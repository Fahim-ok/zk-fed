// ZK-FedChain terminal demo: one training round, step by step.
//
//   npx hardhat run scripts/demo.js
//
// Runs on Hardhat's in-process chain, so nothing needs to be started first.
// Every on-chain action is printed with the stakeholder who performed it.
// Set SKIP_DISPUTE=1 to stop after round 1 (shorter demo).
//
// Note: proofs are checked by MockVerifier here so the demo runs in seconds.
// The real snarkjs Groth16Verifier has the same interface (IGroth16Verifier).
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ---------- console helpers ----------
const C = { b: "\x1b[1m", dim: "\x1b[2m", g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", x: "\x1b[0m" };
const step = (n, title) => console.log(`\n${C.b}${C.c}STEP ${n}  ${title}${C.x}`);
const ok = (who, msg) => console.log(`  ${C.g}✔${C.x} ${C.b}${who.padEnd(11)}${C.x} ${msg}`);
const bad = (who, msg) => console.log(`  ${C.r}✘${C.x} ${C.b}${who.padEnd(11)}${C.x} ${msg}`);
const info = (msg) => console.log(`  ${C.dim}${msg}${C.x}`);
const eth = (wei) => `${Number(ethers.formatEther(wei)).toFixed(2)} ETH`;
const fcr = (wei) => `${Number(ethers.formatEther(wei)).toFixed(0)} FCR`;
const short = (h) => `${h.slice(0, 10)}…`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY = Number(process.env.DEMO_DELAY_MS || 350); // slows output so viewers can follow

const PHASES = ["None", "Commit", "Reveal", "Aggregate", "Challenge", "Disputed", "Finalized"];
const PROOF = { a: [0, 0], b: [[0, 0], [0, 0]], c: [0, 0] };
const STEP_SECONDS = 600;

const CONFIG = {
  commitDuration: STEP_SECONDS,
  revealDuration: STEP_SECONDS,
  aggregateDuration: STEP_SECONDS,
  challengeDuration: STEP_SECONDS,
  normBoundSq: 1n << 40n,
  rewardPerUpdate: ethers.parseEther("10"),
  aggregatorReward: ethers.parseEther("5"),
  aggregatorBond: ethers.parseEther("0.5"),
  invalidProofPenalty: ethers.parseEther("0.3"),
  noRevealPenalty: ethers.parseEther("0.1"),
  aggregatorTimeoutPenalty: ethers.parseEther("0.4"),
  badAggregatePenalty: ethers.parseEther("0.6"),
};

async function main() {
  const [admin, treasury, ...rest] = await ethers.getSigners();
  const names = ["Hospital-A", "Hospital-B", "Bank-C", "Insurer-D", "Clinic-E"];
  const members = rest.slice(0, names.length).map((s, i) => ({ signer: s, name: names[i], addr: s.address }));
  const nameOf = (addr) => (members.find((m) => m.addr === addr) || { name: addr.slice(0, 8) }).name;

  console.log(`${C.b}ZK-FedChain demo — blockchain-governed federated fine-tuning${C.x}`);
  info("Local Hardhat chain · proofs checked by MockVerifier (same interface as the Groth16 verifier)");

  // ---------------------------------------------------------------
  step(1, "Deploy the contracts (Admin = consortium governance)");
  const token = await ethers.deployContract("FedRewardToken", [admin.address]);
  const registry = await ethers.deployContract("Registry", [ethers.parseEther("1"), treasury.address, admin.address]);
  const verifier = await ethers.deployContract("MockVerifier");
  const genesis = ethers.id("genesis-adapter");
  const rm = await ethers.deployContract("RoundManager", [
    registry, verifier, token, CONFIG, genesis, "ipfs://genesis-adapter", admin.address,
  ]);
  const dr = await ethers.deployContract("DisputeResolver", [
    registry, rm, ethers.parseEther("0.2"), STEP_SECONDS, 2, admin.address,
  ]);
  await registry.grantRole(await registry.PROTOCOL_ROLE(), rm);
  await registry.grantRole(await registry.PROTOCOL_ROLE(), dr);
  await token.grantRole(await token.MINTER_ROLE(), rm);
  await rm.grantRole(await rm.DISPUTE_RESOLVER_ROLE(), dr);
  for (const [n, c] of [["Registry", registry], ["RoundManager", rm], ["DisputeResolver", dr], ["FedRewardToken", token]]) {
    ok("Admin", `deployed ${n.padEnd(16)} at ${short(await c.getAddress())}`);
  }
  await pause(DELAY);

  // ---------------------------------------------------------------
  step(2, "Organizations join the consortium and lock a deposit (stake)");
  for (const m of members) {
    await registry.addMember(m.addr);
    await registry.connect(m.signer).depositStake({ value: ethers.parseEther("1") });
    ok(m.name, `joined and staked 1.00 ETH`);
    await pause(DELAY / 3);
  }

  // ---------------------------------------------------------------
  step(3, "Start training round 1 (anyone can start it — no central server)");
  await rm.startRound();
  let roundId = await rm.currentRoundId();
  let round = await rm.getRound(roundId);
  const aggregator = members.find((m) => m.addr === round.aggregator);
  ok("Contract", `round ${roundId} opened in phase ${PHASES[round.phase]}`);
  ok("Contract", `${aggregator.name} selected as this round's aggregator`);
  info(`starts from global model ${short(round.prevModelHash)}`);
  const clients = members.filter((m) => m !== aggregator);
  const [c1, c2, c3, attacker] = clients;
  await pause(DELAY);

  // ---------------------------------------------------------------
  step(4, "Commit phase: each client trains locally and submits commitment + ZK proof");
  for (const [i, c] of [c1, c2, c3].entries()) {
    const commitment = BigInt(ethers.id(`update-${c.name}`)) % (1n << 250n);
    const rc = await (await rm.connect(c.signer).submitUpdate(roundId, commitment, PROOF)).wait();
    ok(c.name, `proof verified on-chain → update accepted  ${C.dim}(gas ${rc.gasUsed})${C.x}`);
    await pause(DELAY);
  }
  await verifier.setResult(false); // the next proof will fail verification
  const before = await registry.stakeOf(attacker.addr);
  await rm.connect(attacker.signer).submitUpdate(roundId, 999n, PROOF);
  const after = await registry.stakeOf(attacker.addr);
  bad(attacker.name, `sent an oversized (poisoned) update → proof FAILED, ${eth(before - after)} stake slashed`);
  await verifier.setResult(true);
  await pause(DELAY);

  // ---------------------------------------------------------------
  step(5, "Reveal phase: clients publish where their update is stored (IPFS)");
  await time.increase(STEP_SECONDS + 1);
  await rm.advancePhase(roundId);
  for (const [i, c] of [c1, c2, c3].entries()) {
    await rm.connect(c.signer).revealUpdate(roundId, `ipfs://update-${c.name}`, 1000 + i);
    ok(c.name, `revealed ipfs://update-${c.name}`);
  }
  await time.increase(STEP_SECONDS + 1);
  await rm.advancePhase(roundId);
  await pause(DELAY);

  // ---------------------------------------------------------------
  step(6, "Aggregate phase: aggregator combines updates off-chain (Multi-Krum) and posts the result");
  const model1 = ethers.id("global-adapter-round-1");
  // Multi-Krum kept updates 0 and 1 and filtered update 2 (bitmap 0b011).
  await rm.connect(aggregator.signer).postAggregate(roundId, model1, "ipfs://global-r1", 0b011, { value: CONFIG.aggregatorBond });
  ok(aggregator.name, `posted new model ${short(model1)} with a 0.50 ETH bond`);
  info(`accepted: ${c1.name}, ${c2.name}   filtered by Multi-Krum: ${c3.name}`);
  info("challenge window is now open — any member can dispute the result");
  await pause(DELAY);

  // ---------------------------------------------------------------
  step(7, "Finalize: no challenge, so rewards are paid and the model is recorded");
  await time.increase(STEP_SECONDS + 1);
  await rm.finalizeRound(roundId);
  const [latest] = await rm.latestModel();
  ok("Contract", `round ${roundId} finalized; global model is now ${short(latest)}`);
  await printTable(members, registry, token, aggregator);

  if (process.env.SKIP_DISPUTE) return done();

  // ---------------------------------------------------------------
  step(8, "Round 2: the aggregator cheats, a member challenges, the others vote");
  await rm.startRound();
  roundId = await rm.currentRoundId();
  round = await rm.getRound(roundId);
  const agg2 = members.find((m) => m.addr === round.aggregator);
  // Members whose stake fell below the minimum (e.g. after slashing) can no longer take part.
  const eligible = [];
  for (const m of members) if (m !== agg2 && (await registry.isEligible(m.addr))) eligible.push(m);
  const cl2 = eligible;
  info(`${members.find((m) => !eligible.includes(m) && m !== agg2)?.name || "nobody"} is excluded: stake below the 1.00 ETH minimum after slashing`);
  for (const [i, c] of cl2.slice(0, 3).entries()) {
    await rm.connect(c.signer).submitUpdate(roundId, 5000 + i, PROOF);
  }
  await time.increase(STEP_SECONDS + 1);
  await rm.advancePhase(roundId);
  for (const [i, c] of cl2.slice(0, 3).entries()) {
    await rm.connect(c.signer).revealUpdate(roundId, `ipfs://r2-update-${i}`, 7 + i);
  }
  await time.increase(STEP_SECONDS + 1);
  await rm.advancePhase(roundId);
  ok("Clients", "3 clients committed and revealed their updates");
  await rm.connect(agg2.signer).postAggregate(roundId, ethers.id("wrong-model"), "ipfs://wrong", 0b111, { value: CONFIG.aggregatorBond });
  bad(agg2.name, "posted a WRONG aggregate (does not match the revealed updates)");
  await pause(DELAY);

  const [challenger, v1, v2] = cl2;
  await dr.connect(challenger.signer).openChallenge(roundId, ethers.id("correct-model"), "ipfs://evidence", { value: ethers.parseEther("0.2") });
  ok(challenger.name, "re-ran the aggregation, got a different hash → opened a challenge (0.20 ETH bond)");
  const disputeId = await dr.disputeOfRound(roundId);
  await dr.connect(v1.signer).castVote(disputeId, true);
  ok(v1.name, "re-checked and voted: aggregate is wrong");
  await dr.connect(v2.signer).castVote(disputeId, true);
  ok(v2.name, "re-checked and voted: aggregate is wrong");
  await time.increase(STEP_SECONDS + 1);
  await dr.resolve(disputeId);
  bad(agg2.name, `aggregate OVERTURNED → ${eth(CONFIG.badAggregatePenalty)} slashed, bond paid to ${challenger.name}`);
  const [latest2] = await rm.latestModel();
  info(`global model unchanged: ${short(latest2)} (bad model never accepted)`);
  await printTable(members, registry, token, agg2);
  done();
}

async function printTable(members, registry, token, aggregator) {
  console.log(`\n  ${C.b}${"Member".padEnd(12)}${"Stake".padStart(10)}${"Reputation".padStart(12)}${"Rewards".padStart(10)}${C.x}`);
  for (const m of members) {
    const stake = await registry.stakeOf(m.addr);
    const rep = await registry.reputationOf(m.addr);
    const bal = await token.balanceOf(m.addr);
    const tag = m === aggregator ? `${C.dim} (aggregator)${C.x}` : "";
    console.log(`  ${m.name.padEnd(12)}${eth(stake).padStart(10)}${String(rep).padStart(12)}${fcr(bal).padStart(10)}${tag}`);
  }
}

function done() {
  console.log(`\n${C.b}${C.g}Demo complete.${C.x}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
