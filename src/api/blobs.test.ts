import { afterEach, describe, expect, it, vi } from "vitest";

const PAGE = "http://localhost:5174";
const HASH = "a".repeat(64);

/** An XMLHttpRequest the test answers by hand. */
class FakeXhr {
  static sent: FakeXhr[] = [];
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  statusText = "";
  responseText = "";
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
    FakeXhr.sent.push(this);
  }
  abort() {
    this.onabort?.();
  }
  answer(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

async function load() {
  vi.resetModules();
  FakeXhr.sent = [];
  vi.stubGlobal("window", { location: { origin: PAGE } });
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  const client = await import("./client");
  const blobs = await import("./blobs");
  const abort = await import("@/lib/abort");
  return { ...client, ...blobs, UserAbortError: abort.UserAbortError };
}

const stored = (created: boolean) => ({
  hash: HASH,
  size: 3,
  type: "image/png",
  ext: "png",
  name: "a.png",
  ref: `upload:${HASH}`,
  url: `/sdapi/v2/blobs/${HASH}`,
  created,
});

/** sdnext's envelope around a refusal of Enso's routes. */
const refused = (status: number, detail: Record<string, unknown>) => ({
  error: "HTTPException",
  code: status,
  detail,
  errors: `${status}: ${JSON.stringify(detail)}`,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ingest", () => {
  it("posts the raw bytes with their name and the credentials, and reports progress", async () => {
    const { api, ingest } = await load();
    api.setAuth("alice", "pw");
    const progress: number[] = [];
    const blob = new Blob(["abc"]);
    const sent = ingest(blob, {
      name: "a b.png",
      transient: true,
      onProgress: (n) => progress.push(n),
    });
    const xhr = FakeXhr.sent[0];
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(`${PAGE}/sdapi/v2/blobs?name=a+b.png&transient=true`);
    expect(xhr.headers).toEqual({
      Authorization: `Basic ${btoa("alice:pw")}`,
      "Content-Type": "application/octet-stream",
    });
    expect(xhr.body).toBe(blob);
    xhr.upload.onprogress?.({ loaded: 2 });
    xhr.answer(201, stored(true));
    await expect(sent).resolves.toMatchObject({ hash: HASH, created: true });
    expect(progress).toEqual([2]);
  });

  it("answers bytes the server held already", async () => {
    const { ingest } = await load();
    const sent = ingest(new Blob(["abc"]));
    FakeXhr.sent[0].answer(200, stored(false));
    await expect(sent).resolves.toMatchObject({ created: false });
  });

  it("reads a refusal for space as the room the server has and the bytes it needs", async () => {
    const { ingest, UploadRefused } = await load();
    const sent = ingest(new Blob(["x".repeat(300)]));
    // free 600, needed = 300 declared + 500 reserve: the server can take 100
    FakeXhr.sent[0].answer(
      507,
      refused(507, {
        code: "insufficient_storage",
        message: "Not enough space",
        free: 600,
        needed: 800,
      }),
    );
    const err = await sent.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadRefused);
    expect((err as InstanceType<typeof UploadRefused>).failure).toEqual({
      kind: "space",
      room: 100,
      needed: 300,
    });
  });

  it("reads the media store being off with the server's reason", async () => {
    const { ingest } = await load();
    const sent = ingest(new Blob(["abc"]));
    FakeXhr.sent[0].answer(
      503,
      refused(503, { code: "media_store_off", message: "Media store off: /x is not writable" }),
    );
    await expect(sent).rejects.toThrow("Media store off: /x is not writable");
  });

  it("stops on the signal, and reads a lost connection as a network failure", async () => {
    const { ingest, UploadRefused, UserAbortError } = await load();
    const controller = new AbortController();
    const stopped = ingest(new Blob(["abc"]), { signal: controller.signal });
    controller.abort();
    await expect(stopped).rejects.toBeInstanceOf(UserAbortError);
    const lost = ingest(new Blob(["abc"]));
    FakeXhr.sent[1].onerror?.();
    await expect(lost).rejects.toBeInstanceOf(UploadRefused);
    await expect(lost).rejects.toThrow("The server could not be reached");
  });
});

describe("claim", () => {
  it("asks in chunks of a thousand, the bytes with the first, and merges the answers", async () => {
    const { api, claim } = await load();
    const hashes = Array.from({ length: 1500 }, (_, i) => i.toString(16).padStart(64, "0"));
    const post = vi.spyOn(api, "post").mockImplementation((_path, body) => {
      const asked = (body as { hashes: string[] }).hashes;
      return Promise.resolve({
        present: asked.slice(0, 1),
        missing: asked.slice(1),
        lost: [],
        space: { ok: true, free: 100, needed: (body as { bytes: number }).bytes },
      });
    });
    const answer = await claim(hashes, 42);
    expect(post.mock.calls.map(([, body]) => (body as { bytes: number }).bytes)).toEqual([42, 0]);
    expect(answer.present).toEqual([hashes[0], hashes[1000]]);
    expect(answer.missing).toHaveLength(1498);
    expect(answer.space).toEqual({ ok: true, free: 100, needed: 42 });
  });

  it("asks once with no hashes, for the room alone", async () => {
    const { api, claim } = await load();
    const post = vi.spyOn(api, "post").mockResolvedValue({
      present: [],
      missing: [],
      lost: [],
      space: { ok: true, free: 9, needed: 3 },
    });
    await claim([], 3);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("ApiError", () => {
  it("carries the code of a refusal inside sdnext's envelope", async () => {
    const { ApiError } = await load();
    const err = new ApiError(
      409,
      "Conflict",
      refused(409, { code: "pins_full", message: "Up to 20 entries can be pinned", max: 20 }),
    );
    expect(err.code).toBe("pins_full");
    expect(err.detail?.["max"]).toBe(20);
    expect(err.message).toBe("API Error 409: Up to 20 entries can be pinned");
  });
});
