import { canonicalId } from "./canonical-records";
import { sha256 } from "./transcript-import";
import {
  all,
  assertId,
  first,
  json,
  now,
  optionalString,
  parseJson,
  requiredString,
  Row,
  stringArray,
} from "./slice3-support";

const GOVERNANCE_ACTIONS = new Set(["approve", "revise", "reject", "defer", "keep_local", "challenge"]);
const SCOPES = new Set(["local", "project_wide", "cross_project"]);

async function requireCurrentFinding(db: D1Database, projectId: string, findingId: string) {
  const finding = await first<Row>(db.prepare(
    `SELECT f.*, v.proposal_statement, v.proposed_scope, v.conditions, v.exclusions,
            v.supporting_evidence, v.counterevidence, v.uncertainty,
            v.reason_for_surfacing, v.expected_retrieval_effect, v.proposal_hash,
            v.created_by AS version_created_by
     FROM findings f
     JOIN finding_versions v ON v.id = f.current_version_id AND v.project_id = f.project_id
     WHERE f.id = ? AND f.project_id = ? LIMIT 1`,
  ).bind(findingId, projectId));
  if (!finding) throw new Error("Finding not found.");
  return finding;
}

function authorityFor(action: string, scope: string, priorAuthority: string) {
  if (action === "approve") {
    if (scope === "local") return "approved_local";
    if (scope === "project_wide") return "approved_project_wide";
    throw new Error("Cross-project authority requires a later governed transfer.");
  }
  if (action === "keep_local") return "approved_local";
  if (action === "revise") return "under_review";
  if (action === "reject") return "rejected";
  if (action === "challenge") return "challenged";
  return priorAuthority;
}

function statusFor(action: string) {
  if (action === "approve" || action === "keep_local") return "approved";
  if (action === "revise") return "under_review";
  if (action === "reject") return "rejected";
  if (action === "defer") return "deferred";
  return "challenged";
}

function retrievalEffectFor(action: string, authority: string) {
  if (action === "approve" || action === "keep_local") {
    return authority === "approved_project_wide"
      ? "eligible_project_wide"
      : "eligible_local_case";
  }
  if (action === "reject") return "suppressed_unchanged_proposal";
  if (action === "challenge") return "excluded_from_governing_use";
  return "no_authoritative_retrieval_effect";
}

async function reviewedVersion(
  finding: Row,
  body: Row,
  action: string,
  actorId: string,
  createdAt: string,
) {
  const currentStatement = String(finding.proposal_statement);
  const reviewedStatement = optionalString(body.reviewedStatement) || currentStatement;
  const proposedScope = action === "keep_local"
    ? "local"
    : optionalString(body.scope) || String(finding.proposed_scope);
  if (!SCOPES.has(proposedScope)) throw new Error("Invalid governance scope.");
  const conditions = body.conditions === undefined
    ? parseJson<string[]>(finding.conditions, [])
    : stringArray(body.conditions, "Conditions");
  const exclusions = body.exclusions === undefined
    ? parseJson<string[]>(finding.exclusions, [])
    : stringArray(body.exclusions, "Exclusions");
  const supportingEvidence = body.supportingEvidence === undefined
    ? parseJson<string[]>(finding.supporting_evidence, [])
    : stringArray(body.supportingEvidence, "Supporting evidence");
  const counterevidence = body.counterevidence === undefined
    ? parseJson<string[]>(finding.counterevidence, [])
    : stringArray(body.counterevidence, "Counterevidence");
  const uncertainty = body.uncertainty === undefined
    ? optionalString(finding.uncertainty)
    : optionalString(body.uncertainty);
  const versionValue = {
    proposalStatement: reviewedStatement,
    proposedScope,
    conditions,
    exclusions,
    supportingEvidence,
    counterevidence,
    uncertainty,
    reasonForSurfacing: String(finding.reason_for_surfacing),
    expectedRetrievalEffect: String(finding.expected_retrieval_effect),
  };
  if (
    action === "revise"
    && reviewedStatement === currentStatement
    && proposedScope === finding.proposed_scope
    && json(conditions) === finding.conditions
    && json(exclusions) === finding.exclusions
    && json(supportingEvidence) === finding.supporting_evidence
    && json(counterevidence) === finding.counterevidence
    && uncertainty === finding.uncertainty
  ) {
    throw new Error("A revision must change the reviewed finding.");
  }
  return {
    ...versionValue,
    id: canonicalId("finding-version"),
    proposalHash: await sha256(JSON.stringify(versionValue)),
    createdBy: actorId,
    createdAt,
    supersedesVersionId: String(finding.current_version_id),
  };
}

