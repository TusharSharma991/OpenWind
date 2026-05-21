/**
 * regex-safety.ts
 *
 * Wraps the `recheck` library (async ReDoS detector) to provide a single
 * boolean predicate used at field config-save time.
 *
 * `isSafeRegex` is intentionally NOT called on the validation hot-path
 * (i.e. not inside buildZodSchema / buildFieldSchema).  It is only invoked
 * when an admin saves a field definition, making the cost of the recheck
 * analysis (typically a few milliseconds) acceptable.
 *
 * Behaviour:
 * - Returns `true`  — pattern is valid regex AND not ReDoS-vulnerable
 * - Returns `false` — pattern is invalid regex OR recheck reports VULNERABLE
 * - If recheck itself throws unexpectedly, we log a warning and return `false`
 *   (fail-safe: reject the pattern rather than allowing potentially unsafe input)
 */

import { check } from "recheck";
import { logger } from "@platform/logger";

/**
 * Returns `true` when `pattern` is a syntactically valid regex that recheck
 * judges SAFE or UNKNOWN.  Returns `false` for invalid syntax or VULNERABLE.
 *
 * @param pattern — raw regex string (without surrounding /…/ delimiters)
 * @param flags   — optional regex flags forwarded to recheck (default: "")
 */
export async function isSafeRegex(
  pattern: string,
  flags = "",
): Promise<boolean> {
  // First check: is it syntactically valid?
  try {
    new RegExp(pattern, flags);
  } catch {
    // Invalid regex — reject it before handing to recheck
    return false;
  }

  try {
    const result = await check(pattern, flags);
    // recheck returns status "safe" | "vulnerable" | "unknown".
    // When timeout occurs recheck throws { kind: "timeout" } (see catch block).
    if (result.status === "vulnerable") {
      logger.warn(
        { pattern, flags, status: result.status },
        "entity-engine: rejected ReDoS-vulnerable regex pattern",
      );
      return false;
    }
    return true;
  } catch (err) {
    // recheck throws { kind: "timeout" } when the analyser runs out of time.
    // Treat timeout as fail-closed: a pattern complex enough to exhaust the
    // static analyser is highest-risk and must be rejected.
    //
    // Guard: recheck could theoretically throw a primitive (string, number) or
    // null in a future version.  Narrow to object before accessing `.kind` so
    // we never get a runtime TypeError on `null.kind` or similar.
    const kind =
      typeof err === "object" && err !== null
        ? (err as { kind?: string }).kind
        : undefined;
    if (kind === "timeout") {
      logger.warn(
        { pattern, flags },
        "entity-engine: rejected regex pattern — recheck timed out (fail-closed)",
      );
      return false;
    }
    // Unexpected error — fail-safe: reject the pattern
    logger.warn(
      { pattern, flags, err },
      "entity-engine: recheck threw unexpectedly — rejecting pattern (fail-safe)",
    );
    return false;
  }
}
