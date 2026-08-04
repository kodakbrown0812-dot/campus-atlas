type PacketEligibilityCandidate = {
  treatment?: unknown;
  protectedRole?: unknown;
  status?: unknown;
  authority?: unknown;
  freshness?: unknown;
  metadata?: unknown;
};

const TERMINAL_STATES = new Set(["rejected", "retired", "superseded"]);

function metadata(candidate: PacketEligibilityCandidate) {
  return candidate.metadata && typeof candidate.metadata === "object"
    ? candidate.metadata as Record<string, unknown>
    : {};
}

export function isLineageOnlyPacketAncestor(candidate: PacketEligibilityCandidate) {
  return metadata(candidate).lineageOnly === true;
}

export function isPacketEligibleProtectedItem(candidate: unknown) {
  if (!candidate || typeof candidate !== "object") return false;
  const item = candidate as PacketEligibilityCandidate;
  if (!item.protectedRole || item.protectedRole === "required_check") return false;
  if (item.treatment !== "Use" && item.treatment !== "Consider") return false;
  if (isLineageOnlyPacketAncestor(item)) return false;
  if (TERMINAL_STATES.has(String(item.status || ""))) return false;
  if (TERMINAL_STATES.has(String(item.authority || ""))) return false;
  if (["stale", "superseded"].includes(String(item.freshness || ""))) return false;
  return true;
}
