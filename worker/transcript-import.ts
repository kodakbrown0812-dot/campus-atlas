export type ImportMessage = {
  actorType: string;
  actorId: string | null;
  exactContent: string;
  originalTimestamp: string | null;
  sourceReference: string | null;
  sourceMessageKey: string | null;
  metadata: Record<string, unknown>;
};

const ACTOR_TYPES = new Set(["user", "assistant", "system", "tool", "unknown"]);

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeActor(value: unknown) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "unknown";
  if (candidate === "human") return "user";
  if (candidate === "ai" || candidate === "model") return "assistant";
  return ACTOR_TYPES.has(candidate) ? candidate : "unknown";
}

export function timestampValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  return null;
}

function messageContent(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) return value.join("");
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.text === "string") return object.text;
    if (Array.isArray(object.parts)) return object.parts.filter((part) => typeof part === "string").join("");
  }
  return "";
}

function structuredMessages(value: unknown): ImportMessage[] {
  let source: unknown[] = [];
  if (Array.isArray(value)) {
    source = value;
  } else if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.messages)) {
      source = object.messages;
    } else if (object.mapping && typeof object.mapping === "object") {
      source = Object.values(object.mapping as Record<string, unknown>)
        .map((entry) => entry && typeof entry === "object" ? (entry as Record<string, unknown>).message : null)
        .filter(Boolean)
        .sort((left, right) => {
          const leftTime = Number((left as Record<string, unknown>).create_time || 0);
          const rightTime = Number((right as Record<string, unknown>).create_time || 0);
          return leftTime - rightTime;
        });
    }
  }

  return source.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const author = record.author && typeof record.author === "object" ? record.author as Record<string, unknown> : {};
    const content = messageContent(record.content ?? record.text);
    if (!content.length) return [];
    const actorId = optionalString(record.actorId ?? record.actor_id ?? author.name);
    const sourceId = optionalString(record.id ?? record.messageId ?? record.message_id);
    return [{
      actorType: normalizeActor(record.role ?? record.actorType ?? record.actor_type ?? author.role),
      actorId,
      exactContent: content,
      originalTimestamp: timestampValue(record.timestamp ?? record.createdAt ?? record.created_at ?? record.create_time),
      sourceReference: optionalString(record.sourceReference ?? record.source_reference ?? sourceId),
      sourceMessageKey: sourceId || `structured:${index + 1}`,
      metadata: {
        originalActor: record.role ?? author.role ?? null,
        originalTimestamp: record.timestamp ?? record.createdAt ?? record.created_at ?? record.create_time ?? null,
      },
    }];
  });
}

function textMessages(rawSource: string): ImportMessage[] {
  const marker = /^(User|Assistant|System|Tool|Cody|Amy):[ \t]?/gim;
  const matches = [...rawSource.matchAll(marker)];
  if (!matches.length) {
    return [{
      actorType: "unknown",
      actorId: null,
      exactContent: rawSource,
      originalTimestamp: null,
      sourceReference: "text:1",
      sourceMessageKey: "text:1",
      metadata: { textEnvelope: "single_exact_source" },
    }];
  }
  return matches.map((match, index) => {
    const contentStart = (match.index || 0) + match[0].length;
    const contentEnd = index + 1 < matches.length ? matches[index + 1].index || rawSource.length : rawSource.length;
    const role = match[1].toLowerCase();
    return {
      actorType: role === "cody" ? "user" : role === "amy" ? "assistant" : normalizeActor(role),
      actorId: role === "cody" || role === "amy" ? role : null,
      exactContent: rawSource.slice(contentStart, contentEnd),
      originalTimestamp: null,
      sourceReference: `text:${index + 1}`,
      sourceMessageKey: `text:${index + 1}`,
      metadata: { sourceMarker: match[0] },
    };
  });
}

export function parseImport(format: string, transcript: unknown) {
  if (format === "text") {
    if (typeof transcript !== "string" || transcript.length === 0) throw new Error("Transcript is required.");
    return {
      rawSource: transcript,
      messages: textMessages(transcript),
      exactEnvelopePreserved: true,
    };
  }
  if (format === "json") {
    const rawSource = typeof transcript === "string" ? transcript : JSON.stringify(transcript);
    if (!rawSource.length) throw new Error("Transcript is required.");
    let parsed = transcript;
    if (typeof transcript === "string") {
      try {
        parsed = JSON.parse(transcript);
      } catch {
        throw new Error("Structured JSON transcript is invalid.");
      }
    }
    const messages = structuredMessages(parsed);
    if (!messages.length) throw new Error("Structured JSON transcript contains no supported messages.");
    return {
      rawSource,
      messages,
      exactEnvelopePreserved: typeof transcript === "string",
    };
  }
  throw new Error("Import format must be text or json.");
}
