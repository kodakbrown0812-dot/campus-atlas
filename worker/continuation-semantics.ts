import { immutableSemanticAtoms } from "./immutable-state";

export const CONTINUATION_STATE_FAMILY_ORDER = [
  "objective",
  "date",
  "destination",
  "reservation",
  "budget",
  "roster",
  "transport",
  "food",
  "medical",
  "access",
  "gear",
  "activity",
] as const;

export type ContinuationStateFamily = typeof CONTINUATION_STATE_FAMILY_ORDER[number];

const STATE_FAMILY_PATTERNS: Array<[ContinuationStateFamily, RegExp]> = [
  ["objective", /\b(?:objective|goal|purpose|current direction|current plan|continue|continuation)\b/iu],
  ["date", /\b(?:date|dates|weekend|schedule|timing|departure|return(?:ing)?|january|february|march|april|may|june|july|august|september|october|november|december)\b/iu],
  ["destination", /\b(?:destination|campground|campsite|site|lodging|cabin|park|location|venue)\b/iu],
  ["reservation", /\b(?:reservation|booking|booked|hold|deposit|confirmation code|permit)\b/iu],
  ["budget", /\b(?:budget|cap|ceiling|cost|price|total|contingency|fee|paid)\b/iu],
  ["roster", /\b(?:roster|participant|traveler|attendee|join|joining|drop out|dropped out|withdraw|food count|headcount)\b/iu],
  ["transport", /\b(?:driver|drives?|vehicle|pickup|truck|minivan|subaru|passenger|seat|cargo|ride|transport)\b/iu],
  ["food", /\b(?:food|menu|meal|grocery|allerg|gluten|celiac|vegetarian|pesto|taco|bakery|snack|cookware)\b/iu],
  ["medical", /\b(?:medical|medication|epinephrine|diagnosis|injury|ankle|health|first-aid|first aid)\b/iu],
  ["access", /\b(?:access|accessible|accessibility|mobility|walking distance|toilet|stairs?|level route|steep|parking)\b/iu],
  ["gear", /\b(?:gear|equipment|tent|stove|fuel|cooler|tarp|lantern|chairs?|filter|sleeping bag|food container)\b/iu],
  ["activity", /\b(?:activity|trail|hike|walk|visitor center|kayak|campfire|fire restriction|forecast|weather|closure|scenic drive)\b/iu],
];

export function continuationStateFamilies(value: string): ContinuationStateFamily[] {
  return STATE_FAMILY_PATTERNS
    .filter(([, pattern]) => pattern.test(value))
    .map(([family]) => family);
}

export function provisionalContinuationState(value: string) {
  return /\b(?:propos(?:al|ed)|tentative(?:ly)?|provisional|explor(?:e|ing)|offer(?:ed)?|on hold|only a hold|not (?:a booking|booked|final|finalized|confirmed)|do not count .{0,40} final|uncertain)\b/iu.test(value);
}

export function finalizedContinuationState(value: string) {
  return /\b(?:this is final|final(?:ized)? (?:decision|plan|choice|date|dates|weekend|destination|site|reservation|roster|budget|cap|vehicle|transportation|passenger|cargo|assignment|assignments|gear|menu)|(?:decision|plan|choice|date|dates|weekend|destination|site|reservation|roster|budget|cap|vehicle|transportation|passenger|cargo|assignment|assignments|gear|menu) (?:is|are) final|(?:reservation|booking|decision|plan|choice|roster|assignment|assignments) finalized|confirmed (?:reservation|site|date|dates|weekend|destination|roster|booking)|hard final cap)\b/iu.test(value);
}

