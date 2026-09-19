export type DeliveryPreservationClass = "immutable_state" | "required_abstraction" | "optional_context";

export type ImmutableSemanticAtom = {
  kind: "value" | "time" | "identifier" | "condition_party" | "resolution_owner";
  value: string;
  signature: string;
};

const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
const NON_PARTY_CONDITION_WORDS = new Set([
  "all", "any", "available", "both", "either", "none", "otherwise", "weather",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
]);

function normalized(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * Detect an actual correction rather than a word that merely appears inside a
 * hypothetical clause (for example, "unless something is wrong").
 */
export function hasExplicitCorrectionLanguage(value: string) {
  const source = normalized(value);
  if (/\b(?:correction|corrected|incorrect(?:ly)?|misunderstood|mistaken|not the right|no longer applies|no longer (?:the )?plan|is out|are out|scratch|reject(?:ed)?|drop(?:ped)?|obsolete|stale|supersed(?:e|ed|es|ing)|replac(?:e|ed|es|ing)|changed? (?:from|to)|instead)\b/iu.test(source)) {
    return true;
  }
  return /(?:^|[.!?]\s+)(?:no[,.:;!?-]?\s+)?(?:that|this|it|you|we|i)?[^.!?]{0,36}\b(?:is|was|are|were|got|have|had)?\s*(?:not\s+)?wrong\b/iu.test(source)
    || /\bwrong(?:ly)?\s+(?:treats?|states?|assumes?|identif(?:y|ies)|marks?|calls?)\b/iu.test(source);
}

function addAtom(
  atoms: Map<string, ImmutableSemanticAtom>,
  kind: ImmutableSemanticAtom["kind"],
  value: string,
) {
  const clean = normalized(value).toLowerCase();
  if (!clean) return;
  const signature = `${kind}:${clean}`;
  atoms.set(signature, { kind, value: normalized(value), signature });
}

function addPartyAtom(atoms: Map<string, ImmutableSemanticAtom>, value: string) {
  const first = normalized(value).split(" ")[0]?.toLowerCase() || "";
  if (!NON_PARTY_CONDITION_WORDS.has(first)) addAtom(atoms, "condition_party", value);
}

/**
 * Extract exact semantic values whose mutation could make a fresh room take a
 * materially different action. These atoms are delivery metadata only; they
 * do not create a second truth store beside governed State Truth.
 */
export function immutableSemanticAtoms(value: string): ImmutableSemanticAtom[] {
  const source = normalized(value);
  const atoms = new Map<string, ImmutableSemanticAtom>();

  for (const match of source.matchAll(/\$\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?\s*%/gu)) {
    addAtom(atoms, "value", match[0]);
  }
  for (const match of source.matchAll(/\b\d+\/\d+\b/gu)) {
    addAtom(atoms, "value", match[0]);
  }
  for (const match of source.matchAll(/\b\d+(?:\.\d+)?\s*(?:mph|miles?|hours?|minutes?|days?|weeks?|people|persons?|rooms?|bedrooms?|bundles?|tokens?)\b/giu)) {
    addAtom(atoms, "value", match[0]);
  }
  for (const match of source.matchAll(new RegExp(`\\b(?:${NUMBER_WORDS})\\s+(?:people|persons?|rooms?|bedrooms?|bundles?|answers?|questions?|conditions?|requirements?)\\b`, "giu"))) {
    addAtom(atoms, "value", match[0]);
  }
  for (const match of source.matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/giu)) {
    addAtom(atoms, "time", match[0]);
  }
  for (const match of source.matchAll(/\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/giu)) {
    addAtom(atoms, "time", match[0]);
  }
  for (const match of source.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4}))\b/gu)) {
    addAtom(atoms, "time", match[0]);
  }
  for (const match of source.matchAll(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?\b/giu)) {
    addAtom(atoms, "time", match[0]);
  }
  for (const match of source.matchAll(/\b[A-Z][A-Z0-9]{1,15}-\d+[A-Z0-9-]*\b/gu)) {
    addAtom(atoms, "identifier", match[0]);
  }
  for (const match of source.matchAll(/\b(?:commit|version|release|deployment|packet|receipt|run|artifact)\b[^.!?\n]{0,80}?\b([a-f0-9]{7,64}|v\d+(?:\.\d+){0,3})\b/giu)) {
    addAtom(atoms, "identifier", match[1]);
  }
  for (const match of source.matchAll(/\b(?:if|unless|until|when)\s+([A-Z][a-z]{1,40}(?:\s+[A-Z][a-z]{1,40})?)\b/gu)) {
    addPartyAtom(atoms, match[1]);
  }
  for (const match of source.matchAll(/\b(?:until|pending)\s+([A-Z][a-z]{1,40})\s+(?:verif(?:y|ies)|confirm(?:s)?|decides?|approves?|checks?)\b/gu)) {
    addAtom(atoms, "resolution_owner", match[1]);
  }
  for (const match of source.matchAll(/\b([A-Z][a-z]{1,40})\s+(?:must|will|brings?|buys?|purchases?|owns?|verif(?:y|ies)|confirm(?:s)?|decides?|approves?)\b/gu)) {
    addAtom(atoms, "resolution_owner", match[1]);
  }
  return [...atoms.values()].sort((left, right) => left.signature.localeCompare(right.signature));
}

