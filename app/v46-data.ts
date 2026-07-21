export type ProjectKey = "sports" | "hockey" | "lessons" | "human";
export type Fidelity = "Exact" | "Reconstructed" | "Inferred";
export type GovernanceState = "Draft" | "Pending" | "Approved" | "Challenged" | "Rejected" | "Deferred" | "Retired";
export type WorkflowState = "Captured" | "Needs outcome" | "Needs audit" | "Awaiting review" | "Approved" | "Closed";

export type ProjectDefinition = {
  key: ProjectKey;
  name: string;
  short: string;
  domain: string;
  description: string;
  color: string;
  schema: string[];
};

export type CaseRecord = {
  id: string;
  project: ProjectKey;
  origin: "Seeded example" | "User-created" | "API-created" | "Model inference";
  title: string;
  createdAt: string;
  state: WorkflowState;
  confidence: number;
  outcomeState: "Pending" | "Recorded";
  governanceState: GovernanceState;
  retrievalEligible: boolean;
  experience: string;
  task: string;
  localContext: string;
  thesis: string;
  facts: string[];
  estimates: string[];
  assumptions: string[];
  unknowns: string[];
  counterarguments: string[];
  fragility: string;
  completeness: number;
  outcome: string;
  postmortem: {
    happened: string;
    failed: string;
    held: string;
    underweighted: string;
    change: string;
    evidence: string[];
  };
  proposedKnowledgeId?: string;
  metadata: Record<string, string>;
};

export type EvidenceRecord = {
  id: string;
  project: ProjectKey;
  caseId: string;
  recordType: "Capture" | "Research" | "Evidence" | "Outcome" | "Correction" | "Challenge" | "Observation" | "Proposed learning" | "Approved principle" | "Failure mode";
  content: string;
  source: string;
  fidelity: Fidelity;
  confidence: number;
  role: "Supports" | "Reinforces" | "Challenges" | "Contradicts" | "Refines" | "Supersedes" | "Context";
  creator: string;
  timestamp: string;
  approvalState: GovernanceState;
  retrievalEligible: boolean;
  metadata: Record<string, string>;
};

export type KnowledgeRecord = {
  id: string;
  project: ProjectKey;
  type: "Principle" | "Failure mode" | "Correction" | "Adapted transfer";
  title: string;
  content: string;
  status: GovernanceState;
  scope: string;
  confidence: number;
  humanApproval: string | null;
  supportingCaseIds: string[];
  evidenceIds: string[];
  challengingEvidenceIds: string[];
  revisionHistory: string[];
  retrievalHistory: string[];
  retrievalEligible: boolean;
  metadata: Record<string, string>;
};

export type BlueprintRule = {
  id: string;
  project: ProjectKey;
  content: string;
  version: string;
  status: "Active" | "Proposed" | "Retired";
  supportingCaseIds: string[];
  evidenceIds: string[];
  challengeIds: string[];
  approvalHistory: string[];
  lastRevision: string;
  relatedKnowledgeIds: string[];
  retrievalEffect: string;
};

export type ReviewRecord = {
  id: string;
  project: ProjectKey | "campus";
  type: "Proposed principle" | "Correction" | "Connection" | "Blueprint revision" | "Transfer proposal" | "Retirement proposal" | "Reconstruction pathway";
  title: string;
  proposal: string;
  why: string;
  sourceCaseId?: string;
  supportEvidenceIds: string[];
  challengeEvidenceIds: string[];
  affectedKnowledgeId?: string;
  blueprintEffect: string;
  confidence: number;
  retrievalEffect: string;
  crossProjectConsequence: string;
  status: "Pending" | "Approved" | "Challenged" | "Rejected" | "Deferred";
  targetProject?: ProjectKey;
};

export type ConnectionRecord = {
  id: string;
  project: ProjectKey | "campus";
  sourceId: string;
  targetId: string;
  type: "Supports" | "Challenges" | "Derived from" | "Contradicted by outcome" | "Caused revision of" | "Shares mechanism with" | "Supersedes" | "Retrieved together" | "Produced packet" | "Proposed for transfer";
  explanation: string;
  sharedMechanism: string;
  evidenceIds: string[];
  confidence: number;
  creator: string;
  approvalState: GovernanceState;
  downstreamConsequence: string;
  reconstructionValue: number;
  domainLimitations: string;
};

export type ActivityRecord = {
  id: string;
  project: ProjectKey | "campus";
  actor: string;
  action: string;
  targetId: string;
  targetTitle: string;
  timestamp: string;
  previousState: string;
  newState: string;
  consequence: string;
};

