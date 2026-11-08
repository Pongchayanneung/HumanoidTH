import { DEFAULT_MODEL_PROFILE, type ModelProfile } from "./vector-types";

/**
 * Frozen Semantic Retrieval Policy for Atlas Search (F8).
 * Pinned to the model profile and shared with F5 (Ranking) and F6 (API).
 */
export interface SemanticRetrievalPolicy {
  policyVersion: string;
  boundProfileHash: string;
  semanticCutoffThreshold: number; // Minimum cosine similarity for semantic admission (see calibrationStatus)
  /**
   * "provisional_uncalibrated": the cutoff has no measured support. It must be re-derived
   * on the dev split against the real embedding model before it is relied on.
   * "demo_unvalidated": the same unvalidated cutoff, but semantic-first ranking is switched on for a
   * demo (ATLAS_SEMANTIC_DEMO=1). Results are labelled as an experiment; this is NOT a calibration.
   */
  calibrationStatus: "provisional_uncalibrated" | "calibrated_on_dev_split" | "demo_unvalidated";
  rrfConstantK: number;            // Constant k for Reciprocal Rank Fusion: 1 / (k + rank)
  lexicalWeights: {
    title: number;
    body: number;
  };
  limits: {
    maxQueryCodePoints: number;
    defaultResultLimit: number;
    maxResultLimit: number;
    candidatesPerBranch: number;
    maxCurrentRecordChecks: number;
  };
  queryInstructionTask: string;
  createdAt: string;
  frozenAt: string;
  isFrozen: boolean;
}

/**
 * The pinned Atlas Search policy parameters for Hackathon delivery.
 * "Frozen" means the values are pinned so F5 and F6 agree on them. It does NOT mean
 * they were calibrated: no real embedding model has been evaluated against this pilot.
 */
export const FROZEN_SEMANTIC_POLICY: SemanticRetrievalPolicy = {
  policyVersion: "1.0-frozen",
  boundProfileHash: DEFAULT_MODEL_PROFILE.profileHash,
  // PROVISIONAL, UNCALIBRATED placeholder. No measurement supports 0.62: the only run used
  // deterministic mock vectors (semantic MRR and P@3 were 0). Re-derive it on the dev split
  // against the real embedding model (the profile bound above) before relying on it.
  semanticCutoffThreshold: 0.62,
  calibrationStatus: "provisional_uncalibrated",
  rrfConstantK: 60,
  lexicalWeights: {
    title: 4.0,
    body: 1.0
  },
  limits: {
    maxQueryCodePoints: 300,
    defaultResultLimit: 10,
    maxResultLimit: 20,
    candidatesPerBranch: 50,
    maxCurrentRecordChecks: 200
  },
  queryInstructionTask: DEFAULT_MODEL_PROFILE.queryInstructionTask,
  createdAt: "2026-11-07T08:00:00.000Z",
  frozenAt: "2026-11-07T08:00:00.000Z",
  isFrozen: true
};

/**
 * Demo policy: same pinned numbers as FROZEN_SEMANTIC_POLICY (cutoff 0.62 is still unvalidated),
 * with a status that turns the semantic branch on in semantic-first order. Only
 * createSemanticOptionsFromEnv selects it, and only when ATLAS_SEMANTIC_DEMO=1.
 */
export const DEMO_SEMANTIC_POLICY: SemanticRetrievalPolicy = {
  ...FROZEN_SEMANTIC_POLICY,
  policyVersion: "1.0-demo",
  calibrationStatus: "demo_unvalidated"
};

/**
 * Validates whether a model profile is compatible with the frozen semantic policy.
 */
export function isProfileCompatibleWithPolicy(
  profile: ModelProfile | null | undefined,
  policy: SemanticRetrievalPolicy = FROZEN_SEMANTIC_POLICY
): boolean {
  if (!profile) return false;
  return profile.profileHash === policy.boundProfileHash && profile.dimensions === 1024 && profile.normalized;
}
