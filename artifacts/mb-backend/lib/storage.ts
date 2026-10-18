import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
import { readConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";

export type StoredBody = { bytes: Uint8Array; contentType: string };

export interface FileStore {
  put(key: string, body: StoredBody): Promise<void>;
  get(key: string): Promise<StoredBody | null>;
  delete(key: string): Promise<void>;
}

const keyPattern = /^[a-z0-9][a-z0-9/_-]{0,180}$/i;

export function assertStorageKey(key: string) {
  if (!keyPattern.test(key) || key.includes("..")) throw new AppError("Invalid file key.", 400);
  return key;
}

function localRoot() {
  return readConfig().MB_FILE_DIR || join(process.cwd(), ".data", "files");
}

function localPath(key: string) {
  const root = normalize(localRoot());
  const path = normalize(join(root, assertStorageKey(key)));
  const fromRoot = relative(root, path);
  if (fromRoot.startsWith("..") || fromRoot === "") throw new AppError("Invalid file key.", 400);
  return path;
}

const localStore: FileStore = {
  async put(key, body) {
    const path = localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body.bytes);
    await writeFile(`${path}.type`, body.contentType.slice(0, 200));
  },
  async get(key) {
    try {
      const path = localPath(key);
      const bytes = new Uint8Array(await readFile(path));
      const contentType = await readFile(`${path}.type`, "utf8").catch(() => "application/octet-stream");
      return { bytes, contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  async delete(key) {
    const path = localPath(key);
    await rm(path, { force: true });
    await rm(`${path}.type`, { force: true });
  },
};

function binary(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function hmac(key: ArrayBuffer, data: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data)));
}

function encodePath(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

// S3-compatible PUT/GET/DELETE. Used when MB_FILE_STORAGE=s3 and the bucket env vars are set.
function s3Store(): FileStore {
  const config = readConfig();
  const bucket = config.MB_S3_BUCKET;
  const region = config.MB_S3_REGION;
  const accessKey = config.MB_S3_ACCESS_KEY_ID;
  const secret = config.MB_S3_SECRET_ACCESS_KEY;
  if (!bucket || !region || !accessKey || !secret) {
    throw new AppError("File storage is not configured.", 503);
  }
  const s3Region = region;
  const s3Secret = secret;
  const s3Key = accessKey;
  const endpoint = (config.MB_S3_ENDPOINT || `https://${bucket}.s3.${s3Region}.amazonaws.com`).replace(/\/$/, "");

  async function signedFetch(method: string, key: string, body?: Uint8Array, contentType?: string) {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const day = stamp.slice(0, 8);
    const host = new URL(endpoint).host;
    const path = `/${encodePath(assertStorageKey(key))}`;
    const payloadHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", body ? binary(body) : new ArrayBuffer(0))), (b) => b.toString(16).padStart(2, "0")).join("");
    const headers: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": stamp,
    };
    if (contentType) headers["content-type"] = contentType;
    const names = Object.keys(headers).sort();
    const canonical = [
      method,
      path,
      "",
      names.map((name) => `${name}:${headers[name]}`).join("\n") + "\n",
      names.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${day}/${s3Region}/s3/aws4_request`;
    const requestHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))), (b) => b.toString(16).padStart(2, "0")).join("");
    const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${requestHash}`;
    const kDate = await hmac(binary(new TextEncoder().encode(`AWS4${s3Secret}`)), day);
    const kRegion = await hmac(binary(kDate), s3Region);
    const kService = await hmac(binary(kRegion), "s3");
    const kSigning = await hmac(binary(kService), "aws4_request");
    const signature = Array.from(await hmac(binary(kSigning), toSign), (b) => b.toString(16).padStart(2, "0")).join("");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${s3Key}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
    return fetch(`${endpoint}${path}`, { method, headers, body: body ? binary(body) : undefined });
  }

  return {
    async put(key, body) {
      const response = await signedFetch("PUT", key, body.bytes, body.contentType);
      if (!response.ok) throw new AppError("File storage rejected the upload.", 502);
    },
    async get(key) {
      const response = await signedFetch("GET", key);
      if (response.status === 404) return null;
      if (!response.ok) throw new AppError("File storage could not be read.", 502);
      return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "application/octet-stream" };
    },
    async delete(key) {
      const response = await signedFetch("DELETE", key);
      if (!response.ok && response.status !== 404) throw new AppError("File storage could not delete that file.", 502);
    },
  };
}

export function fileStore(): FileStore {
  const mode = readConfig().MB_FILE_STORAGE ?? "local";
  return mode === "s3" ? s3Store() : localStore;
}
