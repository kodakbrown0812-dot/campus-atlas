import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const RUN = new URL("../fixtures/part3/runs/run-004/", import.meta.url);
const SOURCE = new URL("../run-002/source-fixture.json", RUN);
const RUBRIC = new URL("../run-002/rubric.json", RUN);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function words(value) {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

async function bytes(name) {
  return readFile(new URL(name, RUN));
}

const artifactNames = [
  "engine-output.json",
  "compression.json",
  "lineage.json",
  "room-outputs.json",
  "scorecard.json",
  "result.json",
];

const [sourceBytes, rubricBytes, ...artifactBytes] = await Promise.all([
  readFile(SOURCE),
  readFile(RUBRIC),
  ...artifactNames.map(bytes),
]);
const artifacts = Object.fromEntries(artifactNames.map((name, index) => [
  name,
  JSON.parse(artifactBytes[index].toString("utf8")),
]));
const engine = artifacts["engine-output.json"];
const compression = artifacts["compression.json"];
const lineage = artifacts["lineage.json"];
const outputs = artifacts["room-outputs.json"];
const scorecard = artifacts["scorecard.json"];
const result = artifacts["result.json"];
const compiled = engine.compiledContent;

assert.equal(sha256(sourceBytes), "c07cdf8848e2504975f9357a118f5118f95da3e64f7c4be0e58ce64f2e1840d2");
assert.equal(sha256(rubricBytes), "dd63f39221e45fa47f41ec3df4de127abbd2539f7c7e152c03cc666fff64b6e3");
assert.equal(JSON.parse(sourceBytes).transcript.length, 43);

assert.equal(engine.governingMechanismsSupplied, 7);
assert.ok(Object.values(engine.mechanismTreatments).every((value) => value === "Use"));
assert.ok(Object.values(engine.requiredClaimCoverage).every((value) => value === "claim_fully_supplied"));
assert.equal(engine.packetPreservationGatePassed, true);
assert.equal(engine.irrelevantMechanismLeakage, false);
assert.equal(engine.productionChanged, false);
for (const line of compiled.split("\n").filter((value) => /^- \[USE\].*Mechanism:/.test(value))) {
  assert.doesNotMatch(line, /…/, `atomic mechanism was truncated: ${line}`);
}
assert.match(compiled, /Room Transfer is current for V1\.8 and supersedes Mock Company/i);
assert.match(compiled, /Atlas became too complicated, so prove the continuity primitive/i);
assert.match(compiled, /destination outputs frozen before applying the fixed score/i);
assert.match(compiled, /larger company trials remain deferred until behavior, reduction, causal preservation, and lineage checks close/i);
assert.match(compiled, /reuse governed-continuity machinery, keep interaction simple, and prepare the smallest useful context/i);
assert.match(compiled, /preserve Exact sources, correction and supersession semantics, and Inspect lineage/i);

assert.equal(Buffer.byteLength(compiled, "utf8"), compression.atlas.utf8Bytes);
assert.equal([...compiled].length, compression.atlas.characters);
assert.equal(words(compiled), compression.atlas.whitespaceWords);
assert.equal(Math.ceil(compiled.length / 4), compression.atlas.estimatedTokens);
assert.equal(compression.source.estimatedTokens, 4057);
assert.equal(compression.atlas.estimatedTokens, 694);
assert.equal(compression.comparison.estimatedTokens.percentageReduction, 82.893764);
assert.equal(compression.reductionThresholdPassed, true);

assert.equal(lineage.summary.completeLineageClaims, 7);
assert.equal(lineage.summary.governedLineageOnlyClaims, 0);
assert.equal(lineage.summary.missingExactSourceLinkClaims, 0);
assert.ok(lineage.claims.every(({ classification }) => classification === "complete_lineage"));

assert.equal(outputs.status, "frozen_before_scoring");
assert.equal(outputs.protocol.outputsFrozenBeforeScoring, true);
assert.equal(outputs.protocol.freshRooms, 2);
assert.notEqual(outputs.baseline.threadId, outputs.atlas.threadId);
for (const room of [outputs.baseline, outputs.atlas]) {
  assert.ok(room.initialOutput);
  assert.ok(room.challengeOutput);
  assert.ok(room.proofConditionsOutput);
}

assert.equal(scorecard.scoredAfterOutputsFrozen, true);
assert.equal(scorecard.baseline.score, 20);
assert.equal(scorecard.atlas.score, 20);
assert.equal(scorecard.comparison.scoreDeltaAtlasMinusBaseline, 0);
assert.equal(scorecard.comparison.outcome, "parity");
assert.equal(scorecard.comparison.staleMockCompanyReactivated, false);
assert.equal(scorecard.comparison.abandonedBranchReactivated, false);
assert.equal(scorecard.comparison.expiredStateRevived, false);
assert.equal(scorecard.comparison.irrelevantContamination, false);
assert.equal(scorecard.comparison.inventedProjectState, false);
assert.equal(result.status, "passed");
assert.equal(result.firstRemainingFailure, null);
assert.equal(result.productionChanged, false);

const manifestBytes = await bytes("manifest.json");
const manifest = JSON.parse(manifestBytes.toString("utf8"));
for (const [name, expected] of Object.entries(manifest.artifacts)) {
  assert.equal(sha256(await bytes(name)), expected, `${name} changed after freeze`);
}
assert.equal(manifest.fixtureSha256, sha256(sourceBytes));
assert.equal(manifest.rubricSha256, sha256(rubricBytes));
assert.equal(manifest.compiledContentSha256, sha256(compiled));
assert.equal(manifest.productionChanged, false);

console.log("Part 3E atomic-preservation proof artifacts verified.");
