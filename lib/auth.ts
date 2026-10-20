const encoder = new TextEncoder();

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET environment variable is required to sign admin sessions.");
  }
  return secret;
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function signAdminSession(email: string): Promise<string> {
  const payload = btoa(email);
  const signature = await hmacSha256Hex(getSecret(), payload);
  return `${payload}.${signature}`;
}

export async function verifyAdminSession(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = await hmacSha256Hex(getSecret(), payload);
  if (expected.length !== signature.length) return null;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (diff !== 0) return null;

  try {
    return atob(payload);
  } catch {
    return null;
  }
}