export type PacketRecord = {
  packetId: string;
  task: string;
  project: string;
  blueprint: { project: string; version: string; purpose: string; rules: string[]; capabilities: string[] };
  localContext: null | { content: string; retention: string; expiration: string; captureRequiredForDurability: boolean };
  durableKnowledge: Array<{ id: string; title: string; summary: string; usefulness: number; whyIncluded: string; retrievedBecause?: string[]; source: string; confidence: number; scope: string; freshness: string; fidelity: string; authorityLevel: string; connectionPath: string[]; lineage: string[] }>;
  approvedPrinciples: Array<{ id: string; title: string; summary: string; whyIncluded: string }>;
  supportingCases: Array<{ id: string; title: string; summary: string; whyIncluded: string }>;
  challenges: Array<{ id: string; title: string; reason: string; source: string; status: string }>;
  excluded: Array<{ id: string; title: string; whyExcluded: string }>;
  reconstructionPathways?: Array<{ id: string; sourceProject: string; targetProject: string; sharedMechanism: string; authority: string; recordsFollowed: string[]; contribution: string; domainLimitations: string; selected: boolean; reason: string }>;
  budget: { used: number; limit: number; estimatedTokens: number; requestedTokens?: number };
  compiledPrompt: string;
  contextPacket: string;
  receipt: { id: string; tool: string; proposedBy: string; createdAt: string; checks: string[]; humanApprovalRequired: boolean; inclusions: Array<{ id: string; reason: string }>; exclusions: Array<{ id: string; reason: string }>; labelsApplied?: string[] };
};

export type AtlasState = {
  schemaVersion: 46;
  workspaceId: string;
  cases: CaseRecord[];
  evidence: EvidenceRecord[];
  knowledge: KnowledgeRecord[];
  blueprintRules: BlueprintRule[];
  reviews: ReviewRecord[];
  connections: ConnectionRecord[];
  activities: ActivityRecord[];
  contextPackets: PacketRecord[];
  proofBaseline: PacketRecord | null;
  nodes: Array<Record<string, unknown>>;
};

export const projects: ProjectDefinition[] = [
  { key: "sports", name: "Sports Engine", short: "SE", domain: "Sports analytics", description: "Research decisions, test them against reality, and let earned lessons change what comes next.", color: "#4d7cfe", schema: ["Sport", "League", "Market type", "Decision type", "Case family", "Research status", "Evidence quality", "Shared mechanism", "Failure mode", "Fragility", "Time sensitivity", "Outcome status", "Governance state"] },
  { key: "hockey", name: "Hockey Development", short: "HD", domain: "Game transfer", description: "Connect practice observations to decisions, performance, recovery, and game transfer.", color: "#27d4c7", schema: ["Skill dial", "Game situation", "Zone", "Pressure level", "Decision type", "Technical mechanism", "Game-transfer value", "Development priority", "Confidence", "Development phase"] },
  { key: "lessons", name: "Lessons Division", short: "LD", domain: "Learning systems", description: "Preserve learning paths and the reasoning required to reconstruct technical understanding.", color: "#f4b860", schema: ["Learning objective", "Concept", "Difficulty", "Prerequisite", "Reconstruction value", "Practice state"] },
  { key: "human", name: "Human Systems Lab", short: "HS", domain: "Behavior and development", description: "Test recurring patterns against outcomes without converting observations into automatic truth.", color: "#f58aa8", schema: ["Mechanism", "Context", "Time horizon", "Observed tendency", "Counterevidence", "Confidence"] },
];

