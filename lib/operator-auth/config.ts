import { createHash } from "node:crypto";
import nextEnv from "@next/env";

export type ParsedPasswordHash = Readonly<{ salt: Buffer; derivedKey: Buffer }>;
export type OperatorConfig = Readonly<{
  email: string; passwordHash: string; parsedHash: ParsedPasswordHash;
  epoch: string; origin: string; databaseUrl: string; fingerprint: string;
  production: boolean; secureCookie: boolean;
}>;

/** Shared CLI/server loading; process environment always wins. Never logs env values. */
export function loadAuthEnvironment(): void {
  const mode = process.env.NODE_ENV || "development";
  nextEnv.loadEnvConfig(process.cwd(), mode === "development", { info() {}, error() {} });
}

export function normalizeOperatorEmail(email: string): string { return email.trim().toLowerCase(); }

export function parsePasswordHash(value: string): ParsedPasswordHash | null {
  const match = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(value);
  return match ? { salt: Buffer.from(match[1], "hex"), derivedKey: Buffer.from(match[2], "hex") } : null;
}

export function configurationFingerprint(config: Pick<OperatorConfig, "email" | "passwordHash" | "epoch" | "origin">): string {
  return createHash("sha256").update(JSON.stringify(["operator-auth-v1", config.email, config.passwordHash, config.epoch, config.origin])).digest("hex");
}

export function readOperatorConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): OperatorConfig | null {
  const rawEmail = env.OPERATOR_EMAIL;
  const passwordHash = env.OPERATOR_PASSWORD_HASH;
  const epoch = env.OPERATOR_AUTH_EPOCH;
  const originValue = env.OPERATOR_APP_ORIGIN;
  const databaseUrl = env.DATABASE_URL;
  if (!rawEmail || rawEmail.length > 254 || !passwordHash || !epoch || epoch.length > 256 || !epoch.trim() || !originValue || !databaseUrl) return null;
  const email = normalizeOperatorEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const parsedHash = parsePasswordHash(passwordHash);
  if (!parsedHash) return null;
  try {
    const originUrl = new URL(originValue);
    const dbUrl = new URL(databaseUrl);
    const production = env.NODE_ENV === "production";
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(originUrl.hostname);
    if (originUrl.username || originUrl.password || originUrl.search || originUrl.hash || originUrl.pathname !== "/") return null;
    if (originUrl.protocol !== "https:" && !(originUrl.protocol === "http:" && local && !production)) return null;
    if (!["postgres:", "postgresql:"].includes(dbUrl.protocol)) return null;
    const canonical = { email, passwordHash, epoch, origin: originUrl.origin };
    return { ...canonical, parsedHash, databaseUrl, fingerprint: configurationFingerprint(canonical), production, secureCookie: originUrl.protocol === "https:" };
  } catch { return null; }
}
