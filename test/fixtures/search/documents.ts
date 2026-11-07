import type { SearchDocument } from "../../../lib/search/types";

function document(typedId: string, kind: SearchDocument["kind"], title: string, excerpt: string): SearchDocument {
  return {
    typedId, kind, title, body: excerpt, retrievalText: title + " " + excerpt,
    url: null, groupId: typedId, origin: "fixture", language: "mixed", isTitleOnly: false,
    isPartial: false, parentTypedId: null, contentHash: "fake", dependencyHash: "fake",
    vectorRow: 7, metadata: { vector: [1, 2], score: 42 },
    evidence: [title, excerpt].map((originalText, i) => ({ fieldName: i ? "excerpt" : "title", originalText, label: i ? "Excerpt" : "Title", coverage: "full", startOffset: 0, endOffset: originalText.length })),
  };
}
export const documents = [
  document("source:fake-1", "source", "Robot research", "A 😀 robot supports researchers."),
  document("robot:fake-2", "robot", "หุ่นยนต์ทดลอง", "หุ่นยนต์ช่วยนักวิจัย"),
];
