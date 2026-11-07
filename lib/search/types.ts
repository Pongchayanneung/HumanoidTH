export type SearchRecordKind =
  | "source"
  | "robot"
  | "contribution"
  | "perspective"
  | "inventory"
  | "relationship"
  | "entity";

export type LanguageTag = "th" | "en" | "mixed" | "unknown";

export interface SearchEvidence {
  fieldName: string;
  originalText: string;
  label: string;
  coverage: "full" | "partial" | "title-only";
  startOffset: number; // UTF-16 offset into original field
  endOffset: number;   // UTF-16 offset into original field
}

export interface SearchDocument {
  typedId: string;
  kind: SearchRecordKind;
  title: string;
  body: string;
  retrievalText: string;
  url: string | null;
  groupId: string;
  origin: string;
  language: LanguageTag;
  isTitleOnly: boolean;
  isPartial: boolean;
  parentTypedId: string | null;
  contentHash: string;
  dependencyHash: string;
  vectorRow: number | null;
  evidence: SearchEvidence[];
  metadata: Record<string, unknown>;
}

export interface SearchExportManifest {
  manifestVersion: string;
  datasetId: string;
  releaseId: string;
  generatedAt: string;
  counts: {
    totalEligible: number;
    byKind: Record<SearchRecordKind, number>;
    byLanguage: Record<LanguageTag, number>;
    excluded: number;
    emptyKinds: SearchRecordKind[];
  };
  policy: {
    permittedOrigins: string[];
    maxBodyCodePoints: number;
    omittedPlaceholders: string[];
    publicFieldsByKind: Record<SearchRecordKind, string[]>;
    excludedFields: string[];
  };
  files: {
    documents: string;
    probeSample128: string;
    vectors?: string;
  };
  recordsSha256: string;
}

export interface DocumentFilterOptions {
  kind?: SearchRecordKind;
  language?: LanguageTag;
  origin?: string;
  query?: string;
}

export interface RevalidationResult {
  isValid: boolean;
  reason:
    | "DELETED"
    | "STATUS_INELIGIBLE"
    | "PARENT_INELIGIBLE"
    | "ROBOT_INELIGIBLE"
    | "CONTRIBUTION_INELIGIBLE"
    | "INVENTORY_HIDDEN"
    | "CONTENT_CHANGED"
    | "DEPENDENCY_CHANGED"
    | null;
  currentContentHash?: string;
  expectedContentHash?: string;
  currentDoc?: SearchDocument | null;
}
