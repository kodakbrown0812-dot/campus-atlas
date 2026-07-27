export const LEGACY_MIGRATION_CLASSES = [
  "verified_canonical_history",
  "reingestion_source",
  "calibration_fixture",
  "unverified_proposal",
  "ui_only_state",
  "duplicate",
  "obsolete_historical_state",
] as const;

export type LegacyMigrationClass = typeof LEGACY_MIGRATION_CLASSES[number];

export interface LegacyClassification {
  legacyType: string;
  legacyId: string;
  projectKey?: string;
  classification: LegacyMigrationClass;
  reason: string;
  sourceReference?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

/**
 * Slice 1 deliberately records migration intent without importing or granting
 * authority. Later migration code must require an explicit classification.
 */
export function validateLegacyClassification(value: LegacyClassification) {
  if (!value.legacyType.trim() || !value.legacyId.trim() || !value.reason.trim()) {
    throw new Error("Legacy type, ID, and classification reason are required.");
  }
  if (!LEGACY_MIGRATION_CLASSES.includes(value.classification)) {
    throw new Error("Unsupported legacy migration classification.");
  }
  return Object.freeze({ ...value });
}
