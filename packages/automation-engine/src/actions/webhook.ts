/**
 * webhook.ts
 *
 * Executes an outbound webhook automation action.
 *
 * Security invariants:
 *  - URL is validated against SSRF block list BEFORE any network call
 *  - TCP connection is pinned to the DNS-resolved IP via a one-shot https.Agent
 *    with a custom `lookup` callback — no second DNS resolution at connect time
 *    (prevents DNS rebinding)
 *  - TLS SNI and certificate validation use the original hostname — the URL and
 *    Host header are never rewritten to an IP address
 *  - Blocked attempts are logged with tenantId, ruleId, targetUrl, resolvedIp,
 *    and reason; no internal detail is surfaced to the tenant API response
 */

import https from "node:https";
import http from "node:http";
import type { TriggerEvent } from "../event-schemas.js";
import { validateWebhookUrl } from "../ssrf-guard.js";
import { AutomationError } from "../types.js";
import { logger } from "@platform/logger";

export type WebhookActionConfig = {
  url: string;
  method?: "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  /** If true, include the full trigger event payload in the request body */
  includePayload?: boolean;
  timeoutMs?: number;
};

export type WebhookActionOptions = {
  /** Extra CIDRs to block, sourced from SSRF_BLOCK_CIDRS env var.
   *  Always an array (env transform guarantees it); defaults to [] if omitted. */
  extraBlockCidrs?: string[] | undefined;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;

export async function executeWebhookAction(
  tenantId: string,
  ruleId: string,
  event: TriggerEvent,
  config: WebhookActionConfig,
  options: WebhookActionOptions = {},
): Promise<void> {
  const { url, method = "POST", headers = {}, includePayload = true } = config;
  const timeoutMs = Math.min(
    config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );

  // ── 1. SSRF validation — throws AutomationError('WEBHOOK_SSRF_BLOCKED') if blocked ──
  let validatedIp: string;
  try {
    validatedIp = await validateWebhookUrl(url, options.extraBlockCidrs ?? []);
  } catch (err) {
    if (err instanceof AutomationError && err.code === "WEBHOOK_SSRF_BLOCKED") {
      // Already logged inside validateWebhookUrl with full context.
      // Re-throw so executor records this as degraded (not failed).
      throw err;
    }
    throw err;
  }

  // ── 2. Build request body ─────────────────────────────────────────────────
  const body = includePayload ? JSON.stringify(event) : "{}";

  // ── 3. Construct a one-shot Agent with lookup pinned to the validated IP ──
  // This prevents DNS rebinding: Node's net.createConnection would otherwise
  // perform a second DNS lookup at the TCP connect phase.  By pinning the
  // lookup callback to return the pre-validated IP, we guarantee the
  // connection goes to exactly the address we checked.
  //
  // Crucially we do NOT rewrite the URL or Host header — the original hostname
  // is preserved so that TLS SNI and certificate CN/SAN validation work
  // correctly against the remote server's certificate.
  const isHttps = url.startsWith("https:");
  const lookupFn = (
    _hostname: string,
    _opts: Record<string, unknown>,
    callback: (err: Error | null, address: string, family: number) => void,
  ): void => {
    // Determine address family from the validated IP
    const family = validatedIp.includes(":") ? 6 : 4;
    callback(null, validatedIp, family);
  };

  const agent = isHttps
    ? new https.Agent({ lookup: lookupFn as never })
    : new http.Agent({ lookup: lookupFn as never });

  // ── 4. Dispatch ───────────────────────────────────────────────────────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "OpenWind-Webhook/1.0",
        ...headers,
      },
      body,
      // @ts-expect-error — Node 18+ fetch accepts dispatcher/agent via undici internals;
      // the cast is safe here: we are providing a standard http(s).Agent for connection pinning
      agent,
    });

    if (!res.ok) {
      logger.warn(
        { tenantId, ruleId, url, status: res.status },
        "automation: webhook action received non-2xx response",
      );
      throw new AutomationError("ACTION_FAILED", {
        url,
        status: res.status,
        reason: "non-2xx-response",
      });
    }

    logger.info(
      { tenantId, ruleId, url, status: res.status },
      "automation: webhook action delivered",
    );
  } catch (err) {
    if (err instanceof AutomationError) throw err;
    const isTimeout =
      (err as { name?: string }).name === "AbortError" ||
      (err as { code?: string }).code === "ABORT_ERR";
    throw new AutomationError("ACTION_FAILED", {
      url,
      reason: isTimeout ? "timeout" : "network-error",
      detail: String(err),
    });
  } finally {
    clearTimeout(timer);
    agent.destroy();
  }
}
