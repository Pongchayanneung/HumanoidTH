/** Types shared by the guarded inspector and its administrator views. */
export type CmsCollection =
  | "source-records" | "robot-models" | "contributions" | "submitted-data";

export type InspectionRecord = Readonly<{
  collection: CmsCollection;
  id: string;
  displayName: string;
  summary: string | null;
  status: string | null;
  url: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type InspectionResult =
  | { ok: true; record: InspectionRecord }
  | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" | "INVALID_SELECTION" | "NOT_FOUND" };

export type InspectionInput = Readonly<{
  collection: unknown;
  selectedId: unknown;
}>;

export interface InspectionRepository {
  findExact(collection: CmsCollection, id: string): Promise<InspectionRecord | null>;
}