export function immutableSemanticSignatures(value: string) {
  return immutableSemanticAtoms(value).map((atom) => atom.signature);
}

export function hasDistinctImmutableState(left: string, right: string) {
  const leftAtoms = new Set(immutableSemanticSignatures(left));
  const rightAtoms = new Set(immutableSemanticSignatures(right));
  if (!leftAtoms.size && !rightAtoms.size) return false;
  if (leftAtoms.size !== rightAtoms.size) return true;
  return [...leftAtoms].some((signature) => !rightAtoms.has(signature));
}

/** True when a candidate paraphrase introduces a protected value absent from its source. */
export function hasUnsupportedImmutableState(candidate: string, source: string) {
  const candidateAtoms = new Set(immutableSemanticSignatures(candidate));
  const sourceAtoms = new Set(immutableSemanticSignatures(source));
  return [...candidateAtoms].some((signature) => !sourceAtoms.has(signature));
}

export function deliveryPreservationClass(
  value: string,
  roles: string[],
): DeliveryPreservationClass {
  const protectedRoles = new Set([
    "direction",
    "next_action",
    "constraint",
    "conditional",
    "correction",
    "unresolved",
    "semantic_identity",
  ]);
  if (immutableSemanticAtoms(value).length || roles.some((role) => protectedRoles.has(role))) {
    return "immutable_state";
  }
  if (roles.includes("rationale") || roles.includes("shared_term")) return "required_abstraction";
  return "optional_context";
}

/** Remove dialogue scaffolding without changing the governed proposition. */
export function normalizeDeliveryStatement(value: string) {
  let source = normalized(value);
  const notYet = source.match(/^not yet\.\s+([\s\S]+)$/iu);
  if (notYet) {
    const remainder = notYet[1];
    source = /\b(?:unresolved|undecided|open|pending|not (?:yet )?(?:confirmed|settled)|still needs? to|before\b[^.!?]{0,100}\b(?:confirm|verify))\b/iu.test(remainder)
      ? remainder
      : `Open: ${remainder}`;
  }
  const no = source.match(/^no\.\s+([\s\S]+)$/iu);
  if (no) {
    const remainder = no[1];
    source = /\b(?:no|not|never|rejected|dropped|obsolete|instead|current choice|current plan)\b/iu.test(remainder)
      ? remainder
      : `Correction: ${remainder}`;
  }
  const clean = source
    .replace(/^(?:yes|understood|good|right|correct)\.\s+/iu, "")
    .replace(/^that(?:’|')s directionally right,\s*but\s+/iu, "")
    .replace(/^that incorrectly treats ([^.!?]+?) as ([^.!?]+?)\.\s*/iu, "Correction: $1 is not $2. ")
    .replace(/^we also need to\s+/iu, "")
    .replace(/^also\s+/iu, "")
    .replace(/^use this condition:\s*/iu, "Condition: ")
    .replace(/^don(?:’|')t\s+/iu, "Do not ")
    .trim();
  return clean.replace(/^[a-z]/u, (first) => first.toUpperCase());
}

export function danglingSemanticReferences(value: string) {
  const references: string[] = [];
  if (/\b(?:both|either) (?:answers?|questions?|confirmations?)\b/iu.test(value)) references.push("answer_set");
  if (/\b(?:all|either|both) (?:conditions?|requirements?|checks?)\b/iu.test(value)) references.push("condition_set");
  return references;
}

export function suppliesSemanticAntecedent(value: string, reference: string) {
  if (reference === "answer_set") {
    if (danglingSemanticReferences(value).includes("answer_set")) return false;
    return /\b(?:(?:must|need(?:s)? to|have to)\s+(?:confirm|verify|answer|ask)|before\s+(?:paying|booking|approving)[\s\S]{0,100}\b(?:confirm|verify)|(?:confirm|verify)\s+(?:the\s+)?(?:two|three|following))\b/iu.test(value)
      && (new RegExp(`\\b(?:${NUMBER_WORDS}|following)\\b`, "iu").test(value)
        || /\b(?:and|plus)\b/iu.test(value));
  }
  if (reference === "condition_set") {
    if (danglingSemanticReferences(value).includes("condition_set")) return false;
    return /\b(?:condition|requirement|check|confirm|verify)\b/iu.test(value)
      && new RegExp(`\\b(?:${NUMBER_WORDS}|following)\\b`, "iu").test(value);
  }
  return false;
}
