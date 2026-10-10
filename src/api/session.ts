import { create } from "zustand";
import { api, ApiError } from "./client";
import type { SessionInfo } from "./types/server";
import { base64ToObjectUrl } from "@/lib/utils";

/** How media loads and sockets carry the credential they cannot send as a header. */
export type SessionMode =
  /** Not known yet: media elements wait for it. */
  | "pending"
  /** The server asks for no credentials. */
  | "open"
  /** The session cookie rides every load from this origin. */
  | "cookie"
  /** The base is on another origin: ?t= on media URLs, a ticket per socket. */
  | "token"
  /** A server without sessions: bare URLs, a ticket per socket. */
  | "legacy"
  /** The session request failed: bare URLs and tickets until one succeeds. */
  | "unavailable";

interface SessionState {
  mode: SessionMode;
  token: string | null;
  expiresAt: number;
  /** Advances whenever the mode or the token changes; a load refused before it may be tried again. */
  epoch: number;
}

export const useSessionStore = create<SessionState>()(() => ({
  mode: "pending",
  token: null,
  expiresAt: 0,
  epoch: 0,
}));

const HINT_KEY = "enso-session-mode";
const RENEW_BEFORE_MS = 60 * 60 * 1000;
const RENEW_GAP_MS = 10_000;

let inflight: Promise<void> | null = null;
let requested = 0;
let attemptedAt = 0;
let renewTimer: ReturnType<typeof setTimeout> | null = null;

/** The mode this base settled on last time, when media can load before it is confirmed. */
function readHint(base: string): SessionMode | null {
  try {
    const hint = JSON.parse(localStorage.getItem(HINT_KEY) ?? "null") as {
      base?: unknown;
      mode?: unknown;
    } | null;
    if (hint?.base !== base) return null;
    return hint.mode === "open" || hint.mode === "legacy" ? hint.mode : null;
  } catch {
    return null;
  }
}

function writeHint(base: string, mode: SessionMode) {
  try {
    localStorage.setItem(HINT_KEY, JSON.stringify({ base, mode }));
  } catch {
    // the hint only saves a round trip at the next start
  }
}

