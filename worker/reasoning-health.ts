import { Row, all, first, parseJson } from "./slice3-support";

export const REASONING_HEALTH_STATES = [
  "Forming",
  "Missing information",
  "Awaiting decision",
  "Awaiting outcome",
  "Awaiting governance",
  "Conflict",
] as const;

export type ReasoningHealthState = typeof REASONING_HEALTH_STATES[number];

export type ReasoningHealth = {
  state: ReasoningHealthState;
  cause: {
    type: "conversation" | "case" | "event" | "finding";
    id: string;
    label: string;
    href: string;
  };
  recommendedNextAction: string;
  latestCheckpoint: {
    id: string;
    status: string;
    trigger: string;
    selectedCount: number;
    omittedCount: number;
    completedAt: string | null;
  } | null;
  pendingFindingCount: number;
  derivedAt: string;
};

function eventPriority(type: string) {
  if (type === "challenge" || type === "correction") return 0;
  if (type === "unknown") return 1;
  if (type === "decision") return 2;
  if (type === "outcome") return 3;
  return 4;
}

function eventHref(projectId: string, conversationId: string, eventId: string) {
  return `/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}#event-${encodeURIComponent(eventId)}`;
}

export async function reasoningHealthForConversation(
  db: D1Database,
  projectId: string,
  conversationId: string,
  activeCaseId: string | null,
): Promise<ReasoningHealth> {
  const derivedAt = new Date().toISOString();
  if (!activeCaseId) {
    return {
      state: "Forming",
      cause: {
        type: "conversation",
        id: conversationId,
        label: "No active case is selected.",
        href: `/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`,
      },
      recommendedNextAction: "Create or select an active case.",
      latestCheckpoint: null,
      pendingFindingCount: 0,
      derivedAt,
    };
  }

  const [caseRecord, events, pendingFindings, latestCheckpoint] = await Promise.all([
    first<Row>(db.prepare(
      "SELECT * FROM cases WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(activeCaseId, projectId)),
    all<Row>(db.prepare(
      `SELECT DISTINCT e.*
       FROM events e
       LEFT JOIN case_event_attachments a
         ON a.project_id = e.project_id AND a.event_id = e.id
       WHERE e.project_id = ? AND e.conversation_id = ?
         AND (
           (e.case_id = ? AND e.assignment_state = 'assigned')
           OR (a.case_id = ? AND a.ended_at IS NULL)
         )
       ORDER BY e.ingested_at DESC, e.id DESC`,
    ).bind(projectId, conversationId, activeCaseId, activeCaseId)),
    all<Row>(db.prepare(
      `SELECT f.*, v.proposal_statement
       FROM findings f
       JOIN finding_versions v ON v.id = f.current_version_id AND v.project_id = f.project_id
       WHERE f.project_id = ? AND f.case_id = ?
         AND f.status IN ('proposed', 'under_review', 'deferred', 'challenged')
       ORDER BY f.created_at DESC`,
    ).bind(projectId, activeCaseId)),
    first<Row>(db.prepare(
      `SELECT * FROM checkpoints
       WHERE project_id = ? AND conversation_id = ? AND case_id = ?
       ORDER BY started_at DESC LIMIT 1`,
    ).bind(projectId, conversationId, activeCaseId)),
  ]);

  const checkpoint = latestCheckpoint ? {
    id: String(latestCheckpoint.id),
    status: String(latestCheckpoint.status),
    trigger: String(latestCheckpoint.trigger),
    selectedCount: Number(latestCheckpoint.selected_count || 0),
    omittedCount: Number(latestCheckpoint.omitted_count || 0),
    completedAt: latestCheckpoint.completed_at ? String(latestCheckpoint.completed_at) : null,
  } : null;
  const actionableFinding = pendingFindings.find((finding) =>
    ["proposed", "under_review", "challenged"].includes(String(finding.status)),
  );
  const deferredFinding = pendingFindings.find((finding) => String(finding.status) === "deferred");
  const sortedEvents = [...events].sort((a, b) => {
    const priority = eventPriority(String(a.event_type).toLowerCase()) - eventPriority(String(b.event_type).toLowerCase());
    return priority || String(b.ingested_at).localeCompare(String(a.ingested_at));
  });
  const conflict = sortedEvents.find((event) =>
    ["challenge", "correction"].includes(String(event.event_type).toLowerCase()),
  );
  const unknown = sortedEvents.find((event) => String(event.event_type).toLowerCase() === "unknown");
  const decision = sortedEvents.find((event) => String(event.event_type).toLowerCase() === "decision");
  const outcome = sortedEvents.find((event) => String(event.event_type).toLowerCase() === "outcome");

  if (conflict) {
    return {
      state: "Conflict",
      cause: {
        type: "event",
        id: String(conflict.id),
        label: String(conflict.exact_source_span),
        href: eventHref(projectId, conversationId, String(conflict.id)),
      },
      recommendedNextAction: "Review the correction or challenge before relying on this case.",
      latestCheckpoint: checkpoint,
      pendingFindingCount: pendingFindings.length,
      derivedAt,
    };
  }
  if (actionableFinding) {
    return {
      state: "Awaiting governance",
      cause: {
        type: "finding",
        id: String(actionableFinding.id),
        label: String(actionableFinding.proposal_statement),
        href: `/projects/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(String(actionableFinding.id))}`,
      },
      recommendedNextAction: "Review the atomic Atlas Found proposal.",
      latestCheckpoint: checkpoint,
      pendingFindingCount: pendingFindings.length,
      derivedAt,
    };
  }
  if (decision && !outcome) {
    return {
      state: "Awaiting outcome",
      cause: {
        type: "event",
        id: String(decision.id),
        label: String(decision.exact_source_span),
        href: eventHref(projectId, conversationId, String(decision.id)),
      },
      recommendedNextAction: "Record what happened when the outcome is available.",
      latestCheckpoint: checkpoint,
      pendingFindingCount: pendingFindings.length,
      derivedAt,
    };
  }
  if (unknown) {
    return {
      state: "Missing information",
      cause: {
        type: "event",
        id: String(unknown.id),
        label: String(unknown.exact_source_span),
        href: eventHref(projectId, conversationId, String(unknown.id)),
      },
      recommendedNextAction: "Resolve or explicitly carry the missing information.",
      latestCheckpoint: checkpoint,
      pendingFindingCount: pendingFindings.length,
      derivedAt,
    };
  }
  if (events.length > 0 && !decision) {
    const event = events[0];
    return {
      state: "Awaiting decision",
      cause: {
        type: "event",
        id: String(event.id),
        label: String(event.exact_source_span),
        href: eventHref(projectId, conversationId, String(event.id)),
      },
      recommendedNextAction: "Continue the conversation until the decision is explicit.",
      latestCheckpoint: checkpoint,
      pendingFindingCount: pendingFindings.length,
      derivedAt,
    };
  }

  const caseCore = parseJson<Record<string, unknown>>(caseRecord?.case_core, {});
  return {
    state: "Forming",
    cause: {
      type: "case",
      id: activeCaseId,
      label: String(caseRecord?.objective || caseCore.objective || "The active case is still forming."),
      href: `/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}#active-case`,
    },
    recommendedNextAction: deferredFinding
      ? "Continue the case until the deferred finding's return condition is met."
      : checkpoint
        ? "Continue the conversation or run Analyze now after a meaningful change."
        : "Continue the conversation, then run Analyze now.",
    latestCheckpoint: checkpoint,
    pendingFindingCount: pendingFindings.length,
    derivedAt,
  };
}
