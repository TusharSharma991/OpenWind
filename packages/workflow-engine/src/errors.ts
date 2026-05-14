export type WorkflowErrorCode =
  | "INSTANCE_NOT_FOUND"
  | "TRANSITION_NOT_AVAILABLE"
  | "TRANSITION_FORBIDDEN"
  | "CONDITION_NOT_MET"
  | "REQUIRED_FIELDS_MISSING"
  | "SLA_TIMER_FAILED";

export class WorkflowError extends Error {
  constructor(
    public readonly code: WorkflowErrorCode,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "WorkflowError";
  }
}
