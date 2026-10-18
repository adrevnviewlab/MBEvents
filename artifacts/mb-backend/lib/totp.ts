function binary(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array) {
  let value = 0;
  let bits = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string) {
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let value = 0;
  let bits = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function counterBytes(counter: number) {
  const bytes = new Uint8Array(8);
  let rest = counter;
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  return bytes;
}

// RFC 4226 / 6238, SHA-1, 6 digits. Compatible with authenticator apps.
export async function hotp(secret: Uint8Array, counter: number, digits = 6) {
  const key = await crypto.subtle.importKey("raw", binary(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes(counter)));
  const offset = signature[signature.length - 1] & 0x0f;
  const bin = ((signature[offset] & 0x7f) << 24)
    | (signature[offset + 1] << 16)
    | (signature[offset + 2] << 8)
    | signature[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export async function totp(secret: Uint8Array, atMs = Date.now(), stepSeconds = 30) {
  const counter = Math.floor(atMs / 1000 / stepSeconds);
  return hotp(secret, counter);
}

export async function totpMatches(secret: Uint8Array, code: string, atMs = Date.now()) {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const step = 30_000;
  for (const drift of [-step, 0, step]) {
    if ((await totp(secret, atMs + drift)) === normalized) return true;
  }
  return false;
}

export function newTotpSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}
