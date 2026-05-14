export type NotificationChannel =
  | "email"
  | "sms"
  | "push"
  | "slack"
  | "whatsapp"
  | "in_app";

export interface SendNotificationParams {
  tenantId: string;
  recipientId: string;
  workflowId: string;
  channel?: NotificationChannel[];
  payload: Record<string, unknown>;
}
