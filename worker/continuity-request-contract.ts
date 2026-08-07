import { assertId, Row } from "./slice3-support";

export const CONTINUITY_TOKEN_BUDGETS = new Set([400, 800, 1600]);

export type ContinuityRequestInput = Row & {
  task?: unknown;
  requestedOutput?: unknown;
  caseId?: unknown;
  roadwayOverride?: unknown;
  tokenBudget?: unknown;
};

export type ValidatedContinuityRequest = {
  literalTask: string;
  requestedOutput: string | null;
  caseId: string | null;
  roadwayOverride: string | null;
  tokenBudget: number;
};

const ALLOWED_FIELDS = new Set([
  "task",
  "requestedOutput",
  "caseId",
  "roadwayOverride",
  "tokenBudget",
]);

function requiredExactTask(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Task is required.");
  return value;
}

function optionalString(value: unknown, label: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

export function validateContinuityRequest(
  input: ContinuityRequestInput,
): ValidatedContinuityRequest {
  const unsupported = Object.keys(input).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unsupported.length) {
    throw new Error(`Unsupported client-authored continuity field: ${unsupported.sort().join(", ")}.`);
  }

  const literalTask = requiredExactTask(input.task);
  const requestedOutput = optionalString(input.requestedOutput, "Requested output");
  const caseId = optionalString(input.caseId, "Case ID");
  const roadwayOverride = optionalString(input.roadwayOverride, "Roadway override");
  const tokenBudget = input.tokenBudget === undefined ? 800 : input.tokenBudget;
  if (typeof tokenBudget !== "number" || !CONTINUITY_TOKEN_BUDGETS.has(tokenBudget)) {
    throw new Error("Token budget must be exactly 400, 800, or 1600.");
  }
  if (caseId) assertId(caseId, "case ID");
  if (roadwayOverride) assertId(roadwayOverride, "roadway override");

  return {
    literalTask,
    requestedOutput,
    caseId,
    roadwayOverride,
    tokenBudget,
  };
}

export function canonicalContinuityInput(request: ValidatedContinuityRequest): Row {
  return {
    task: request.literalTask,
    ...(request.requestedOutput ? { requestedDecisionOrOutput: request.requestedOutput } : {}),
    ...(request.caseId ? { caseId: request.caseId } : {}),
    ...(request.roadwayOverride ? { roadwayOverride: request.roadwayOverride } : {}),
    tokenBudget: request.tokenBudget,
  };
}