export const seededCases: CaseRecord[] = [
  {
    id: "case-england-ghana", project: "sports", origin: "Seeded example", title: "England vs Ghana — heavy-favorite thesis", createdAt: "Jul 20, 2026", state: "Awaiting review", confidence: 88, outcomeState: "Recorded", governanceState: "Pending", retrievalEligible: false,
    experience: "England was approximately a –525 favorite. The ticket combined England –1.5 with Over 3.5 because the quality gap appeared to imply domination, scoring volume, and handicap coverage.",
    task: "Evaluate whether England’s quality advantage justified both margin and scoring exposure.", localContext: "World Cup matchup; Ghana could defend in a compact low block.", thesis: "England’s favorite strength would translate into territorial control, repeated scoring, and handicap coverage.",
    facts: ["England was approximately a –525 favorite.", "The match finished England 0–0 Ghana."], estimates: ["England was expected to control territory.", "The quality gap was expected to increase scoring probability."], assumptions: ["Control would become goals.", "Goals would become handicap coverage.", "Favorite strength, control, scoring probability, and coverage moved together."], unknowns: ["How long Ghana could sustain a defensive wall.", "Whether England’s control would create high-quality chances."], counterarguments: ["Cape Verde supplied an earlier defensive-wall counterexample.", "A strong favorite can control possession without covering a handicap or total."], fragility: "High — the thesis required multiple correlated claims to hold simultaneously.", completeness: 92, outcome: "England 0–0 Ghana.",
    postmortem: { happened: "England controlled portions of the match, but Ghana stayed level and the game finished 0–0.", failed: "Expected scoring volume and handicap coverage failed.", held: "England remained the stronger side and controlled portions of the match.", underweighted: "The defensive-wall outcome and the possibility that control would not become high-quality scoring.", change: "Separate favorite strength, territorial control, scoring probability, and handicap coverage rather than treating them as one signal.", evidence: ["ev-england-outcome", "ev-england-audit", "ev-cape-challenge"] },
    proposedKnowledgeId: "knowledge-signal-separation", metadata: { Sport: "Soccer", League: "International", "Market type": "Handicap + total", "Decision type": "Pre-match thesis", "Case family": "World Cup knockout matches", "Research status": "Audited", "Evidence quality": "Mixed exact + reconstructed", "Shared mechanism": "Defensive-wall signal separation", "Failure mode": "Correlated-signal bundling", Fragility: "High", "Time sensitivity": "Historical", "Outcome status": "Recorded", "Governance state": "Pending" }
  },
  {
    id: "case-cape-verde", project: "sports", origin: "Seeded example", title: "Cape Verde defensive-wall counterexample", createdAt: "Jul 18, 2026", state: "Closed", confidence: 78, outcomeState: "Recorded", governanceState: "Approved", retrievalEligible: true,
    experience: "A perceived quality gap failed to produce repeated scoring against a compact defensive structure.", task: "Preserve a comparable defensive-wall failure mode.", localContext: "Reconstructed from an earlier Sports Engine case.", thesis: "The stronger side would convert the quality gap into repeated scoring.", facts: ["The expected scoring volume did not occur."], estimates: ["The stronger team would create repeated high-quality chances."], assumptions: ["Quality advantage implied scoring volume."], unknowns: ["Exact tactical and lineup conditions."], counterarguments: ["The comparison is reconstructed and cannot be treated as identical evidence."], fragility: "Moderate", completeness: 72, outcome: "Defensive-wall outcome preserved as a counterexample.", postmortem: { happened: "The defensive structure limited scoring despite a quality gap.", failed: "The scoring-volume expectation.", held: "The perceived favorite remained stronger.", underweighted: "Defensive shape and finishing variance.", change: "Carry the mechanism as a challenge, not an identical precedent.", evidence: ["ev-cape-challenge"] }, metadata: { Sport: "Soccer", League: "International", "Market type": "Match total", "Decision type": "Counterexample", "Case family": "Defensive-wall matches", "Research status": "Reconstructed", "Evidence quality": "Moderate", "Shared mechanism": "Defensive-wall signal separation", "Failure mode": "Quality-to-scoring shortcut", Fragility: "Moderate", "Time sensitivity": "Historical", "Outcome status": "Recorded", "Governance state": "Approved" }
  },
  {
    id: "case-pitcher-workload", project: "sports", origin: "Seeded example", title: "Pitcher workload stability audit", createdAt: "Jul 19, 2026", state: "Closed", confidence: 84, outcomeState: "Recorded", governanceState: "Approved", retrievalEligible: true,
    experience: "Three pitcher-prop cases showed that strikeout reasoning breaks when pitch-count and innings assumptions are not verified.", task: "Audit strikeout props against workload stability.", localContext: "MLB pitcher props.", thesis: "Matchup quality was sufficient to price the strikeout over.", facts: ["One failed case overestimated innings."], estimates: ["Starter workload would remain stable."], assumptions: ["Recent pitch count represented the next outing."], unknowns: ["Manager constraint and live pitch limit."], counterarguments: ["Matchup edge is irrelevant if workload is capped."], fragility: "High when workload is unverified.", completeness: 86, outcome: "Workload verification became a promoted principle.", postmortem: { happened: "Two props held; the failed case had an unstable innings assumption.", failed: "The unverified innings estimate.", held: "Matchup-quality analysis.", underweighted: "Manager and pitch-count constraints.", change: "Verify workload before pricing strikeout upside.", evidence: ["ev-pitcher-set"] }, proposedKnowledgeId: "knowledge-workload", metadata: { Sport: "Baseball", League: "MLB", "Market type": "Player prop", "Decision type": "Research audit", "Case family": "Pitcher strikeouts", "Research status": "Closed", "Evidence quality": "Moderate", "Shared mechanism": "Constraint before upside", "Failure mode": "Unverified workload", Fragility: "High", "Time sensitivity": "High", "Outcome status": "Recorded", "Governance state": "Approved" }
  },
  {
    id: "case-unwinnable-pucks", project: "hockey", origin: "Seeded example", title: "Overexerting on unwinnable pucks", createdAt: "Jul 17, 2026", state: "Closed", confidence: 86, outcomeState: "Recorded", governanceState: "Approved", retrievalEligible: true,
    experience: "Maximum effort was repeatedly spent on low-probability puck races, reducing the pace available for the next useful action.", task: "Improve game-transfer decisions without removing competitive motor.", localContext: "Beer-league and development-skate observations.", thesis: "More effort on every puck would create more impact.", facts: ["Several puck races were not realistically winnable."], estimates: ["Backing off earlier would preserve better support positioning."], assumptions: ["Constant maximum exertion equals useful pace."], unknowns: ["How consistently the decision changes under pressure."], counterarguments: ["Some low-probability races still create pressure or force errors."], fragility: "Context-dependent", completeness: 81, outcome: "Play fast. Don’t just skate hard became approved Hockey Development knowledge.", postmortem: { happened: "Effort was high, but some routes created no recoverable advantage.", failed: "The assumption that maximum exertion always improves the play.", held: "Motor and willingness to pressure remain strengths.", underweighted: "Expected outcome, route quality, and the next support action.", change: "Separate effort, control, and expected outcome before committing maximum pace.", evidence: ["ev-hockey-reflection", "ev-hockey-challenge"] }, proposedKnowledgeId: "knowledge-play-fast", metadata: { "Skill dial": "Decision speed", "Game situation": "Loose-puck race", Zone: "All zones", "Pressure level": "Game", "Decision type": "Commit or support", "Technical mechanism": "Effort-control-outcome separation", "Game-transfer value": "High", "Development priority": "Current", Confidence: "86", "Development phase": "Preseason" }
  }
];

