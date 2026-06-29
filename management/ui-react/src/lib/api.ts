// Typed client for the Mail-in-a-Box control panel API.
//
// The API is the same one the legacy panel uses, served at /admin/*. Requests
// authenticate with HTTP Basic auth where the password is either the user's
// real password (only during login) or a session key returned by /login.
// Responses are sometimes JSON and sometimes plain text, so the request layer
// inspects the content type.

const API_BASE = "/admin";

export interface Credentials {
  username: string;
  session_key: string;
  privileges?: string[];
}

let credentials: Credentials | null = loadCredentials();

function loadCredentials(): Credentials | null {
  for (const store of [sessionStorage, localStorage]) {
    const raw = store.getItem("miab-cp-credentials");
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

export function getCredentials(): Credentials | null {
  return credentials;
}

export function setCredentials(c: Credentials, remember: boolean) {
  credentials = c;
  const raw = JSON.stringify(c);
  if (remember) {
    localStorage.setItem("miab-cp-credentials", raw);
    sessionStorage.removeItem("miab-cp-credentials");
  } else {
    sessionStorage.setItem("miab-cp-credentials", raw);
    localStorage.removeItem("miab-cp-credentials");
  }
}

export function clearCredentials() {
  credentials = null;
  localStorage.removeItem("miab-cp-credentials");
  sessionStorage.removeItem("miab-cp-credentials");
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Form fields (sent url-encoded) or a raw string body. */
  data?: Record<string, string> | string;
  /** Override the auth header, e.g. during login. */
  auth?: { username: string; password: string };
  headers?: Record<string, string>;
}

async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };

  const auth = opts.auth ?? (credentials && { username: credentials.username, password: credentials.session_key });
  if (auth) {
    headers["Authorization"] = "Basic " + btoa(`${auth.username}:${auth.password}`);
  }

  let body: string | undefined;
  if (typeof opts.data === "string") {
    body = opts.data;
    headers["Content-Type"] = "text/plain; charset=ascii";
  } else if (opts.data) {
    body = new URLSearchParams(opts.data).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const resp = await fetch(API_BASE + path, {
    method: opts.method ?? (opts.data ? "POST" : "GET"),
    headers,
    body,
  });

  const text = await resp.text();
  const isJson = resp.headers.get("content-type")?.includes("application/json");
  const parsed = isJson && text ? JSON.parse(text) : text;

  if (!resp.ok) {
    if (resp.status === 403) clearCredentials();
    const message = typeof parsed === "string" && parsed ? parsed : resp.statusText;
    throw new ApiError(message, resp.status);
  }
  return parsed as T;
}

export const apiGet = <T = unknown>(path: string) => request<T>(path);
export const apiPost = <T = unknown>(path: string, data?: Record<string, string> | string) =>
  request<T>(path, { method: "POST", data });

// ---------- WebAuthn helpers (base64url <-> ArrayBuffer) ----------

export const webauthnSupported = typeof window.PublicKeyCredential !== "undefined";

function b64urlToBuf(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function prepareCreation(options: any): any {
  options.challenge = b64urlToBuf(options.challenge);
  options.user.id = b64urlToBuf(options.user.id);
  (options.excludeCredentials ?? []).forEach((c: any) => (c.id = b64urlToBuf(c.id)));
  return options;
}

function prepareRequest(options: any): any {
  options.challenge = b64urlToBuf(options.challenge);
  (options.allowCredentials ?? []).forEach((c: any) => (c.id = b64urlToBuf(c.id)));
  return options;
}

function serializeAttestation(cred: any): string {
  return JSON.stringify({
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {
      attestationObject: bufToB64url(cred.response.attestationObject),
      clientDataJSON: bufToB64url(cred.response.clientDataJSON),
    },
    transports: cred.response.getTransports ? cred.response.getTransports() : [],
    clientExtensionResults: cred.getClientExtensionResults(),
  });
}

function serializeAssertion(cred: any): string {
  return JSON.stringify({
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {
      authenticatorData: bufToB64url(cred.response.authenticatorData),
      clientDataJSON: bufToB64url(cred.response.clientDataJSON),
      signature: bufToB64url(cred.response.signature),
      userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : null,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function createPasskey(options: unknown): Promise<string> {
  const cred = await navigator.credentials.create({ publicKey: prepareCreation(options) });
  return serializeAttestation(cred);
}

export async function signPasskey(options: unknown): Promise<string> {
  const cred = await navigator.credentials.get({ publicKey: prepareRequest(options) });
  return serializeAssertion(cred);
}

// ---------- Login ----------

export interface LoginResult {
  status: "ok" | "missing-totp-token" | "missing-webauthn" | "invalid";
  reason?: string;
  email?: string;
  privileges?: string[];
  api_key?: string;
  webauthn_options?: unknown;
  invalid?: boolean;
}

export async function login(
  email: string,
  password: string,
  opts: { totp?: string; webauthnAssertion?: string } = {}
): Promise<LoginResult> {
  return request<LoginResult>("/login", {
    method: "POST",
    auth: { username: email, password },
    data: opts.webauthnAssertion ? { webauthn_assertion: opts.webauthnAssertion } : {},
    headers: opts.totp ? { "x-auth-token": opts.totp } : {},
  });
}

export async function logout() {
  try {
    await apiPost("/logout");
  } catch {
    /* ignore */
  }
  clearCredentials();
}

// ---------- Typed domain models & endpoints ----------

export interface MailUser {
  email: string;
  privileges: string[];
  status: "active" | "inactive";
  quota: string;
  box_size: string;
  percent: string;
  mailbox: string;
}
export interface UserDomain {
  domain: string;
  users: MailUser[];
}
export const getUsers = () => apiGet<UserDomain[]>("/mail/users?format=json");

export interface Alias {
  address: string;
  address_display: string;
  forwards_to: string[];
  permitted_senders: string[] | null;
  auto: boolean;
  required: boolean;
}
export interface AliasDomain {
  domain: string;
  aliases: Alias[];
}
export const getAliases = () => apiGet<AliasDomain[]>("/mail/aliases?format=json");

export interface PgpKeyStatus {
  email: string;
  has_key: boolean;
  fingerprint?: string;
  uids?: string[];
}
export const getPgpKey = (email: string) =>
  apiGet<PgpKeyStatus>("/mail/users/pgp?email=" + encodeURIComponent(email));

export interface MfaFactor {
  id: number;
  type: string;
  label: string;
}
export interface MfaStatus {
  enabled_mfa: MfaFactor[];
  new_mfa?: { totp?: { secret: string; qr_code_base64: string } };
}
export const getMfaStatus = (user?: string) =>
  apiPost<MfaStatus>("/mfa/status", user ? { user } : undefined);

export interface StatusItem {
  type: "heading" | "ok" | "error" | "warning";
  text: string;
  extra: { text: string; monospace: boolean }[];
}
export const getSystemStatus = () => apiPost<StatusItem[]>("/system/status");
export const getVersion = () => apiGet<string>("/system/version");
