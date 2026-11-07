import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import type { ReadStream, WriteStream } from "node:tty";
import { hashOperatorPassword } from "../lib/operator-auth/credentials";
import { loadAuthEnvironment, readOperatorConfig } from "../lib/operator-auth/config";

/** Passwords are read only from a terminal with echo disabled, never argv/files/pipes. */
export async function readHiddenPassphrase(prompt: string, input: ReadStream = process.stdin, output: WriteStream = process.stderr): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") throw new Error("An interactive terminal is required");
  output.write(prompt);
  const wasRaw = input.isRaw;
  return new Promise((resolveInput, reject) => {
    let value = "";
    const decoder = new StringDecoder("utf8");
    const finish = (error?: Error) => {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("error", onError);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
      if (error) reject(error); else resolveInput(value);
    };
    const onEnd = () => finish(new Error("Input closed"));
    const onError = () => finish(new Error("Terminal input failed"));
    const onData = (chunk: Buffer | string) => {
      for (const char of typeof chunk === "string" ? chunk : decoder.write(chunk)) {
        if (char === "\u0003") { finish(new Error("Cancelled")); return; }
        if (char === "\r" || char === "\n") { finish(); return; }
        if (char === "\u007f" || char === "\b") value = [...value].slice(0, -1).join("");
        else if (char.codePointAt(0)! >= 32) value += char;
        if (Buffer.byteLength(value, "utf8") > 1024) { finish(new Error("Passphrase too long")); return; }
      }
    };
    input.setRawMode(true);
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
    input.resume();
  });
}

export function envHashAssignment(hash: string): string { return `OPERATOR_PASSWORD_HASH="${hash.replaceAll("$", "\\$")}"`; }

export async function runOperatorAuthCli(args: string[]): Promise<number> {
  const [command, flag, expected, ...extra] = args;
  if (!command || !["hash", "fingerprint", "init", "activate", "revoke-all"].includes(command) || (command === "activate" ? flag !== "--expected" || !expected || !/^[a-f0-9]{64}$/.test(expected) || extra.length > 0 : args.length !== 1)) {
    process.stderr.write("Usage: operator-auth.ts hash|fingerprint|init|activate --expected <active-fingerprint>|revoke-all\n");
    return 2;
  }
  try {
    if (command === "hash") {
      const password = await readHiddenPassphrase("New operator passphrase (20+ characters): ");
      const confirmation = await readHiddenPassphrase("Confirm passphrase: ");
      if (password !== confirmation) throw new Error("Passphrases differ");
      process.stdout.write(envHashAssignment(await hashOperatorPassword(password)) + "\n");
      return 0;
    }
    loadAuthEnvironment();
    const config = readOperatorConfig();
    if (!config) throw new Error("Invalid configuration");
    if (command === "fingerprint") { process.stdout.write(config.fingerprint + "\n"); return 0; }
    const [{ PrismaClient }, { createPostgresAuthStore }] = await Promise.all([import("../generated/prisma"), import("../lib/operator-auth/postgres-store")]);
    const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl, log: [] });
    try {
      const store = createPostgresAuthStore(prisma);
      if (command === "init") {
        if (!await store.initialize(config)) throw new Error("Already initialized");
      } else if (command === "activate") {
        if (!await store.activate(config, expected!)) throw new Error("Activation refused");
      } else await store.revokeAll();
      process.stdout.write(command === "revoke-all" ? "Existing operator sessions revoked.\n" : `Operator configuration active: ${config.fingerprint}\n`);
      return 0;
    } finally { await prisma.$disconnect(); }
  } catch {
    // Database/crypto/configuration errors can carry credentials. Never print them.
    process.stderr.write("Operator authentication command failed. Check configuration, active fingerprint and database availability.\n");
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = await runOperatorAuthCli(process.argv.slice(2));