export const seededEvidence: EvidenceRecord[] = [
  { id: "ev-england-capture", project: "sports", caseId: "case-england-ghana", recordType: "Capture", content: "England’s –525 price was used as a proxy for domination, scoring, and handicap coverage.", source: "Sports thesis 001", fidelity: "Exact", confidence: 96, role: "Context", creator: "Cody", timestamp: "Jul 20 · 8:10 PM", approvalState: "Approved", retrievalEligible: false, metadata: { Sport: "Soccer", "Market type": "Handicap + total", Mechanism: "Correlated-signal bundling" } },
  { id: "ev-england-outcome", project: "sports", caseId: "case-england-ghana", recordType: "Outcome", content: "England 0–0 Ghana.", source: "Exact final result", fidelity: "Exact", confidence: 99, role: "Contradicts", creator: "Cody", timestamp: "Jul 20 · 9:58 PM", approvalState: "Approved", retrievalEligible: true, metadata: { Sport: "Soccer", "Outcome status": "Recorded", Mechanism: "Defensive wall" } },
  { id: "ev-england-audit", project: "sports", caseId: "case-england-ghana", recordType: "Proposed learning", content: "Favorite strength, territorial control, scoring probability, and handicap coverage should be evaluated separately.", source: "England–Ghana post-mortem", fidelity: "Reconstructed", confidence: 91, role: "Refines", creator: "Atlas", timestamp: "Jul 20 · 10:06 PM", approvalState: "Pending", retrievalEligible: false, metadata: { Sport: "Soccer", Mechanism: "Signal separation", "Governance state": "Pending" } },
  { id: "ev-cape-challenge", project: "sports", caseId: "case-cape-verde", recordType: "Challenge", content: "The defensive-wall mechanism transfers, but the reconstructed comparison cannot prove a universal rule.", source: "Research audit", fidelity: "Reconstructed", confidence: 78, role: "Challenges", creator: "Atlas", timestamp: "Jul 20 · 10:08 PM", approvalState: "Approved", retrievalEligible: true, metadata: { Sport: "Soccer", Mechanism: "Defensive wall", "Evidence quality": "Moderate" } },
  { id: "ev-market-correction", project: "sports", caseId: "case-england-ghana", recordType: "Correction", content: "The available market options were overstated. Future research must distinguish modeled markets from currently offered markets.", source: "Direct user correction + screenshot", fidelity: "Exact", confidence: 99, role: "Refines", creator: "Cody", timestamp: "Jul 18 · 7:40 PM", approvalState: "Approved", retrievalEligible: true, metadata: { Sport: "Soccer", "Market type": "Availability", Mechanism: "Reality correction" } },
  { id: "ev-pitcher-set", project: "sports", caseId: "case-pitcher-workload", recordType: "Research", content: "Two comparable strikeout props held; the failed case overestimated innings because pitch-count stability was not verified.", source: "Three closed Sports Engine cases", fidelity: "Reconstructed", confidence: 84, role: "Supports", creator: "Atlas", timestamp: "Jul 19 · 11:20 PM", approvalState: "Approved", retrievalEligible: true, metadata: { Sport: "Baseball", "Market type": "Player prop", Mechanism: "Workload constraint" } },
  { id: "ev-hockey-reflection", project: "hockey", caseId: "case-unwinnable-pucks", recordType: "Observation", content: "Maximum effort on unwinnable pucks repeatedly reduced the quality of the next support route.", source: "Game reflection", fidelity: "Exact", confidence: 88, role: "Supports", creator: "Cody", timestamp: "Jul 17 · 10:18 PM", approvalState: "Approved", retrievalEligible: true, metadata: { "Skill dial": "Pace", "Game situation": "Puck race", Mechanism: "Effort-control-outcome separation" } },
  { id: "ev-hockey-challenge", project: "hockey", caseId: "case-unwinnable-pucks", recordType: "Challenge", content: "Low-probability pressure can still force errors; the principle cannot become permission to disengage.", source: "Game-transfer review", fidelity: "Reconstructed", confidence: 82, role: "Challenges", creator: "Atlas", timestamp: "Jul 17 · 10:24 PM", approvalState: "Approved", retrievalEligible: true, metadata: { "Skill dial": "Support", "Game situation": "Forecheck", Mechanism: "Selective pressure" } },
];

