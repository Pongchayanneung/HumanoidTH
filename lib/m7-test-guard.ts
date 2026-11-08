/** Require an explicitly confirmed, dedicated test database in addition to the local seed guard. */
export function assertM7Disposable(connectionString: string | undefined, env: Record<string, string | undefined>): void {
  if (env.M7_DISPOSABLE_DATABASE !== "yes") throw new Error("Set M7_DISPOSABLE_DATABASE=yes only for a dedicated disposable test database.");
  const name = connectionString ? new URL(connectionString).pathname.slice(1) : "";
  if (!/^m7_disposable_[a-z0-9_]+$/.test(name)) throw new Error("M7 requires a database named m7_disposable_<suffix>.");
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
