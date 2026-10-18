const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array(hex.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? []);

async function aesKey(material: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// Encrypts MFA secrets at rest. The key comes from MB_MFA_ENCRYPTION_KEY and is never stored.
export async function seal(plain: string, material: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(material), new TextEncoder().encode(plain)));
  return `${toHex(iv)}.${toHex(cipher)}`;
}

export async function openSeal(payload: string, material: string) {
  const [iv, cipher] = payload.split(".");
  if (!iv || !cipher) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(iv) }, await aesKey(material), fromHex(cipher));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