export const seededKnowledge: KnowledgeRecord[] = [
  { id: "knowledge-signal-separation", project: "sports", type: "Principle", title: "Separate dominance signals from market coverage", content: "Separate favorite strength, territorial control, scoring probability, and handicap coverage rather than treating them as one signal.", status: "Pending", scope: "Soccer decisions where a defensive-wall outcome can separate control from scoring and coverage", confidence: 88, humanApproval: null, supportingCaseIds: ["case-england-ghana", "case-cape-verde"], evidenceIds: ["ev-england-outcome", "ev-england-audit"], challengingEvidenceIds: ["ev-cape-challenge"], revisionHistory: ["Candidate drafted from the England–Ghana audit.", "Scope narrowed after the Cape Verde challenge."], retrievalHistory: [], retrievalEligible: false, metadata: { Sport: "Soccer", Mechanism: "Signal separation", "Failure mode": "Correlated-signal bundling", "Governance state": "Pending" } },
  { id: "knowledge-workload", project: "sports", type: "Principle", title: "Workload stability gates strikeout overs", content: "Verify recent pitch counts, manager constraints, and a realistic innings range before pricing strikeout upside.", status: "Approved", scope: "MLB pitcher strikeout research", confidence: 84, humanApproval: "Approved Jul 20 by Cody", supportingCaseIds: ["case-pitcher-workload"], evidenceIds: ["ev-pitcher-set"], challengingEvidenceIds: [], revisionHistory: ["Promoted after three closed pitcher-prop comparisons."], retrievalHistory: ["Retrieved for two workload-sensitive questions."], retrievalEligible: true, metadata: { Sport: "Baseball", "Market type": "Player prop", Mechanism: "Workload constraint", "Governance state": "Approved" } },
  { id: "knowledge-market-reality", project: "sports", type: "Correction", title: "Verify the offered market before calculating value", content: "Modeled options and currently available markets must remain separate.", status: "Approved", scope: "All Sports Engine market research", confidence: 99, humanApproval: "Direct user correction", supportingCaseIds: ["case-england-ghana"], evidenceIds: ["ev-market-correction"], challengingEvidenceIds: [], revisionHistory: ["Correction preserved with screenshot evidence."], retrievalHistory: ["Applied when current market availability is relevant."], retrievalEligible: true, metadata: { Mechanism: "Reality correction", "Governance state": "Approved" } },
  { id: "knowledge-play-fast", project: "hockey", type: "Principle", title: "Play fast. Don’t just skate hard.", content: "Decision speed, scanning, route quality, and support timing create more game transfer than constant maximum exertion.", status: "Approved", scope: "Hockey Development game-transfer decisions", confidence: 89, humanApproval: "Approved Jul 17 by Cody", supportingCaseIds: ["case-unwinnable-pucks"], evidenceIds: ["ev-hockey-reflection"], challengingEvidenceIds: ["ev-hockey-challenge"], revisionHistory: ["Scope preserved: selective pressure is not disengagement."], retrievalHistory: ["Retrieved for game-transfer planning."], retrievalEligible: true, metadata: { "Skill dial": "Decision speed", Mechanism: "Effort-control-outcome separation", "Governance state": "Approved" } },
];