function insertFindingVersion(db: D1Database, projectId: string, findingId: string, version: Awaited<ReturnType<typeof reviewedVersion>>) {
  return db.prepare(
    `INSERT INTO finding_versions (
      id, project_id, finding_id, proposal_statement, proposed_scope,
      conditions, exclusions, supporting_evidence, counterevidence,
      uncertainty, reason_for_surfacing, expected_retrieval_effect,
      proposal_hash, created_by, created_at, supersedes_version_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    version.id,
    projectId,
    findingId,
    version.proposalStatement,
    version.proposedScope,
    json(version.conditions),
    json(version.exclusions),
    json(version.supportingEvidence),
    json(version.counterevidence),
    version.uncertainty,
    version.reasonForSurfacing,
    version.expectedRetrievalEffect,
    version.proposalHash,
    version.createdBy,
    version.createdAt,
    version.supersedesVersionId,
  );
}

async function createMechanismStatements(
  db: D1Database,
  projectId: string,
  finding: Row,
  version: Awaited<ReturnType<typeof reviewedVersion>>,
  authority: string,
  actorId: string,
  createdAt: string,
) {
  if (finding.finding_type !== "mechanism_recognition") {
    return { statements: [] as D1PreparedStatement[], mechanismId: null, mechanismVersionId: null };
  }
  const mechanismId = `mechanism:${(await sha256(`${projectId}\n${finding.id}`)).slice(0, 32)}`;
  const existing = await first<Row>(db.prepare(
    "SELECT * FROM mechanisms WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(mechanismId, projectId));
  const mechanismVersionId = canonicalId("mechanism-version");
  const statements: D1PreparedStatement[] = [];
  if (!existing) {
    statements.push(db.prepare(
      `INSERT INTO mechanisms (
        id, project_id, source_finding_id, current_governing_version_id,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, 'proposed', ?, ?)`,
    ).bind(mechanismId, projectId, finding.id, createdAt, createdAt));
  }
  statements.push(
    db.prepare(
      `INSERT INTO mechanism_versions (
        id, project_id, mechanism_id, statement, scope_conditions, exclusions,
        supporting_case_ids, supporting_node_ids, counterevidence_ids,
        reality_contact, authority_state, intended_retrieval_effect,
        created_by, created_at, supersedes_version_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      mechanismVersionId,
      projectId,
      mechanismId,
      version.proposalStatement,
      json(version.conditions),
      json(version.exclusions),
      json([finding.case_id]),
      json(version.counterevidence),
      optionalString(finding.uncertainty),
      authority,
      version.expectedRetrievalEffect,
      actorId,
      createdAt,
      existing?.current_governing_version_id || null,
    ),
    db.prepare(
      `UPDATE mechanisms
       SET current_governing_version_id = ?, status = 'active', updated_at = ?
       WHERE id = ? AND project_id = ?`,
    ).bind(mechanismVersionId, createdAt, mechanismId, projectId),
  );
  return { statements, mechanismId, mechanismVersionId };
}

