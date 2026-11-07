import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parse } from "dotenv";

export const browserOrigin = "http://localhost:3104";
export const operatorEmail = "acceptance@example.invalid";
// Synthetic, disposable test credentials; never use an operator's real values.
export const operatorPassword = "  disposable acceptance passphrase 2026  ";

const loopbackHosts = ["localhost", "127.0.0.1"];
const scratchPort = "5544";

type SqlResult<T> = { rows: T[]; rowCount: number | null };
export type SqlClient = {
  connect(): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<SqlResult<T>>;
  end(): Promise<void>;
};
const require = createRequire(import.meta.url);
const { Client } = require("pg") as {
  Client: new (options: { connectionString: string }) => SqlClient & {
    connectionParameters: { host: string; port: number };
  };
};

export function disposablePostgresUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Tests require a valid native PostgreSQL URL"); }
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Tests require native PostgreSQL");
  assert.ok(loopbackHosts.includes(url.hostname) && url.port === scratchPort, "Only the approved localhost:5544 disposable PostgreSQL is allowed");
  // pg gives connection-string query values precedence over the URL authority.
  assert.ok(!/[?#]/.test(url.href), "Disposable PostgreSQL URLs cannot have query parameters or fragments");
  return url;
}

export function scratchBaseUrl(): string {
  assert.equal(process.env.ISSUE4_AUTH_ACCEPTANCE, "1", "Explicit ISSUE4_AUTH_ACCEPTANCE=1 is required for disposable database tests");
  const localFile = resolve(".env.auth.local");
  const local = existsSync(localFile) ? parse(readFileSync(localFile)) : {};
  const value = process.env.ISSUE4_TEST_DATABASE_URL || local.DATABASE_URL;
  assert.ok(value, "Provide the dedicated test URL in ISSUE4_TEST_DATABASE_URL or ignored .env.auth.local");
  return disposablePostgresUrl(value).toString();
}

export function databaseUrl(name: string): string {
  assert.match(name, /^hri_issue4_acceptance_[a-z0-9_]+$/);
  const url = new URL(scratchBaseUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

export async function openSql(url: string): Promise<SqlClient> {
  const sql = new Client({ connectionString: disposablePostgresUrl(url).toString() });
  const { host, port } = sql.connectionParameters;
  assert.ok(loopbackHosts.includes(host) && port === Number(scratchPort), "PostgreSQL must resolve to the approved local fixture port");
  await sql.connect();
  return sql;
}

/** Creates a new database only. Replays committed migrations, never reset/push/seed. */
export async function createAcceptanceDatabase(name = `hri_issue4_acceptance_${Date.now()}_${randomBytes(3).toString("hex")}`) {
  const url = databaseUrl(name);
  const admin = await openSql(scratchBaseUrl());
  try { await admin.query(`CREATE DATABASE "${name}"`); }
  finally { await admin.end(); }
  const sql = await openSql(url);
  try {
    const directory = resolve("prisma/migrations");
    for (const migration of readdirSync(directory, { withFileTypes: true }).filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      await sql.query(readFileSync(resolve(directory, migration.name, "migration.sql"), "utf8"));
    }
    // Names are useful for the review/cleanup ledger; credentials are never printed.
    process.stdout.write(`Acceptance scratch database: ${name}\n`);
    return { name, url, sql };
  } catch (error) {
    await sql.end();
    throw error;
  }
}

export function syntheticEnvironment(url: string, passwordHash: string, epoch = "acceptance-epoch-one") {
  return {
    DATABASE_URL: url,
    OPERATOR_EMAIL: operatorEmail,
    OPERATOR_PASSWORD_HASH: passwordHash,
    OPERATOR_AUTH_EPOCH: epoch,
    OPERATOR_APP_ORIGIN: browserOrigin,
    NODE_ENV: "development" as const
  };
}

export async function businessSnapshot(sql: SqlClient): Promise<string> {
  const tables = await sql.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('OperatorAuthState', 'OperatorSession', '_prisma_migrations') ORDER BY tablename");
  const contents: unknown[] = [];
  for (const { tablename } of tables.rows) {
    assert.match(tablename, /^[A-Za-z][A-Za-z0-9_]*$/);
    const result = await sql.query<{ row: unknown }>(`SELECT to_jsonb(item) AS row FROM "${tablename}" AS item ORDER BY to_jsonb(item)::text`);
    contents.push([tablename, result.rows.map(item => item.row)]);
  }
  return JSON.stringify(contents);
}
