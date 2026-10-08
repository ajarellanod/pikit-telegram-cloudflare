/**
 * github-app's cryptography, Web Crypto only (a Worker has nothing else):
 *
 * - **Encryption at rest** (`credentialsKey`, `seal`, `unseal`): AES-256-GCM with a key derived by
 *   HKDF-SHA256 from the operators' token (`PIKIT_ADMIN_TOKEN`), `info` naming this use, so the
 *   key is no other component's (admin-auth-token derives its sessions' with another `info`). A sealed
 *   value is `v1.<iv>.<ciphertext>` in base64url. Changing the admin token makes it unreadable: the
 *   operator connects again.
 * - **The App's JWT** (`appJwt`): RS256 over the App's private key, as GitHub asks to authenticate as
 *   the App (https://docs.github.com/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app):
 *   `iat` a minute back (clock drift), `exp` nine minutes on (GitHub takes ten at most), `iss` the
 *   App's client id. GitHub gives the key as PKCS#1 (`BEGIN RSA PRIVATE KEY`), which `importKey` does
 *   not take: `pkcs8Of` wraps it in PKCS#8's DER.
 * - **Random values and digests** (`randomToken`, `sha256`): the connection's `state` and its browser
 *   nonce, stored as digests only.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** What the credentials' key is derived for: another use of the admin token gets another key. */
const CREDENTIALS_INFO = "pikit github-app credentials v1";

// Copied: Workers' types say `encode` may answer a view of a shared buffer, which `crypto.subtle` does not take.
const bytesOf = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(encoder.encode(text));

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 32 random bytes, base64url: a `state`, a nonce. */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 of `text`, base64url: what is stored of a `state` or a nonce. */
export async function sha256(text: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", bytesOf(text))));
}

/** The AES-GCM key of the stored credentials, derived from `secret` (the admin token). */
export async function credentialsKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", bytesOf(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: bytesOf(CREDENTIALS_INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** `plaintext` encrypted with `key`: `v1.<iv>.<ciphertext>`. */
export async function seal(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytesOf(plaintext)));
  return `v1.${toBase64Url(iv)}.${toBase64Url(sealed)}`;
}

/** What `seal` sealed; rejects when `key` is not the one it was sealed with (the admin token changed). */
export async function unseal(key: CryptoKey, sealed: string): Promise<string> {
  const [version, iv, data] = sealed.split(".");
  if (version !== "v1" || iv === undefined || data === undefined) throw new Error("not a sealed value");
  return decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(iv) }, key, fromBase64Url(data)));
}

/** A DER element: `tag`, its length, `content`. */
function der(tag: number, content: Uint8Array): Uint8Array {
  const length: number[] = [];
  if (content.length < 0x80) length.push(content.length);
  else {
    for (let n = content.length; n > 0; n >>= 8) length.unshift(n & 0xff);
    length.unshift(0x80 | length.length);
  }
  const out = new Uint8Array(1 + length.length + content.length);
  out[0] = tag;
  out.set(length, 1);
  out.set(content, 1 + length.length);
  return out;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/** rsaEncryption's AlgorithmIdentifier: OID 1.2.840.113549.1.1.1, NULL parameters. */
const RSA_ALGORITHM = der(0x30, new Uint8Array([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]));

/** The PKCS#8 DER of a PEM private key: `BEGIN PRIVATE KEY` as it is, `BEGIN RSA PRIVATE KEY` (PKCS#1, GitHub's) wrapped. */
export function pkcs8Of(pem: string): Uint8Array<ArrayBuffer> {
  const match = /-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (?:RSA )?PRIVATE KEY-----/.exec(pem);
  if (match === null) throw new Error("not a PEM private key");
  const body = fromBase64Url((match[2] as string).replace(/\s+/g, "").replace(/=+$/, ""));
  if (match[1] === undefined) return body;
  // PrivateKeyInfo ::= SEQUENCE { version INTEGER 0, algorithm, privateKey OCTET STRING (the PKCS#1 key) }
  return new Uint8Array(der(0x30, concat(new Uint8Array([0x02, 0x01, 0x00]), RSA_ALGORITHM, der(0x04, body))));
}

/** The JWT GitHub takes as the App `issuer` (its client id), signed with its `pem` key, at `now` (ms). */
export async function appJwt(pem: string, issuer: string, now: number): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Of(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const seconds = Math.floor(now / 1000);
  const part = (value: unknown) => toBase64Url(bytesOf(JSON.stringify(value)));
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: seconds - 60, exp: seconds + 9 * 60, iss: issuer })}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, bytesOf(unsigned)));
  return `${unsigned}.${toBase64Url(signature)}`;
}
