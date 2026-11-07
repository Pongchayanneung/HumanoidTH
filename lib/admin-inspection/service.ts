import type { SessionResult } from "../operator-auth/contracts";
import type { CmsCollection, InspectionInput, InspectionRepository, InspectionResult } from "./contracts";

function isCollection(value: unknown): value is CmsCollection {
  return value === "source-records" || value === "robot-models" ||
    value === "contributions" || value === "submitted-data";
}

function readSelection(input: InspectionInput): { collection: CmsCollection; id: string } | null {
  try {
    if (!Object.hasOwn(input, "collection") || !Object.hasOwn(input, "selectedId")) return null;
    const { collection, selectedId: id } = input;
    if (!isCollection(collection) || typeof id !== "string") return null;
    // Lone surrogates cannot round-trip through PostgreSQL's UTF-8 encoding.
    if (id.length > 256 || Buffer.byteLength(id, "utf8") > 256 ||
        !id.trim() || id === "new" || /[\p{Cc}\p{Cs}]/u.test(id)) return null;
    return { collection, id };
  } catch {
    return null;
  }
}

export function createInspectionService({ authorize, repository }: {
  authorize(): Promise<SessionResult>;
  repository(): Promise<InspectionRepository>;
}): { inspectCmsRecord(input: InspectionInput): Promise<InspectionResult> } {
  return {
    async inspectCmsRecord(input) {
      try {
        const session = await authorize();
        if (!session.ok) return { ok: false, code: session.code };

        const selection = readSelection(input);
        if (!selection) return { ok: false, code: "INVALID_SELECTION" };

        const { collection, id } = selection;
        const record = await (await repository()).findExact(collection, id);
        if (!record) return { ok: false, code: "NOT_FOUND" };
        if (record.collection !== collection || record.id !== id) return { ok: false, code: "UNAVAILABLE" };
        return { ok: true, record };
      } catch {
        return { ok: false, code: "UNAVAILABLE" };
      }
    }
  };
}