export const seededBlueprintRules: BlueprintRule[] = [
  { id: "bp-sports-research-state", project: "sports", content: "Classify facts, estimates, assumptions, unknowns, and research status before assigning confidence.", version: "V4.6", status: "Active", supportingCaseIds: ["case-england-ghana", "case-pitcher-workload"], evidenceIds: ["ev-england-capture", "ev-pitcher-set"], challengeIds: [], approvalHistory: ["Retained from the Sports Engine research blueprint."], lastRevision: "Jul 21, 2026", relatedKnowledgeIds: ["knowledge-workload"], retrievalEffect: "Always structures the research audit in Sports Engine packets." },
  { id: "bp-sports-market", project: "sports", content: "Verify the currently offered market before calculating probability, price, or expected value.", version: "V4.6", status: "Active", supportingCaseIds: ["case-england-ghana"], evidenceIds: ["ev-market-correction"], challengeIds: [], approvalHistory: ["Authorized after direct user correction."], lastRevision: "Jul 18, 2026", relatedKnowledgeIds: ["knowledge-market-reality"], retrievalEffect: "Adds market-verification requirements when the question is time-sensitive." },
  { id: "bp-sports-signal-proposed", project: "sports", content: "Separate favorite strength, territorial control, scoring probability, and handicap coverage.", version: "V4.6.1 proposed", status: "Proposed", supportingCaseIds: ["case-england-ghana", "case-cape-verde"], evidenceIds: ["ev-england-outcome", "ev-england-audit"], challengeIds: ["ev-cape-challenge"], approvalHistory: ["Blocked until the underlying knowledge principle is approved.", "Requires a separate Blueprint decision."], lastRevision: "Not active", relatedKnowledgeIds: ["knowledge-signal-separation"], retrievalEffect: "None until separately authorized." },
  { id: "bp-hockey-transfer", project: "hockey", content: "Prioritize game-transfer value: scanning, support, timing, and decision speed must survive pressure.", version: "V2.2", status: "Active", supportingCaseIds: ["case-unwinnable-pucks"], evidenceIds: ["ev-hockey-reflection", "ev-hockey-challenge"], challengeIds: ["ev-hockey-challenge"], approvalHistory: ["Approved from repeated skate and game observations."], lastRevision: "Jul 17, 2026", relatedKnowledgeIds: ["knowledge-play-fast"], retrievalEffect: "Prioritizes game-transfer evidence over drill difficulty." },
];

export const seededReviews: ReviewRecord[] = [
  { id: "review-signal", project: "sports", type: "Proposed principle", title: "Separate dominance signals from market coverage", proposal: "Promote the scoped England–Ghana lesson into approved Sports Engine knowledge.", why: "The 0–0 outcome contradicted the bundled thesis, and the Cape Verde comparison supports the same defensive-wall mechanism while narrowing its scope.", sourceCaseId: "case-england-ghana", supportEvidenceIds: ["ev-england-outcome", "ev-england-audit"], challengeEvidenceIds: ["ev-cape-challenge"], affectedKnowledgeId: "knowledge-signal-separation", blueprintEffect: "No automatic Blueprint change. A separate V4.6.1 revision remains pending.", confidence: 88, retrievalEffect: "Relevant Soccer packets may include the principle after approval.", crossProjectConsequence: "May support an exploratory Hockey Development mechanism comparison, but creates no target authority.", status: "Pending" },
  { id: "review-blueprint-signal", project: "sports", type: "Blueprint revision", title: "Add signal separation to the Sports Engine Blueprint", proposal: "Activate the scoped signal-separation rule as Sports Engine Blueprint V4.6.1.", why: "A durable methodology change should occur only after the underlying knowledge is approved and a second human decision authorizes Blueprint authority.", sourceCaseId: "case-england-ghana", supportEvidenceIds: ["ev-england-outcome", "ev-england-audit"], challengeEvidenceIds: ["ev-cape-challenge"], affectedKnowledgeId: "knowledge-signal-separation", blueprintEffect: "Would activate bp-sports-signal-proposed and advance the project Blueprint to V4.6.1.", confidence: 84, retrievalEffect: "The rule would structure all relevant Sports Engine soccer research, not only retrieve as scoped knowledge.", crossProjectConsequence: "None.", status: "Deferred" },
  { id: "review-transfer-effort", project: "campus", type: "Transfer proposal", title: "Adapt signal separation for Hockey Development", proposal: "Adapt—not copy—the Sports Engine mechanism into a Hockey Development principle that separates effort, control, and expected outcome.", why: "The source and target cases share a failure mode: one strong signal was used as a proxy for several downstream outcomes.", sourceCaseId: "case-england-ghana", supportEvidenceIds: ["ev-england-audit", "ev-hockey-reflection"], challengeEvidenceIds: ["ev-cape-challenge", "ev-hockey-challenge"], affectedKnowledgeId: "knowledge-signal-separation", blueprintEffect: "No automatic target Blueprint revision.", confidence: 76, retrievalEffect: "If approved, only adapted Hockey Development knowledge becomes target-project authority.", crossProjectConsequence: "The Sports Engine source remains unchanged; domain differences remain visible in every receipt.", status: "Pending", targetProject: "hockey" },
  { id: "review-weak-keyword", project: "campus", type: "Reconstruction pathway", title: "Reject keyword-only ‘coverage’ connection", proposal: "Connect Sports Engine market coverage to Hockey Development defensive coverage.", why: "Atlas detected a shared word but no shared mechanism or evidence lineage.", supportEvidenceIds: [], challengeEvidenceIds: ["ev-hockey-challenge"], blueprintEffect: "None.", confidence: 22, retrievalEffect: "Should remain excluded.", crossProjectConsequence: "Rejecting it demonstrates that keyword overlap cannot activate a cross-project pathway.", status: "Pending", targetProject: "hockey" },
];