async function governanceResponse(db: D1Database, projectId: string, eventId: string, idempotentReplay: boolean) {
  const event = await first<Row>(db.prepare(
    "SELECT * FROM governance_events WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(eventId, projectId));
  if (!event) throw new Error("Governance event not found.");
  const finding = await requireCurrentFinding(db, projectId, String(event.target_id));
  const mechanism = event.affected_mechanism_id
    ? await first<Row>(db.prepare(
      `SELECT m.*, v.authority_state, v.statement, v.intended_retrieval_effect
       FROM mechanisms m
       JOIN mechanism_versions v ON v.id = m.current_governing_version_id AND v.project_id = m.project_id
       WHERE m.id = ? AND m.project_id = ? LIMIT 1`,
    ).bind(event.affected_mechanism_id, projectId))
    : null;
  return {
    projectId,
    record: {
      id: finding.id,
      currentVersionId: finding.current_version_id,
      status: finding.status,
      authority: finding.authority_state,
      returnCondition: finding.return_condition,
      expiresAt: finding.expires_at,
    },
    priorAuthority: event.prior_authority,
    newAuthority: event.new_authority,
    priorScope: event.prior_scope,
    newScope: event.new_scope,
    governingVersionId: mechanism?.current_governing_version_id || finding.current_version_id,
    retrievalEffect: event.retrieval_effect,
    governanceEvent: event,
    mechanism,
    timestamp: event.created_at,
    idempotentReplay,
  };
}

export async function governFinding(
  db: D1Database,
  projectId: string,
  findingId: string,
  body: Row,
  idempotencyKey: string,
) {
  const replay = await first<Row>(db.prepare(
    `SELECT id, target_type, target_id
     FROM governance_events
     WHERE project_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(projectId, idempotencyKey));
  if (replay) {
    if (replay.target_type !== "finding" || replay.target_id !== findingId) {
      throw new Error("Idempotency key conflicts with a different governance target.");
    }
    return governanceResponse(db, projectId, String(replay.id), true);
  }

  const finding = await requireCurrentFinding(db, projectId, findingId);
  const sourceVersionId = assertId(body.sourceVersionId, "source version ID");
  if (sourceVersionId !== finding.current_version_id) {
    throw new Error("Finding current version changed; review the latest version before governing.");
  }
  if (["approved", "rejected"].includes(String(finding.status))) {
    throw new Error("Finding is already governed.");
  }
  const action = requiredString(body.action, "Governance action").toLowerCase();
  if (!GOVERNANCE_ACTIONS.has(action)) throw new Error("Unsupported governance action.");
  const actorId = requiredString(body.actorId, "Governance actor");
  const reason = requiredString(body.reason, "Governance reason");
  const returnCondition = optionalString(body.returnCondition);
  const expiresAt = optionalString(body.expiresAt);
  if (action === "defer" && !returnCondition && !expiresAt) {
    throw new Error("Deferral requires a return condition or date.");
  }

  const createdAt = now();
  const priorAuthority = String(finding.authority_state);
  const priorScope = String(finding.proposed_scope);
  const nextScope = action === "keep_local" ? "local" : optionalString(body.scope) || priorScope;
  if (!SCOPES.has(nextScope)) throw new Error("Invalid governance scope.");
  const newAuthority = authorityFor(action, nextScope, priorAuthority);
  const newStatus = statusFor(action);
  const retrievalEffect = retrievalEffectFor(action, newAuthority);
  const createsReviewedVersion = action === "approve" || action === "keep_local" || action === "revise";
  const version = createsReviewedVersion
    ? await reviewedVersion(finding, body, action, actorId, createdAt)
    : null;
  const resultingVersionId = version?.id || sourceVersionId;
  const statements: D1PreparedStatement[] = [];
  if (version) statements.push(insertFindingVersion(db, projectId, findingId, version));

  let mechanismId: string | null = null;
  if ((action === "approve" || action === "keep_local") && version) {
    const mechanismResult = await createMechanismStatements(
      db,
      projectId,
      finding,
      version,
      newAuthority,
      actorId,
      createdAt,
    );
    statements.push(...mechanismResult.statements);
    mechanismId = mechanismResult.mechanismId;
  }

  const eventId = canonicalId("governance");
  statements.push(
    db.prepare(
      `UPDATE findings
       SET current_version_id = ?, status = ?, authority_state = ?, return_condition = ?,
           expires_at = ?, resolved_at = ?
       WHERE id = ? AND project_id = ? AND current_version_id = ?`,
    ).bind(
      resultingVersionId,
      newStatus,
      newAuthority,
      action === "defer" ? returnCondition : null,
      action === "defer" ? expiresAt : null,
      ["approved", "rejected"].includes(newStatus) ? createdAt : null,
      findingId,
      projectId,
      sourceVersionId,
    ),
    db.prepare(
      `INSERT INTO governance_events (
        id, project_id, actor_id, action, target_type, target_id,
        source_version_id, resulting_version_id, prior_authority, new_authority,
        prior_status, new_status, prior_scope, new_scope, affected_mechanism_id,
        rollback_of_event_id, prior_return_condition, new_return_condition,
        prior_expires_at, new_expires_at, reason, retrieval_effect, created_at,
        idempotency_key
      ) VALUES (?, ?, ?, ?, 'finding', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      eventId,
      projectId,
      actorId,
      action,
      findingId,
      sourceVersionId,
      resultingVersionId,
      priorAuthority,
      newAuthority,
      finding.status,
      newStatus,
      priorScope,
      nextScope,
      mechanismId,
      finding.return_condition,
      action === "defer" ? returnCondition : null,
      finding.expires_at,
      action === "defer" ? expiresAt : null,
      reason,
      retrievalEffect,
      createdAt,
      idempotencyKey,
    ),
  );
  await db.batch(statements);
  return governanceResponse(db, projectId, eventId, false);
}

function copiedRollbackVersion(source: Row, actorId: string, currentVersionId: string, createdAt: string) {
  return {
    id: canonicalId("finding-version"),
    proposalStatement: String(source.proposal_statement),
    proposedScope: String(source.proposed_scope),
    conditions: parseJson<string[]>(source.conditions, []),
    exclusions: parseJson<string[]>(source.exclusions, []),
    supportingEvidence: parseJson<string[]>(source.supporting_evidence, []),
    counterevidence: parseJson<string[]>(source.counterevidence, []),
    uncertainty: optionalString(source.uncertainty),
    reasonForSurfacing: String(source.reason_for_surfacing),
    expectedRetrievalEffect: String(source.expected_retrieval_effect),
    proposalHash: String(source.proposal_hash),
    createdBy: actorId,
    createdAt,
    supersedesVersionId: currentVersionId,
  };
}

export async function rollbackGovernance(
  db: D1Database,
  projectId: string,
  eventId: string,
  body: Row,
  idempotencyKey: string,
) {
  const replay = await first<Row>(db.prepare(
    `SELECT id, action, rollback_of_event_id
     FROM governance_events
     WHERE project_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(projectId, idempotencyKey));
  if (replay) {
    if (replay.action !== "rollback" || replay.rollback_of_event_id !== eventId) {
      throw new Error("Idempotency key conflicts with a different governance action.");
    }
    return governanceResponse(db, projectId, String(replay.id), true);
  }
  const original = await first<Row>(db.prepare(
    `SELECT * FROM governance_events
     WHERE id = ? AND project_id = ? AND target_type = 'finding' AND action != 'rollback'
     LIMIT 1`,
  ).bind(eventId, projectId));
  if (!original) throw new Error("Governance event not found.");
  const priorRollback = await first<Row>(db.prepare(
    "SELECT id FROM governance_events WHERE project_id = ? AND rollback_of_event_id = ? LIMIT 1",
  ).bind(projectId, eventId));
  if (priorRollback) throw new Error("Governance event already has a rollback.");
  const latest = await first<Row>(db.prepare(
    `SELECT id FROM governance_events
     WHERE project_id = ? AND target_type = 'finding' AND target_id = ?
     ORDER BY rowid DESC LIMIT 1`,
  ).bind(projectId, original.target_id));
  if (!latest || latest.id !== eventId) {
    throw new Error("A newer governance event must be rolled back first.");
  }
  const finding = await requireCurrentFinding(db, projectId, String(original.target_id));
  if (finding.current_version_id !== original.resulting_version_id) {
    throw new Error("Finding current version no longer matches the governance result.");
  }
  const source = await first<Row>(db.prepare(
    "SELECT * FROM finding_versions WHERE id = ? AND project_id = ? AND finding_id = ? LIMIT 1",
  ).bind(original.source_version_id, projectId, finding.id));
  if (!source) throw new Error("Governance source version not found.");
  const actorId = requiredString(body.actorId, "Governance actor");
  const reason = requiredString(body.reason, "Rollback reason");
  const createdAt = now();
  const rollbackVersion = copiedRollbackVersion(source, actorId, String(finding.current_version_id), createdAt);
  const rollbackEventId = canonicalId("governance");
  const statements: D1PreparedStatement[] = [
    insertFindingVersion(db, projectId, String(finding.id), rollbackVersion),
    db.prepare(
      `UPDATE findings
       SET current_version_id = ?, status = ?, authority_state = ?,
           return_condition = ?, expires_at = ?, resolved_at = NULL
       WHERE id = ? AND project_id = ? AND current_version_id = ?`,
    ).bind(
      rollbackVersion.id,
      original.prior_status || "proposed",
      original.prior_authority || "proposed",
      original.prior_return_condition || null,
      original.prior_expires_at || null,
      finding.id,
      projectId,
      finding.current_version_id,
    ),
  ];

  if (original.affected_mechanism_id) {
    const mechanism = await first<Row>(db.prepare(
      `SELECT m.*, v.statement, v.scope_conditions, v.exclusions, v.supporting_case_ids,
              v.supporting_node_ids, v.counterevidence_ids, v.reality_contact,
              v.intended_retrieval_effect
       FROM mechanisms m
       JOIN mechanism_versions v ON v.id = m.current_governing_version_id AND v.project_id = m.project_id
       WHERE m.id = ? AND m.project_id = ? LIMIT 1`,
    ).bind(original.affected_mechanism_id, projectId));
    if (mechanism) {
      const mechanismVersionId = canonicalId("mechanism-version");
      statements.push(
        db.prepare(
          `INSERT INTO mechanism_versions (
            id, project_id, mechanism_id, statement, scope_conditions, exclusions,
            supporting_case_ids, supporting_node_ids, counterevidence_ids,
            reality_contact, authority_state, intended_retrieval_effect,
            created_by, created_at, supersedes_version_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed',
                    'no_authoritative_retrieval_effect', ?, ?, ?)`,
        ).bind(
          mechanismVersionId,
          projectId,
          mechanism.id,
          source.proposal_statement,
          source.conditions,
          source.exclusions,
          json([finding.case_id]),
          mechanism.supporting_node_ids,
          source.counterevidence,
          mechanism.reality_contact,
          actorId,
          createdAt,
          mechanism.current_governing_version_id,
        ),
        db.prepare(
          `UPDATE mechanisms
           SET current_governing_version_id = ?, status = 'proposed', updated_at = ?
           WHERE id = ? AND project_id = ?`,
        ).bind(mechanismVersionId, createdAt, mechanism.id, projectId),
      );
    }
  }

  statements.push(db.prepare(
    `INSERT INTO governance_events (
      id, project_id, actor_id, action, target_type, target_id,
      source_version_id, resulting_version_id, prior_authority, new_authority,
      prior_status, new_status, prior_scope, new_scope, affected_mechanism_id,
      rollback_of_event_id, prior_return_condition, new_return_condition,
      prior_expires_at, new_expires_at, reason, retrieval_effect, created_at,
      idempotency_key
    ) VALUES (?, ?, ?, 'rollback', 'finding', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    rollbackEventId,
    projectId,
    actorId,
    finding.id,
    finding.current_version_id,
    rollbackVersion.id,
    original.new_authority,
    original.prior_authority,
    finding.status,
    original.prior_status,
    original.new_scope,
    original.prior_scope,
    original.affected_mechanism_id,
    eventId,
    finding.return_condition,
    original.prior_return_condition,
    finding.expires_at,
    original.prior_expires_at,
    reason,
    "prior_authority_restored_no_history_rewritten",
    createdAt,
    idempotencyKey,
  ));
  await db.batch(statements);
  return governanceResponse(db, projectId, rollbackEventId, false);
}

export async function eligibleMechanisms(db: D1Database, projectId: string, caseId?: string | null) {
  const rows = await all<Row>(db.prepare(
    `SELECT m.id, m.project_id, m.source_finding_id, m.status,
            m.current_governing_version_id, v.statement, v.scope_conditions,
            v.exclusions, v.supporting_case_ids, v.counterevidence_ids,
            v.reality_contact, v.authority_state, v.intended_retrieval_effect,
            v.created_at
     FROM mechanisms m
     JOIN mechanism_versions v
       ON v.id = m.current_governing_version_id AND v.project_id = m.project_id
     WHERE m.project_id = ?
       AND m.status = 'active'
       AND v.authority_state IN ('approved_local', 'approved_project_wide')
     ORDER BY v.created_at DESC`,
  ).bind(projectId));
  return rows
    .filter((row) => {
      if (row.authority_state !== "approved_local" || !caseId) return true;
      return parseJson<string[]>(row.supporting_case_ids, []).includes(caseId);
    })
    .map((row) => ({
      ...row,
      scope_conditions: parseJson(row.scope_conditions, []),
      exclusions: parseJson(row.exclusions, []),
      supporting_case_ids: parseJson(row.supporting_case_ids, []),
      counterevidence_ids: parseJson(row.counterevidence_ids, []),
    }));
}
