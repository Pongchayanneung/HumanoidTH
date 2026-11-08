import React from "react";

export default function DatasetScopeNotice({ scopeLabel }: { scopeLabel: string }) {
  return (
    <div className="notice" style={{ background: "rgba(59, 130, 246, 0.08)", borderColor: "var(--accent)", marginBottom: "16px" }}>
      <strong>Dataset Scope:</strong> Whole Eligible Public Corpus ({scopeLabel}). Analytics aggregate all eligible public records across the atlas (accepted sources, catalogued robot models, and approved contributions). Unreviewed submissions, private inventory, and excluded placeholders are strictly omitted.
    </div>
  );
}