export const seededConnections: ConnectionRecord[] = [
  { id: "cx-outcome-case", project: "sports", sourceId: "case-england-ghana", targetId: "ev-england-outcome", type: "Contradicted by outcome", explanation: "The 0–0 result contradicted the scoring and handicap portions of the original thesis.", sharedMechanism: "Reality correction", evidenceIds: ["ev-england-outcome"], confidence: 99, creator: "Atlas", approvalState: "Approved", downstreamConsequence: "Moved the case into audit and blocked the original thesis from retrieval authority.", reconstructionValue: 98, domainLimitations: "Exact to this match." },
  { id: "cx-audit-principle", project: "sports", sourceId: "ev-england-outcome", targetId: "knowledge-signal-separation", type: "Derived from", explanation: "The outcome and post-mortem produced the scoped signal-separation proposal.", sharedMechanism: "Signal separation", evidenceIds: ["ev-england-outcome", "ev-england-audit"], confidence: 91, creator: "Atlas", approvalState: "Pending", downstreamConsequence: "No retrieval effect until human approval.", reconstructionValue: 96, domainLimitations: "Scoped to soccer matchups with defensive-wall risk." },
  { id: "cx-cape-principle", project: "sports", sourceId: "case-cape-verde", targetId: "knowledge-signal-separation", type: "Shares mechanism with", explanation: "The Cape Verde comparison exposes the same quality-to-scoring shortcut without claiming identical events.", sharedMechanism: "Defensive-wall signal separation", evidenceIds: ["ev-cape-challenge"], confidence: 78, creator: "Atlas", approvalState: "Approved", downstreamConsequence: "Narrows scope and strengthens reconstruction.", reconstructionValue: 91, domainLimitations: "Reconstructed comparison; not independent proof of a universal rule." },
  { id: "cx-transfer-hockey", project: "campus", sourceId: "knowledge-signal-separation", targetId: "case-unwinnable-pucks", type: "Proposed for transfer", explanation: "Both cases warn against allowing one positive signal to stand in for multiple downstream outcomes.", sharedMechanism: "Separate effort or strength from control and expected outcome", evidenceIds: ["ev-england-audit", "ev-hockey-reflection", "ev-hockey-challenge"], confidence: 76, creator: "Atlas", approvalState: "Pending", downstreamConsequence: "May enrich reconstruction as an exploratory analogy; creates no Hockey Development authority until adapted and approved.", reconstructionValue: 88, domainLimitations: "Sports prediction and hockey performance are different domains; the conclusion cannot be copied." },
  { id: "cx-weak-coverage", project: "campus", sourceId: "knowledge-market-reality", targetId: "case-unwinnable-pucks", type: "Proposed for transfer", explanation: "Keyword overlap on ‘coverage’ without a shared mechanism.", sharedMechanism: "None established", evidenceIds: [], confidence: 22, creator: "Atlas", approvalState: "Rejected", downstreamConsequence: "Excluded from retrieval and reconstruction.", reconstructionValue: 12, domainLimitations: "Market coverage and defensive coverage are unrelated meanings." },
];

