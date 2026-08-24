import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const RUN = new URL("../fixtures/part3/runs/run-003/", import.meta.url);
const SOURCE = new URL("../run-002/source-fixture.json", RUN);
const RUBRIC = new URL("../run-002/rubric.json", RUN);

async function bytes(name) {
  return readFile(new URL(name, RUN));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function words(value) {
  return value.trim().split(/\s+/u).length;
}

const [sourceBytes, rubricBytes, engineBytes, compressionBytes, failureBytes, lineageBytes, outputsBytes, scorecardBytes, manifestBytes] = await Promise.all([
  readFile(SOURCE),
  readFile(RUBRIC),
  bytes("engine-output.json"),
  bytes("compression.json"),
  bytes("failure.json"),
  bytes("lineage.json"),
  bytes("room-outputs.json"),
  bytes("scorecard.json"),
  bytes("manifest.json"),
]);

const source = JSON.parse(sourceBytes);
const engine = JSON.parse(engineBytes);
const compression = JSON.parse(compressionBytes);
const failure = JSON.parse(failureBytes);
const lineage = JSON.parse(lineageBytes);
const outputs = JSON.parse(outputsBytes);
const scorecard = JSON.parse(scorecardBytes);
const manifest = JSON.parse(manifestBytes);

assert.equal(sha256(sourceBytes), engine.fixtureSha256);
assert.equal(sha256(rubricBytes), engine.rubricSha256);
assert.equal(source.transcript.length, 43);
assert.equal(engine.governingMechanismsSupplied, 7);
assert.ok(Object.values(engine.mechanismTreatments).every((value) => value === "Use"));

const compiled = engine.compiledContent;
assert.equal(Buffer.byteLength(compiled, "utf8"), compression.atlas.utf8Bytes);
assert.equal([...compiled].length, compression.atlas.characters);
assert.equal(words(compiled), compression.atlas.whitespaceWords);
assert.equal(Math.ceil(compiled.length / 4), compression.atlas.estimatedTokens);
assert.equal(compression.comparison.estimatedTokens.percentageReduction, 82.524033);
assert.equal(compression.reductionThresholdPassed, true);

assert.match(compiled, /outputs frozen before applying…/i);
assert.doesNotMatch(compiled, /outputs frozen before (?:applying )?(?:the )?(?:fixed )?(?:rubric|score|scoring)/i);
assert.equal(engine.semanticCoverage.frozenBeforeScoring, false);
assert.equal(engine.packetPreservationGatePassed, false);
assert.equal(failure.classification, "required_governed_context_truncated_in_compiled_content");
assert.equal(failure.runtimeRepairAttemptedAfterFailure, false);

assert.equal(lineage.summary.completeLineageClaims, 7);
assert.equal(lineage.summary.missingExactSourceLinkClaims, 0);
assert.ok(lineage.claims.every(({ classification }) => classification === "complete_lineage"));
assert.equal(outputs.status, "frozen_unscored_diagnostic");
for (const room of [outputs.baseline, outputs.atlas]) {
  assert.ok(room.initialOutput);
  assert.ok(room.challengeOutput);
  assert.ok(room.proofConditionsOutput);
}
assert.equal(scorecard.baselineScore, null);
assert.equal(scorecard.atlasScore, null);
assert.match(scorecard.status, /not_scored/);

for (const [name, expected] of Object.entries(manifest.artifacts)) {
  assert.equal(sha256(await bytes(name)), expected, name);
}
assert.equal(manifest.fixtureSha256, sha256(sourceBytes));
assert.equal(manifest.rubricSha256, sha256(rubricBytes));
assert.equal(manifest.compiledContentSha256, sha256(compiled));
assert.equal(manifest.productionChanged, false);

console.log("Part 3D frozen failure artifacts verified.");