const FAMILY_COMPLETION_PATTERNS: Partial<Record<ContinuationStateFamily, RegExp>> = {
  date: /\b(?:final(?:ized)? dates?|dates? (?:is|are) final|confirmed (?:dates?|weekend))\b/iu,
  destination: /\b(?:final(?:ized)? destination|destination (?:is|are) final|confirmed (?:destination|campground|campsite|site|lodging))\b/iu,
  reservation: /\b(?:reservation finalized|final(?:ized)? reservation|confirmed (?:reservation|booking|site)|confirmation code|booked and confirmed)\b/iu,
  budget: /\b(?:hard final cap|final(?:ized)? budget|budget (?:is|are) final|contingency (?:must|required))\b/iu,
  roster: /\b(?:roster finalized|final(?:ized)? roster|roster (?:is|are) final)\b/iu,
  transport: /\b(?:final (?:vehicle|transport|passenger|cargo)(?: plan| assignments?)?|(?:vehicle|transport|passenger|cargo) assignments? (?:is|are) final)\b/iu,
  food: /\b(?:food plan finalized|final(?:ized)? (?:food plan|menu)|(?:food plan|menu) (?:is|are) final|severe .{0,30}allerg|celiac|epinephrine)\b/iu,
  medical: /\b(?:immutable .{0,30}(?:medical|health|allerg).{0,30}constraint|severe .{0,30}allerg|epinephrine|medical requirement)\b/iu,
  access: /\b(?:access(?:ibility)? requirement|resolved question[^.!?]{0,80}(?:access|toilet|mobility)|must be accessible)\b/iu,
  gear: /\b(?:gear assignments? (?:is|are) final|final(?:ized)? gear(?: assignments?)?)\b/iu,
  activity: /\b(?:activity intentionally remains open|question intentionally remains open|closure is confirmed|official forecast)\b/iu,
};

/** Shared coarse-to-fine preference for a focused, complete state-family fact. */
export function continuationFamilyBaseSpecificity(value: string, family: ContinuationStateFamily) {
  const familyTerms = continuationStateFamilies(value).length;
  return immutableSemanticAtoms(value).length * 8
    + Number(FAMILY_COMPLETION_PATTERNS[family]?.test(value)) * 40
    + Number(finalizedContinuationState(value)) * 7
    + Number(continuationStateFamilies(value).includes(family)) * 2
    - Number(provisionalContinuationState(value)) * 24
    - Math.max(0, familyTerms - 1) * 8;
}

/**
 * Recognize text that explicitly denies changing governed state. Exact source
 * remains preserved, but the statement must not become a delivery seed merely
 * because it repeats a decision word, identifier, condition, or negation.
 */
export function explicitlyNonGoverningStatement(value: string) {
  const source = value.replace(/\s+/gu, " ").trim();
  if (/\b(?:must not|should not|cannot|can't|does not|do not)\s+(?:be|remain)\s+(?:explicitly )?non-governing\b/iu.test(source)) {
    return false;
  }
  const directDenial = /\b(?:not (?:a|an|the) (?:new )?(?:decision|proposal|request|correction|change|approval|instruction)|no (?:new )?(?:decision|proposal|request|correction|change) (?:is being made )?here|only acknowledging|merely acknowledging|changes? nothing|no effect on (?:the )?(?:plan|decision|state|schedule|roster|trip|project|work)|does not (?:affect|change|govern|reopen|revive|settle|resolve|supersede|replace)[^.!?]{0,48}\b(?:plan|decision|state|schedule|roster|trip|project|work|option|question|site|campsite|date|budget|cap|assignment|menu)\b|not official[^.!?]{0,80}(?:check|confirmation|decision))\b/iu.test(source);
  const explicitFrame = /\b(?:side thread|side conversation|social chatter|harmless chatter|off[- ]topic|jokes?|speculation|formatting|playlist discussion|photo (?:thread|filename|ideas?)|gear chat)\b/iu.test(source)
    && /\b(?:not|no|stop|does not|doesn't|changes? nothing|unchanged|still|remains?)\b/iu.test(source);
  const existingContract = /\b(?:not yet a change to (?:the )?(?:plan|decision|state)|does not affect (?:the )?(?:trip|project|work).{0,40}(?:current|working) state|can wait and does not govern|(?:is|are|remain(?:s)?) (?:explicitly )?non-governing|does not govern (?:future|current|the next) (?:action|decision|work|state))\b/iu.test(source);
  const historicalArtifactOnly = /\b(?:old|earlier|stale)\s+(?:calendar|screenshot|notes?|document|draft|file|copy)\b[^.!?]{0,100}\b(?:remain(?:s)?|stay(?:s)?|still (?:is|are))\s+(?:obsolete|rejected|superseded|stale)\b/iu.test(source);
  return directDenial || explicitFrame || existingContract || historicalArtifactOnly;
}