export const seededActivities: ActivityRecord[] = [
  { id: "act-review-ready", project: "sports", actor: "Atlas", action: "Principle proposed", targetId: "knowledge-signal-separation", targetTitle: "Separate dominance signals from market coverage", timestamp: "Jul 20 · 10:09 PM", previousState: "Audited case", newState: "Awaiting review", consequence: "Retrieval remains unchanged until human approval." },
  { id: "act-outcome", project: "sports", actor: "Cody", action: "Outcome recorded", targetId: "case-england-ghana", targetTitle: "England 0–0 Ghana", timestamp: "Jul 20 · 9:58 PM", previousState: "Needs outcome", newState: "Needs audit", consequence: "The original thesis was challenged by reality." },
  { id: "act-transfer", project: "campus", actor: "Atlas", action: "Transfer proposed", targetId: "review-transfer-effort", targetTitle: "Sports Engine → Hockey Development", timestamp: "Jul 21 · 2:14 AM", previousState: "No target authority", newState: "Exploratory pathway", consequence: "Available for review; not authoritative in Hockey Development." },
  { id: "act-hockey", project: "hockey", actor: "Cody", action: "Principle approved", targetId: "knowledge-play-fast", targetTitle: "Play fast. Don’t just skate hard.", timestamp: "Jul 17 · 10:30 PM", previousState: "Candidate", newState: "Approved knowledge", consequence: "Eligible for Hockey Development retrieval." },
];

export function apiNodesFromState(cases: CaseRecord[], evidence: EvidenceRecord[], knowledge: KnowledgeRecord[]) {
  const caseNodes = cases.map((item) => ({ id: item.id, project: item.project, type: "decision", title: item.title, summary: `${item.experience} Outcome: ${item.outcome || "Pending"}`, status: item.governanceState === "Approved" ? "approved" : item.governanceState === "Challenged" ? "challenged" : "proposed", level: "Observation", sources: [item.origin, item.outcome || "Outcome pending"], sourceFidelity: item.origin === "Seeded example" ? 92 : 85, reconstructionValue: item.completeness, scopeStability: Math.max(40, item.completeness - 10), lineage: [item.experience, item.outcome || "Outcome pending", item.postmortem.change || "Audit pending"], metadata: item.metadata }));
  const evidenceNodes = evidence.filter((item) => item.retrievalEligible || ["Challenge", "Correction", "Outcome"].includes(item.recordType)).map((item) => ({ id: item.id, project: item.project, type: item.recordType.toLowerCase(), title: `${item.recordType}: ${item.content.slice(0, 68)}`, summary: item.content, status: item.approvalState === "Approved" ? "approved" : item.approvalState.toLowerCase(), level: "Evidence", sources: [item.source], sourceFidelity: item.confidence, reconstructionValue: item.role === "Contradicts" || item.role === "Challenges" ? 92 : 78, scopeStability: 78, lineage: [item.caseId, item.source, item.role], metadata: item.metadata }));
  const knowledgeNodes = knowledge.map((item) => ({ id: item.id, project: item.project, type: item.type === "Principle" || item.type === "Adapted transfer" ? "principle" : item.type.toLowerCase(), title: item.title, summary: item.content, status: item.status === "Approved" && item.retrievalEligible ? "approved" : item.status.toLowerCase(), level: item.type === "Principle" || item.type === "Adapted transfer" ? "Validated Principle" : "Observation", sources: item.evidenceIds, sourceFidelity: item.confidence, reconstructionValue: item.type === "Principle" ? 96 : 84, scopeStability: 82, lineage: [...item.supportingCaseIds, ...item.evidenceIds, ...(item.humanApproval ? [item.humanApproval] : ["Human approval pending"])], metadata: item.metadata }));
  return [...caseNodes, ...evidenceNodes, ...knowledgeNodes];
}

export function makeSeedState(workspaceId = ""): AtlasState {
  return {
    schemaVersion: 46,
    workspaceId,
    cases: structuredClone(seededCases),
    evidence: structuredClone(seededEvidence),
    knowledge: structuredClone(seededKnowledge),
    blueprintRules: structuredClone(seededBlueprintRules),
    reviews: structuredClone(seededReviews),
    connections: structuredClone(seededConnections),
    activities: structuredClone(seededActivities),
    contextPackets: [],
    proofBaseline: null,
    nodes: apiNodesFromState(seededCases, seededEvidence, seededKnowledge),
  };
}

export function projectByKey(key: ProjectKey) {
  return projects.find((project) => project.key === key) ?? projects[0];
}
