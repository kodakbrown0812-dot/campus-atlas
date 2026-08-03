export type Roadway = {
  id: string;
  versionId: string;
  slug: string;
  name: string;
  version: number;
  purpose: string;
  requiredChecks: string[];
  authorityState: string;
};

export type Interpretation = {
  literalRequest: string;
  requestedDecisionOrOutput: string;
  activeProjectId: string;
  caseId: string | null;
  caseObjective: string | null;
  caseContextUsedForMatching: boolean;
  domain: string;
  taskOrMarketType: string;
  timeSensitivity: string;
  scope: string;
  requiredReasoningMechanism: string;
  relevantSharedMeanings: string[];
  materialAmbiguity: boolean;
  clarificationRequired: boolean;
  ambiguityReason: string | null;
  primaryRoadway: Roadway | null;
  candidateInterpretations: Array<{
    roadwayId: string;
    versionId: string;
    name: string;
    reason: string;
  }>;
  supportingModules: string[];
  requiredLiveState: string[];
  selectionReason: string;
  userSelectedOverride: boolean;
};

export type TreatmentItem = {
  sourceType: string;
  sourceId: string;
  sourceVersionId: string | null;
  statement: string;
  treatment: "Use" | "Consider" | "Exclude";
  representation: string;
  scope: string;
  authority: string;
  freshness: string;
  status?: string;
  caseId?: string | null;
  reason: string;
  governanceEventId?: string | null;
  counterevidenceIds?: string[];
  protectedRole?: string | null;
  packetEligibleProtected?: boolean;
  ranking?: {
    evidenceStrength?: number;
  };
  metadata?: Record<string, unknown>;
};

export type CandidatePreview = {
  status:
    | "ready"
    | "clarification_required"
    | "missing_required_state"
    | "unsafe_under_selected_budget";
  interpretation: Interpretation;
  treatmentSummary: Record<"Use" | "Consider" | "Exclude", TreatmentItem[]>;
  candidateSummary: {
    discovered: number;
    used: number;
    considered: number;
    excluded: number;
    redundantRecordsRemoved: number;
    lineageRecordsRetained: number;
    protectedCorrectionsRetained: number;
    strongestChallengeRetained: boolean;
  };
  requiredChecks: TreatmentItem[];
  protectedCorrections: TreatmentItem[];
  protectedConflicts: TreatmentItem[];
  strongestChallenge: TreatmentItem | null;
  importantExclusions: TreatmentItem[];
  freshness: {
    required: string[];
    missing: string[];
    safeToCompile: boolean;
  };
  tokenBudget: number;
  estimatedSafeMinimum: number | null;
  estimatedFinalSize: number | null;
  likelyCompression: boolean;
  packetCreated: false;
};

export type PacketResult = {
  packet: {
    id: string;
    version: number;
    projectId: string;
    caseId: string | null;
    task: string;
    inferredIntent: string;
    interpretation: Interpretation;
    primaryRoadwayId: string;
    primaryRoadwayVersionId: string;
    supportingModules: string[];
    tokenBudget: number;
    finalTokenCount: number;
    compiledContent: string;
    compilationError: string | null;
    priorComparablePacketId: string | null;
    status: string;
    createdAt: string;
  };
  items?: Array<Record<string, unknown>>;
  receipt: {
    id: string;
    packetId: string;
    literalRequest: string;
    inferredIntent: string;
    selectedRoadwayReason: string;
    alternatives: Array<Record<string, unknown>>;
    supportingModules: string[];
    treatmentSummary: Record<"Use" | "Consider" | "Exclude", TreatmentItem[]>;
    governanceCauses: Array<{
      governanceEventId: string;
      sourceId?: string;
      effect: string;
      correctnessClaim?: false;
    }>;
    freshness: { required: string[]; missing: string[]; safeToCompile: boolean };
    inferenceDisclosure: string;
    unresolvedConflicts: Array<{ sourceId: string; statement: string }>;
    exactPacketDifference: Array<Record<string, unknown>>;
    tokenBudget: number;
    finalTokenCount: number;
    authorityAndScope: Record<string, unknown>;
    priorComparablePacketId: string | null;
    createdAt: string;
  };
};

export type ReceivingModel = {
  provider: string;
  model: string;
  production: boolean;
};

export type HandoffResult = {
  handoff: {
    id: string;
    projectId: string;
    packetId: string;
    originalTask: string;
    packetSnapshotHash: string;
    primaryRoadwayId: string;
    primaryRoadwayVersionId: string;
    provider: string;
    model: string;
    actorId: string;
    status: "pending" | "sent" | "completed" | "failed";
    createdAt: string;
    terminalAt: string | null;
    failureCategory: string | null;
    failureReason: string | null;
    additionalLiveRetrieval: {
      performed: boolean;
      requested: boolean;
      retrievedAt: string | null;
      tools: Array<{ type: string; identity: string | null }>;
      reliedOnNewerStateThanPacket: boolean | null;
    };
  };
  packet: PacketResult["packet"];
  packetItems: Array<Record<string, unknown>>;
  packetReceipt: PacketResult["receipt"];
  answer: {
    id: string;
    providerResponseId: string;
    provider: string;
    model: string;
    answerText: string;
    answerTimestamp: string;
    canonicalMessageReference: string | null;
  } | null;
  receipt: {
    id: string;
    packetReceiptId: string;
    lineage: Array<Record<string, unknown>>;
    treatmentSummary: Record<"Use" | "Consider" | "Exclude", TreatmentItem[]>;
    authorityAndScope: Record<string, unknown>;
    freshness: Record<string, unknown>;
    inferenceDisclosure: string | null;
    priorComparablePacketId: string | null;
    exactPacketDifference: Array<Record<string, unknown>>;
    causalPacketDifference: Array<Record<string, unknown>>;
    governanceCauses: Array<{ governanceEventId: string; effect: string }>;
    unresolvedConflicts: Array<{ sourceId: string; statement: string }>;
    strongestChallenges: Array<Record<string, unknown>>;
    corrections: Array<Record<string, unknown>>;
    historicalLimitations: Array<Record<string, unknown>>;
    additionalLiveRetrieval: HandoffResult["handoff"]["additionalLiveRetrieval"];
    finalAnswerReference: Record<string, unknown> | null;
    honestyStatement: string;
    createdAt: string;
  } | null;
  lifecycle: Array<{
    id: string;
    status: string;
    providerResponseId: string | null;
    failureCategory: string | null;
    failureReason: string | null;
    additionalLiveRetrieval: HandoffResult["handoff"]["additionalLiveRetrieval"];
    createdAt: string;
  }>;
};

export type PacketSummary = {
  id: string;
  task: string;
  inferredIntent: string;
  primaryRoadwayId: string;
  primaryRoadwayVersionId: string;
  tokenBudget: number;
  finalTokenCount: number;
  priorComparablePacketId: string | null;
  status: string;
  compilationError: string | null;
  createdAt: string;
};

export type HandoffSummary = {
  id: string;
  projectId: string;
  packetId: string;
  originalTask: string;
  provider: string;
  model: string;
  status: string;
  failureCategory: string | null;
  failureReason: string | null;
  createdAt: string;
  answerId: string | null;
  providerResponseId: string | null;
  answerTimestamp: string | null;
  receiptId: string | null;
};
