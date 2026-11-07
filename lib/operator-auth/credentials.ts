import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ParsedPasswordHash } from "./config";

const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key)));
}

export async function hashOperatorPassword(password: string): Promise<string> {
  if ([...password].length < 20 || Buffer.byteLength(password, "utf8") > 1024) throw new Error("Passphrase must have at least 20 characters and at most 1024 UTF-8 bytes.");
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$32768$8$3$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyOperatorPassword(password: string, hash: ParsedPasswordHash): Promise<boolean> {
  const actual = await derive(password, hash.salt);
  return timingSafeEqual(actual, hash.derivedKey);
}

/** A slot is transferred directly to the next waiter, so new arrivals cannot jump the queue. */
export class DerivationQueue {
  private active = false;
  private readonly waiting: Array<() => void> = [];
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active) {
      if (this.waiting.length >= 4) throw new Error("Derivation capacity exceeded");
      await new Promise<void>(resolve => this.waiting.push(resolve));
    } else this.active = true;
    try { return await operation(); }
    finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active = false;
    }
  }
}

export const processDerivationQueue = new DerivationQueue();