function crossOrigin(): boolean {
  try {
    return new URL(api.getBaseUrl()).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function scheduleRenewal(expiresAt: number) {
  if (renewTimer) clearTimeout(renewTimer);
  renewTimer = null;
  if (!expiresAt) return;
  const delay = Math.max(expiresAt - RENEW_BEFORE_MS - Date.now(), 60_000);
  renewTimer = setTimeout(() => void ensureSession(), delay);
}

function settle(mode: SessionMode, token: string | null, expiresAt: number) {
  const before = useSessionStore.getState();
  const changed = before.mode !== mode || before.token !== token;
  useSessionStore.setState({
    mode,
    token,
    expiresAt,
    epoch: changed ? before.epoch + 1 : before.epoch,
  });
  if (mode !== "unavailable") writeHint(api.getBaseUrl(), mode);
  scheduleRenewal(expiresAt);
}

async function requestSession(): Promise<void> {
  const request = ++requested;
  attemptedAt = Date.now();
  try {
    const info = await api.post<SessionInfo>("/sdapi/v2/session");
    if (request !== requested) return;
    if (!info.required) settle("open", null, 0);
    else settle(crossOrigin() ? "token" : "cookie", info.token ?? null, info.expires_at ?? 0);
  } catch (err) {
    if (request !== requested) return;
    if (err instanceof ApiError && err.status === 404) settle("legacy", null, 0);
    // Refused: the server asks for credentials this page lacks, so no earlier answer holds
    else if (err instanceof ApiError && (err.status === 401 || err.status === 403))
      settle("unavailable", null, 0);
    else if (useSessionStore.getState().mode === "pending") settle("unavailable", null, 0);
  }
}

/** Ask the server for a session; concurrent callers share one request. */
export function ensureSession(): Promise<void> {
  inflight ??= requestSession().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Start over for the stored connection: at page start and whenever the base or the credentials change. */
export function startSession(): Promise<void> {
  const hint = readHint(api.getBaseUrl());
  useSessionStore.setState((s) => ({
    mode: hint ?? "pending",
    token: null,
    expiresAt: 0,
    epoch: s.epoch + 1,
  }));
  inflight = null;
  return ensureSession();
}

/** End the session this page holds on the server, before the credentials or the base change, so nothing
 * they admitted outlives them. A server without sessions, or one that already forgot this one, has nothing
 * to end. */
export async function endSession(): Promise<void> {
  const { mode, token } = useSessionStore.getState();
  if (mode !== "cookie" && mode !== "token") return;
  try {
    await api.delete("/sdapi/v2/session", mode === "token" && token ? { t: token } : undefined);
  } catch {
    // nothing left to end
  }
}

/** Resolves once the mode is known; asks again while the last request failed. */
export async function sessionReady(): Promise<void> {
  const { mode } = useSessionStore.getState();
  if (mode === "pending" || mode === "unavailable") await ensureSession();
}

/** After a load the server refused: whether trying again can succeed, renewing the session when it may
 * have gone stale. A renewal since the load started answers yes at once; attempts are spaced 10 s apart. */
export async function renewAfterFailure(loadEpoch: number): Promise<boolean> {
  if (useSessionStore.getState().epoch > loadEpoch) return true;
  if (useSessionStore.getState().mode === "legacy") return false;
  if (!inflight && Date.now() - attemptedAt < RENEW_GAP_MS) return false;
  await ensureSession();
  return useSessionStore.getState().epoch > loadEpoch;
}

/** After a socket was refused (1008): whether a reconnect can be admitted now. */
export async function renewForSocket(): Promise<boolean> {
  const before = useSessionStore.getState().epoch;
  await ensureSession();
  const { mode, epoch } = useSessionStore.getState();
  return epoch > before || mode === "token" || mode === "legacy";
}

/** The URL a media element or a fetch loads: server paths on the configured base, carrying the session
 * token when the base is on another origin. data: and blob: URLs pass through. */
export function mediaUrl(url: string): string {
  if (!url.startsWith("/")) return url;
  const full = `${api.getBaseUrl()}${url}`;
  const { mode, token } = useSessionStore.getState();
  if (mode !== "token" || !token || !url.startsWith("/sdapi/")) return full;
  return `${full}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}

/** A src for an element showing a stored image: a server path through mediaUrl, a URL as given, raw
 * base64 (results from before durable output URLs) as an object URL. */
export function mediaSrc(image: string): string {
  if (image.startsWith("/") || /^(data|blob|https?):/.test(image)) return mediaUrl(image);
  return base64ToObjectUrl(image);
}

/** fetch for a media URL; a refusal renews the session and tries once more. */
export async function fetchMedia(url: string, init?: RequestInit): Promise<Response> {
  await sessionReady();
  const epoch = useSessionStore.getState().epoch;
  const response = await fetch(mediaUrl(url), init);
  if (response.status !== 401 || !(await renewAfterFailure(epoch))) return response;
  return fetch(mediaUrl(url), init);
}

function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be loaded"));
    image.src = src;
  });
}

/** An image element for a stored image (anything mediaSrc takes); a failed load renews the session and
 * tries once more. */
export async function loadMediaImage(image: string): Promise<HTMLImageElement> {
  await sessionReady();
  const epoch = useSessionStore.getState().epoch;
  try {
    return await decodeImage(mediaSrc(image));
  } catch (err) {
    if (!(await renewAfterFailure(epoch))) throw err;
    return decodeImage(mediaSrc(image));
  }
}

/** A socket URL on the base, with a single-use ticket unless the session cookie admits the socket. */
export async function socketUrl(path: string): Promise<string> {
  await sessionReady();
  const url = api.getWebSocketUrl(path);
  const { mode } = useSessionStore.getState();
  if (mode === "open" || mode === "cookie") return url;
  try {
    const ticket = await api.getWsTicket();
    return `${url}${url.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(ticket)}`;
  } catch {
    return url;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const { expiresAt } = useSessionStore.getState();
    if (
      document.visibilityState === "visible" &&
      expiresAt &&
      expiresAt - Date.now() < RENEW_BEFORE_MS
    )
      void ensureSession();
  });
}
