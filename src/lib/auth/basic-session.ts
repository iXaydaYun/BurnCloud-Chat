const encoder = new TextEncoder();

const DEFAULT_COOKIE_NAME = "burncloud_basic_session";
const DEFAULT_LOGOUT_COOKIE_NAME = "burncloud_basic_logout";

export const BASIC_USER_HEADER = "x-basic-auth-user";

type Credential = { username: string; password: string };

let cachedCredentials: Credential[] | null = null;

async function sha256Hex(value: string): Promise<string> {
  const subtle =
    typeof globalThis.crypto !== "undefined"
      ? globalThis.crypto.subtle
      : undefined;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", encoder.encode(value));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  const cryptoModule = await import("node:crypto");
  return cryptoModule.createHash("sha256").update(value).digest("hex");
}

export function getSessionCookieName() {
  return process.env.BASIC_AUTH_SESSION_COOKIE || DEFAULT_COOKIE_NAME;
}

export function getLogoutCookieName() {
  return process.env.BASIC_AUTH_LOGOUT_COOKIE || DEFAULT_LOGOUT_COOKIE_NAME;
}

export function getSessionTtlSeconds() {
  const ttl = Number(process.env.BASIC_AUTH_SESSION_TTL ?? "3600");
  return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 3600;
}

export function loadBasicCredentials(): Credential[] {
  if (cachedCredentials) return cachedCredentials;
  const raw = process.env.BASIC_AUTH_USERS ?? "";
  cachedCredentials = raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [username, password] = pair.split(":");
      return {
        username: username?.trim() ?? "",
        password: password ?? "",
      } satisfies Credential;
    })
    .filter((item) => item.username.length > 0 && item.password.length > 0);
  return cachedCredentials;
}

export async function generateSessionValue(
  username: string,
  expiresAt: number,
  secret: string,
) {
  const payload = `${username}|${expiresAt}`;
  const signature = await sha256Hex(`${payload}|${secret}`);
  return `${payload}|${signature}`;
}

export type SessionPayload = {
  username: string;
  expiresAt: number;
};

export async function verifySessionValue(
  value: string | undefined,
  secret: string,
): Promise<SessionPayload | null> {
  if (!value) return null;
  const [username, expiresRaw, signature] = value.split("|");
  if (!username || !expiresRaw || !signature) return null;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) {
    return null;
  }
  const expectedSignature = await sha256Hex(
    `${username}|${expiresAt}|${secret}`,
  );
  if (expectedSignature !== signature) return null;
  return { username, expiresAt };
}

export function findCredential(
  username: string,
  password: string,
): Credential | null {
  return (
    loadBasicCredentials().find(
      (cred) => cred.username === username && cred.password === password,
    ) ?? null
  );
}

export function extractCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
) {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(/;\s*/);
  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return undefined;
}

export async function resolveBasicUserFromHeaders(
  headers: Headers,
): Promise<string | null> {
  const headerUser = headers.get(BASIC_USER_HEADER);
  if (headerUser) return headerUser;
  const secret = process.env.BASIC_AUTH_SESSION_SECRET;
  if (!secret) return null;
  const cookieName = getSessionCookieName();
  const cookieValue = extractCookieValue(headers.get("cookie"), cookieName);
  if (!cookieValue) return null;
  const payload = await verifySessionValue(cookieValue, secret);
  return payload?.username ?? null;
}
