export type DeliveryManifestSectionId =
  | "current_plan"
  | "people"
  | "constraints"
  | "open"
  | "next"
  | "replaced";

export type DeliveryManifestItem = {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceVersionId: string | null;
  statement: string;
  roles: string[];
  primaryRole: string;
  section: DeliveryManifestSectionId;
  required: boolean;
  reason: string;
  authority: string;
  participantIds: string[];
  sourceEventIds: string[];
};

export type DeliveryManifest = {
  version: 1;
  orientation: string | null;
  exclusions: Array<{ id: string; reason: string }>;
  sections: Array<{
    id: DeliveryManifestSectionId;
    title: string;
    items: DeliveryManifestItem[];
  }>;
};
