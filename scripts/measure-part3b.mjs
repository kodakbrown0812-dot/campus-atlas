import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const PATHS = {
  fixture: "fixtures/part3/supersession-proof.v1.json",
  engine: "fixtures/part3/runs/run-001/engine-output.json",
  outputs: "fixtures/part3/runs/run-001/room-outputs.json",
  score: "fixtures/part3/runs/run-001/score.json",
  result: "fixtures/part3/runs/run-001/compression.json",
};
const FROZEN_SHA256 = {
  fixture: "a1507d67350a1ec6512efa69bbc607439b0b9470d95131295187b85b38712306",
  engine: "e78c29d4ceabbde68ebb85ee6348cc84a47f221ffd66745cc94cdcaea388fa34",
  outputs: "51bc8255db3b8d91daedb325c7d75b10fa72ffd3b70e53b5863797c65bdb5764",
  score: "13cb7c1e5ff0ff4e4be4b1d1a54a1cc8a1f6324cbb874bf5c4a43bc21501c1bb",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function round(value) {
  return Number(value.toFixed(6));
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

function framedSequenceHash(parts) {
  const framed = Buffer.concat(parts.flatMap((value) => {
    const content = Buffer.from(value, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(content.length);
    return [length, content];
  }));
  return sha256(framed);
}

function comparison(source, atlas) {
  return Object.fromEntries([
    ["utf8Bytes", "bytes"],
    ["characters", "characters"],
    ["whitespaceWords", "words"],
    ["estimatedTokens", "estimatedTokens"],
  ].map(([field, name]) => [name, {
    atlasSizeOverSourceSize: round(atlas[field] / source[field]),
    compressionRatioSourceOverAtlas: round(source[field] / atlas[field]),
    percentageReduction: round(((source[field] - atlas[field]) / source[field]) * 100),
    absoluteContextSaved: source[field] - atlas[field],
  }]));
}

async function readFrozen(name) {
  const bytes = await readFile(new URL(PATHS[name], ROOT));
  assert.equal(sha256(bytes), FROZEN_SHA256[name], `${PATHS[name]} changed after freeze`);
  return JSON.parse(bytes.toString("utf8"));
}

export async function measurePart3B() {
  const [fixture, engine, outputs, score] = await Promise.all([
    readFrozen("fixture"),
    readFrozen("engine"),
    readFrozen("outputs"),
    readFrozen("score"),
  ]);
  assert.equal(fixture.fixtureVersion, "part3-supersession-v1");
  assert.equal(engine.runId, "part3-supersession-run-001");
  assert.equal(outputs.status, "frozen_before_scoring");
  assert.equal(score.status, "scored");

  const sourceMessages = fixture.corpus.baselineTranscript.map(({ text }) => text);
  const compiledContent = engine.packet.compiledContent;
  const sourceCounts = counts(sourceMessages);
  const atlasCounts = counts([compiledContent]);
  assert.equal(atlasCounts.estimatedTokens, engine.packet.finalTokenCount);

  return {
    schemaVersion: 1,
    runId: engine.runId,
    measurement: "part3b-smallest-useful-context",
    inputs: {
      source: {
        identity: `${PATHS.fixture}#corpus.baselineTranscript[].text`,
        artifactSha256: FROZEN_SHA256.fixture,
        contentSequenceSha256: framedSequenceHash(sourceMessages),
        messageCount: sourceMessages.length,
        boundary: "Exact UTF-8 message-body values in sequence order; counts are aggregated without invented separator bytes.",
        counts: sourceCounts,
      },
      atlas: {
        identity: `${PATHS.engine}#packet.compiledContent`,
        artifactSha256: FROZEN_SHA256.engine,
        compiledContentSha256: sha256(compiledContent),
        packetId: engine.packet.id,
        counts: atlasCounts,
      },
      frozenArtifacts: {
        destinationOutputsSha256: FROZEN_SHA256.outputs,
        scorecardSha256: FROZEN_SHA256.score,
      },
    },
    countingMethod: {
      bytes: "Buffer.byteLength(value, 'utf8')",
      characters: "Unicode code points via spread iteration",
      words: "Non-empty runs separated by Unicode whitespace",
      tokens: "Estimate only: ceil(total UTF-16 code units / 4), matching worker/packet-service.ts; no receiving-model tokenizer is present.",
      sharedPromptTreatment: "The common task and receiving-room transport instructions are excluded; only project-context payloads are compared.",
    },
    comparison: comparison(sourceCounts, atlasCounts),
    behavior: {
      baselineScore: score.baseline.score,
      atlasScore: score.atlas.score,
      scoreDeltaAtlasMinusBaseline: score.comparison.scoreDeltaAtlasMinusBaseline,
      prohibitedBaselineClaims: score.baseline.prohibitedClaimsObserved,
      prohibitedAtlasClaims: score.atlas.prohibitedClaimsObserved,
      requiredBehavioralCriteriaLost: [],
      outcome: score.comparison.outcome,
    },
    preservation: {
      part3Current: "explicitly_preserved",
      mockCompanyHistoricalRatherThanCurrent: "preserved_semantically_but_not_with_explicit_prior-plan_wording",
      explicitSupersession: "not_preserved_in_compiled_content",
      reasonForChange: "not_preserved; the source's proof-closure gating condition was beyond the compacted text",
      importantImplementationConstraints: "partially_preserved; Full packet and two-room comparison remain, while challenge, freeze, score, Inspect, and proof-closure conditions are truncated",
      currentNextAction: "preserved: run Part 3 and compile one Full packet",
      stalePlanChallengeSupport: "behaviorally_sufficient_in_this_run_but_textually_inferred",
      irrelevantFixtureMaterialDelivered: false,
    },
    excludedMaterial: [
      {
        source: "baselineTranscript[0].text",
        category: "omitted_because_superseded_and_unnecessary",
        summary: "The affirmative stale Mock Company decision was not delivered.",
        safety: "Safe for the observed task because version 2 was current, the packet said not to begin Mock Company, and the frozen Atlas room still rejected the stale-plan challenge.",
      },
      {
        source: "baselineTranscript metadata",
        category: "omitted_because_source_only_evidence_did_not_need_delivery",
        summary: "Sequence numbers, timestamps, and speaker labels were not delivered.",
        safety: "Safe for the accepted behavioral score, but their omission prevents the packet itself from proving which statement was later.",
      },
      {
        source: "baselineTranscript[1].text correction marker and closing supersession sentence",
        category: "other_material_omitted_by_compaction",
        summary: "The literal correction marker and explicit sentence that the new decision superseded the old one were not delivered.",
        safety: "The frozen model inferred supersession and scored correctly; general safety is not established by this one fixture.",
      },
      {
        source: "baselineTranscript[1].text compacted tail",
        category: "other_material_omitted_by_compaction",
        summary: "The adversarial challenge, freeze, scoring, Inspect, deferral condition, and proof-closure details were truncated.",
        safety: "Safe for the observed score only; exact implementation-constraint preservation was partial.",
      },
    ],
    categoriesNotPresent: [
      "omitted_because_irrelevant",
      "omitted_because_repeated_or_redundant",
    ],
    lineage: {
      acceptedPart3InspectLineageVerified: score.inspectLineageVerified,
      governedClaim: {
        mechanismId: engine.receipt.currentMechanismId,
        versionId: engine.receipt.currentMechanismVersionId,
        governanceEventId: engine.receipt.governanceEventId,
        supersedesVersionId: engine.inspect.versions.find(({ status }) => status === "active").supersedesVersionId,
        packetUsageCount: engine.inspect.packetUsageCount,
      },
      roadwayClaim: {
        roadwayId: engine.roadway.id,
        roadwayVersionId: engine.roadway.versionId,
        requiredChecksSupplied: 5,
      },
      exactSourceEvidence: {
        fixturePointer: `${PATHS.fixture}#corpus.baselineTranscript[1].text`,
        inspectSourceFindingId: null,
        inspectCanTraceToCanonicalExactEvent: false,
      },
      status: "partial: governing version, correction, supersession, and packet usage are traceable; canonical exact-source evidence is not linked in the frozen Inspect snapshot",
    },
    supportedConclusion: "On this deterministic fixture, Atlas preserved the same accepted fresh-room continuation behavior as the complete corrected-transcript baseline, but the governed Full packet was larger than the two-message source context on every measured size metric.",
    limitations: [
      "This minimal source fixture is too small to demonstrate context compression because fixed packet scaffolding dominates.",
      "The compacted packet omits explicit supersession wording and several implementation constraints even though the receiving model inferred them and scored 10/10.",
      "The frozen Inspect snapshot traces governed version lineage but not the mechanism back to a canonical exact source event.",
      "Token counts are deterministic estimates, not receiving-model tokenizer counts.",
      "One synthetic fixture does not establish a universal ratio, arbitrary-project reliability, or broad-ingestion readiness.",
    ],
    productionChanged: false,
  };
}

const result = await measurePart3B();
if (process.argv.includes("--check")) {
  const committed = JSON.parse(await readFile(new URL(PATHS.result, ROOT), "utf8"));
  assert.deepEqual(committed, result);
  console.log(`Part 3B measurement deterministic: ${result.runId}`);
} else {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
