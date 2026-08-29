import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [rolloutPath, outputDir, cutoffTimestamp] = process.argv.slice(2);
assert.ok(rolloutPath, "rollout path is required");
assert.ok(outputDir, "output directory is required");
assert.ok(cutoffTimestamp, "cutoff timestamp is required");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const rawRollout = await readFile(rolloutPath, "utf8");
const lines = rawRollout.split(/\n/u);
const messages = [];
const attachments = new Map();
let cutoffFound = false;

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  if (!line) continue;
  const record = JSON.parse(line);
  if (record.timestamp > cutoffTimestamp) break;
  if (record.type !== "event_msg") continue;
  const payload = record.payload || {};
  if (payload.type !== "user_message" && payload.type !== "agent_message") continue;
  const content = String(payload.message || "");
  const role = payload.type === "user_message" ? "user" : "assistant";
  const sourceMessageKey = `rollout-line:${index + 1}`;
  messages.push({
    id: sourceMessageKey,
    role,
    actorId: role === "user" ? "cody" : "atlas-codex",
    timestamp: record.timestamp,
    text: content,
    metadata: {
      source: "codex-visible-event",
      phase: payload.phase || null,
      rolloutLine: index + 1,
    },
  });

  for (const match of content.matchAll(/\/Users\/codythomas\/\.codex\/attachments\/[^\s`"<>]+\/pasted-text\.txt/gu)) {
    const attachmentPath = match[0];
    if (attachments.has(attachmentPath)) continue;
    const bytes = await readFile(attachmentPath);
    const attachment = {
      id: `attachment:${sha256(bytes).slice(0, 24)}`,
      role: "tool",
      actorId: "user-attachment",
      timestamp: record.timestamp,
      text: bytes.toString("utf8"),
      metadata: {
        source: "user-pasted-text-attachment",
        sha256: sha256(bytes),
        byteLength: bytes.length,
        introducedBy: sourceMessageKey,
      },
    };
    attachments.set(attachmentPath, attachment);
    messages.push(attachment);
  }

  if (record.timestamp === cutoffTimestamp && payload.type === "user_message") cutoffFound = true;
}

assert.equal(cutoffFound, true, "the exact user-message cutoff was not found");
assert.equal(messages.at(-1)?.role, "user", "the frozen room must end on the prospective user request");

const structured = `${JSON.stringify({
  schemaVersion: 1,
  sourceThreadId: "01a02cca-f76c-7330-950c-82640956a65c",
  sourceTitle: "Continue Campus Atlas",
  cutoffTimestamp,
  messages,
}, null, 2)}\n`;
const baseline = `${messages.map((message) => {
  const label = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "Attachment";
  return `${label}:\n${message.text}`;
}).join("\n\n")}\n`;
const contentParts = messages.map(({ text }) => text);
const counts = {
  messages: messages.length,
  userMessages: messages.filter(({ role }) => role === "user").length,
  assistantMessages: messages.filter(({ role }) => role === "assistant").length,
  attachments: messages.filter(({ role }) => role === "tool").length,
  utf8Bytes: contentParts.reduce((total, value) => total + Buffer.byteLength(value, "utf8"), 0),
  characters: contentParts.reduce((total, value) => total + [...value].length, 0),
  whitespaceWords: contentParts.reduce((total, value) => total + (value.trim() ? value.trim().split(/\s+/u).length : 0), 0),
  estimatedTokens: Math.ceil(contentParts.reduce((total, value) => total + value.length, 0) / 4),
};
const manifest = `${JSON.stringify({
  schemaVersion: 1,
  runId: "authentic-full-transfer-run-001",
  source: {
    threadId: "01a02cca-f76c-7330-950c-82640956a65c",
    title: "Continue Campus Atlas",
    cutoffTimestamp,
    boundary: "Visible user and assistant room messages through the prospective proof request, plus exact pasted-text attachment bytes at first reference. Hidden instructions, reasoning, tool calls, and command output are excluded.",
  },
  counts,
  hashes: {
    structuredImportSha256: sha256(structured),
    baselineInputSha256: sha256(baseline),
    contentSequenceSha256: sha256(Buffer.concat(contentParts.flatMap((value) => {
      const content = Buffer.from(value, "utf8");
      const length = Buffer.alloc(4);
      length.writeUInt32BE(content.length);
      return [length, content];
    }))),
  },
  attachments: [...attachments.values()].map(({ id, metadata }) => ({ id, ...metadata })),
  privacy: "Exact authentic source is frozen locally and intentionally excluded from the public repository. Only hashes and aggregate measurements belong in the proof branch.",
}, null, 2)}\n`;

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDir, "source-room.json"), structured),
  writeFile(path.join(outputDir, "baseline-input.txt"), baseline),
  writeFile(path.join(outputDir, "source-manifest.json"), manifest),
]);
process.stdout.write(manifest);
