import { DEFAULT_MODEL_PROFILE, type ModelProfile } from "./vector-types";

/**
 * Frozen Semantic Retrieval Policy for Atlas Search (F8).
 * Pinned to the model profile and shared with F5 (Ranking) and F6 (API).
 */
export interface SemanticRetrievalPolicy {
  policyVersion: string;
  boundProfileHash: string;
  semanticCutoffThreshold: number; // Minimum cosine similarity for semantic admission
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
 * The frozen Atlas Search policy agreed for Hackathon delivery.
 * Calibrated using the 12-query development pilot slice.
 */
export const FROZEN_SEMANTIC_POLICY: SemanticRetrievalPolicy = {
  policyVersion: "1.0-frozen",
  boundProfileHash: DEFAULT_MODEL_PROFILE.profileHash,
  // 0.62 cutoff admits strong cross-lingual semantics while cleanly suppressing unrelated queries
  semanticCutoffThreshold: 0.62,
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
 * Validates whether a model profile is compatible with the frozen semantic policy.
 */
export function isProfileCompatibleWithPolicy(
  profile: ModelProfile | null | undefined,
  policy: SemanticRetrievalPolicy = FROZEN_SEMANTIC_POLICY
): boolean {
  if (!profile) return false;
  return profile.profileHash === policy.boundProfileHash && profile.dimensions === 1024 && profile.normalized;
}
