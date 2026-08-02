import { parseJson, Row } from "./slice3-support";

const EXPLICIT_CONFLICT_CUES = [
  /\bcontradicts?\b/i,
  /\bsupersedes?\b/i,
  /\breplaces?\b/i,
  /\bno longer\b/i,
  /\bmust not\b/i,
  /\bshould not\b/i,
  /\bcannot\b/i,
  /\b(?:prior|previous|earlier)\b.{0,60}\b(?:wrong|incorrect|false|invalid|unsupported)\b/i,
];

function ids(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : typeof value === "string" && value.length > 0
      ? [value]
      : [];
}

function correctionDeclaresConflict(event: Row) {
  const metadata = parseJson<Record<string, unknown>>(event.metadata, {});
  const referencedConflict = [
    metadata.conflictsWithEventIds,
    metadata.correctsEventIds,
    metadata.supersedesEventIds,
    metadata.challengedRecordId,
  ].some((value) => ids(value).length > 0);
  if (referencedConflict) return true;
  const statement = String(event.exact_source_span || event.compressed_representation || "");
  return EXPLICIT_CONFLICT_CUES.some((cue) => cue.test(statement));
}

export function unresolvedConflictEvent(events: Row[]) {
  return events.find((event) => {
    const type = String(event.event_type).toLowerCase();
    if (type === "challenge") return true;
    return type === "correction" && correctionDeclaresConflict(event);
  }) || null;
}

export function hasUnresolvedConflict(events: Row[]) {
  return unresolvedConflictEvent(events) !== null;
}
