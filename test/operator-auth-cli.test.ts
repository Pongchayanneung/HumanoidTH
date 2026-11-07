import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ReadStream, WriteStream } from "node:tty";
import { test } from "node:test";
import { envHashAssignment, readHiddenPassphrase } from "../scripts/operator-auth";

class Terminal extends EventEmitter {
  isTTY = true; isRaw = false; paused = false;
  setRawMode(raw: boolean) { this.isRaw = raw; return this; }
  pause() { this.paused = true; return this; }
  resume() { return this; }
}

test("provisioning terminal hides input, preserves whitespace and restores terminal on cancellation", async () => {
  const input = new Terminal();
  let printed = "";
  const output = { isTTY: true, write: (chunk: string) => { printed += chunk; } } as WriteStream;
  const reading = readHiddenPassphrase("Passphrase: ", input as unknown as ReadStream, output);
  assert.equal(input.isRaw, true);
  input.emit("data", Buffer.from("  synthetic passphrase  \r"));
  assert.equal(await reading, "  synthetic passphrase  ");
  assert.equal(printed, "Passphrase: \n");
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount("data"), 0);
  const cancelled = readHiddenPassphrase("Passphrase: ", input as unknown as ReadStream, output);
  input.emit("data", Buffer.from("synthetic\u0003"));
  await assert.rejects(() => cancelled, /Cancelled/);
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount("data"), 0);
});

test("provisioning rejects pipes and produces Next-compatible escaped env assignment", async () => {
  await assert.rejects(() => readHiddenPassphrase("Passphrase: ", { isTTY: false } as ReadStream, { isTTY: false } as WriteStream), /terminal/);
  assert.equal(envHashAssignment("scrypt$32768$8$3$salt$key"), 'OPERATOR_PASSWORD_HASH="scrypt\\$32768\\$8\\$3\\$salt\\$key"');
});

test("hidden input preserves Thai/emoji when terminal splits UTF-8 bytes differently between confirmations", async () => {
  const password = "ภาษาไทย synthetic passphrase 🤖  ";
  const bytes = Buffer.from(password + "\r");
  const output = { isTTY: true, write: () => {} } as unknown as WriteStream;
  const input = new Terminal();
  const reading = readHiddenPassphrase("Passphrase: ", input as unknown as ReadStream, output);
  for (const byte of bytes) input.emit("data", Buffer.from([byte]));
  const first = await reading;
  const confirmation = readHiddenPassphrase("Confirm: ", input as unknown as ReadStream, output);
  input.emit("data", bytes);
  assert.equal(first, password);
  assert.equal(await confirmation, first);
});
