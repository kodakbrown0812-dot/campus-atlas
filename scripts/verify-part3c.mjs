import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../fixtures/part3/runs/run-002/", import.meta.url);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function counts(parts) {
  const utf16CodeUnits = parts.reduce((total, value) => total + value.length, 0);
  return {
    utf8Bytes: parts.reduce((total, value) => total + Buffer.byteLength(value, "utf8"), 0),
    characters: parts.reduce((total, value) => total + [...value].length, 0),
    whitespaceWords: parts.reduce(
      (total, value) => total + (value.trim() ? value.trim().split(/\s+/u).length : 0),
      0,
    ),
    estimatedTokens: Math.ceil(utf16CodeUnits / 4),
  };
}

const manifest = JSON.parse(await readFile(new URL("manifest.json", ROOT), "utf8"));
const artifacts = {};
for (const [name, expectedHash] of Object.entries(manifest.artifacts)) {
  const bytes = await readFile(new URL(name, ROOT));
  assert.equal(sha256(bytes), expectedHash, `${name} changed after freeze`);
  artifacts[name] = JSON.parse(bytes.toString("utf8"));
}

const fixture = artifacts["source-fixture.json"];
const rubric = artifacts["rubric.json"];
const engine = artifacts["engine-output.json"];
const compression = artifacts["compression.json"];
const rooms = artifacts["room-outputs.json"];
const scorecard = artifacts["scorecard.json"];
const lineage = artifacts["lineage.json"];
const failure = artifacts["failure.json"];

assert.equal(fixture.status, "frozen_before_execution");
assert.equal(rubric.status, "frozen_before_execution");
assert.equal(fixture.transcript.length, 43);
assert.equal(Math.ceil(fixture.transcript.reduce((total, entry) => total + entry.text.length, 0) / 4), 4057);
assert.deepEqual(counts(fixture.transcript.map(({ text }) => text)), {
  utf8Bytes: 16233,
  characters: 16227,
  whitespaceWords: 2396,
  estimatedTokens: 4057,
});

const compiledContent = engine.response.packet.compiledContent;
assert.equal(sha256(compiledContent), manifest.compiledContentSha256);
assert.deepEqual(counts([compiledContent]), {
  utf8Bytes: 968,
  characters: 968,
  whitespaceWords: 135,
  estimatedTokens: 242,
});
assert.equal(engine.response.summary.governingMechanismsSupplied, 0);
assert.equal(engine.packetPreservation.gatePassed, false);
assert.equal(engine.projectMechanismTreatments.length, 7);
assert.ok(engine.projectMechanismTreatments.every(({ treatment }) => treatment !== "Use"));
assert.equal(compression.comparison.estimatedTokens.percentageReduction, 94.035001);
assert.equal(compression.reductionThresholdPassed, true);
assert.equal(compression.continuitySuccess, false);
assert.equal(rooms.status, "not_run_due_packet_preservation_failure");
assert.equal(scorecard.behavioralScoringPerformed, false);
assert.equal(lineage.summary.completeLineageClaims, 7);
assert.equal(lineage.summary.projectClaimsActuallySupplied, 0);
assert.equal(failure.classification, "required_governed_context_not_supplied");
assert.equal(failure.runtimeRepairAttempted, false);
assert.equal(failure.productionChanged, false);

console.log(`Part 3C stopped proof deterministic: ${fixture.runId}`);
