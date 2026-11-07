import type { OperatorConfig } from "./config";
export type ActivationConfig = Pick<OperatorConfig, "fingerprint" | "epoch">;
export type Admission = { kind: "ADMITTED" } | { kind: "INACTIVE" } | { kind: "THROTTLED"; retryAfterSeconds: number };
export interface OperatorAuthStore {
  reserveAttempt(fingerprint: string): Promise<Admission>;
  issueSession(input: { fingerprint: string; tokenHash: string }): Promise<Date | null>;
  readSession(input: { fingerprint: string; tokenHash: string }): Promise<boolean>;
  revokeSession(tokenHash: string): Promise<void>;
  initialize(config: ActivationConfig): Promise<boolean>;
  activate(config: ActivationConfig, expectedFingerprint: string): Promise<boolean>;
  revokeAll(): Promise<void>;
}
