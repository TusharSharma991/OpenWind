export type NotificationErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "TEMPLATE_NOT_FOUND"
  | "INVALID_RECIPIENT"
  | "DELIVERY_FAILED";

export class NotificationError extends Error {
  constructor(
    public readonly code: NotificationErrorCode,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "NotificationError";
  }
}
