/** One entry of FastAPI's 422 body; `loc` is the path to the rejected value, starting at "body". */
export interface ValidationIssue {
  loc: (string | number)[];
  msg: string;
  type: string;
}

/** Field paths listed per message before "+N more". */
const MAX_PATHS = 5;

/** The rejected value's path without the leading "body": `generate.inputs[1]`. */
function fieldPath(loc: (string | number)[]): string {
  const segments = loc[0] === "body" ? loc.slice(1) : loc;
  const path = segments
    .map((seg, i) => (typeof seg === "number" ? `[${seg}]` : i === 0 ? seg : `.${seg}`))
    .join("");
  return path || "request body";
}

/**
 * The validation issues of a 422 as one line for a toast, the fields grouped
 * under each message: a page built before a field was renamed is refused for
 * every old name with the same "Extra inputs are not permitted".
 */
export function formatValidationIssues(issues: ValidationIssue[]): string | null {
  const byMessage = new Map<string, string[]>();
  for (const issue of issues) {
    const paths = byMessage.get(issue.msg) ?? [];
    paths.push(fieldPath(issue.loc));
    byMessage.set(issue.msg, paths);
  }
  const lines = [...byMessage].map(([msg, paths]) => {
    const more = paths.length > MAX_PATHS ? ` +${paths.length - MAX_PATHS} more` : "";
    return `${paths.slice(0, MAX_PATHS).join(", ")}${more}: ${msg}`;
  });
  return lines.length > 0 ? lines.join("; ") : null;
}

/** A refusal of Enso's routes: a code, its message and the fields it names,
 * such as the free space a 507 counts. */
export interface Refusal {
  code: string;
  message: string;
  [field: string]: unknown;
}

/** A 422 issue with the value it refused: an upload ref or a hash for
 * `upload_missing`. */
export interface Issue extends ValidationIssue {
  input?: unknown;
}

function detailOf(body: unknown): unknown {
  return typeof body === "object" && body !== null
    ? (body as { detail?: unknown }).detail
    : undefined;
}

/** The refusal a body carries, inside sdnext's error envelope or bare; null
 * for any other body. sdnext's envelope keeps the status as its own `code`. */
export function refusalIn(body: unknown): Refusal | null {
  const detail = detailOf(body);
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return null;
  const { code, message } = detail as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string" ? (detail as Refusal) : null;
}

/** The issue list a 422 body carries; null for any other body. */
export function issuesIn(body: unknown): Issue[] | null {
  const detail = detailOf(body);
  return Array.isArray(detail) ? (detail as Issue[]) : null;
}

/**
 * The reason a failed response gives, as one line: FastAPI's string detail, its
 * validation issues, a refusal's message, the exception sdnext's handler
 * reports in `errors` (with its class from `error`), or a plain-text body.
 * Null when there is none, including an HTML error page from a proxy.
 */
export function formatErrorDetail(body: unknown): string | null {
  if (typeof body === "string") {
    const text = body.trim();
    return text && !text.startsWith("<") ? text.split("\n")[0] : null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { detail, error, errors } = body as { detail?: unknown; error?: unknown; errors?: unknown };
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) return formatValidationIssues(detail as ValidationIssue[]);
  const refusal = refusalIn(body);
  if (refusal) return refusal.message;
  if (typeof errors === "string" && errors.trim()) {
    const reason = errors.trim().split("\n")[0];
    return typeof error === "string" && error ? `${error}: ${reason}` : reason;
  }
  return null;
}
