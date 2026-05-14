import type { z } from "zod";

export interface ConnectorContext<TCredentials = Record<string, unknown>> {
  tenantId: string;
  credentials: TCredentials;
  callApi: (config: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
  }) => Promise<Response>;
  log: (
    level: "info" | "warn" | "error",
    message: string,
    meta?: object,
  ) => void;
}

export interface TriggerDefinition {
  id: string;
  name: string;
  description: string;
  type: "webhook" | "polling";
  webhook?: {
    validateSignature: (request: Request, secret: string) => Promise<boolean>;
    transform: (rawPayload: unknown) => Promise<Record<string, unknown>>;
  };
  polling?: {
    intervalMinutes: number;
    fetch: (
      ctx: ConnectorContext,
      cursor?: string,
    ) => Promise<{
      events: Record<string, unknown>[];
      nextCursor?: string;
    }>;
  };
}

export interface ActionDefinition {
  id: string;
  name: string;
  description: string;
  input: z.ZodSchema;
  output: z.ZodSchema;
  execute: (input: unknown, ctx: ConnectorContext) => Promise<unknown>;
  rateLimit?: { requestsPerMinute: number; requestsPerDay?: number };
  retryConfig?: {
    maxAttempts: number;
    backoffMs: number;
    retryOn: (error: Error) => boolean;
  };
}

export interface ConnectorDefinition<TCredentials = Record<string, unknown>> {
  meta: {
    id: string;
    name: string;
    version: string;
    description: string;
    iconUrl: string;
    docsUrl?: string;
    category:
      | "communication"
      | "finance"
      | "crm"
      | "hr"
      | "storage"
      | "ecommerce"
      | "other";
  };
  auth: Record<string, unknown>;
  triggers: TriggerDefinition[];
  actions: ActionDefinition[];
  onInstall?: (ctx: ConnectorContext<TCredentials>) => Promise<void>;
  onUninstall?: (ctx: ConnectorContext<TCredentials>) => Promise<void>;
}
