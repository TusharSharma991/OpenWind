import React, { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../lib/api.js";
import { useEntityTypes } from "../../entity-type-context.js";
import { userManager } from "../../authProvider.js";

type EntityField = {
  id: string;
  name: string;
  label: string;
  fieldType: string;
  isSystem: boolean;
  isRequired: boolean;
  config: {
    options?: Array<string | { label: string; value: string; color?: string }>;
    allowedCurrencies?: string[];
  };
};
type EntityInstance = {
  id: string;
  workflowId: string | null;
  currentState: string | null;
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  assignedTo: string | null;
};
type Transition = {
  id: string;
  fromState: string;
  toState: string;
  label: string;
  requiresComment: boolean;
};
type WorkflowState = {
  id: string;
  name: string;
  label: string;
  color: string | null;
  isTerminal: boolean;
};
type WorkflowEvent = {
  id: string;
  fromState: string | null;
  toState: string;
  actorId: string;
  actorDisplayName?: string | null;
  comment: string | null;
  triggeredAt: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};
type OrgUser = {
  userId: string;
  email: string;
  displayName: string | null;
  loginName?: string;
};

/* ── Field display ───────────────────────────────────────────── */
function FieldValue({
  value,
  fieldType,
  field,
}: {
  value: unknown;
  fieldType: string;
  field?: EntityField;
}): React.ReactElement {
  if (value === null || value === undefined)
    return <span className="rcd-muted">—</span>;
  if (fieldType === "boolean") {
    const bv = Boolean(value);
    return (
      <span className={`portal-bool-badge ${bv ? "yes" : "no"}`}>
        {bv ? "Yes" : "No"}
      </span>
    );
  }
  if (fieldType === "date" || fieldType === "datetime") {
    const d = new Date(value as string);
    return (
      <span>{isNaN(d.getTime()) ? String(value) : d.toLocaleString()}</span>
    );
  }
  if (fieldType === "currency" && typeof value === "object") {
    const cv = value as { amount?: unknown; currency?: unknown };
    return (
      <span>
        {String(cv.currency ?? "")}{" "}
        {cv.amount !== null && cv.amount !== undefined
          ? String(cv.amount)
          : "—"}
      </span>
    );
  }
  if ((fieldType === "enum" || fieldType === "multi_enum") && field) {
    const strVal = String(value);
    const opts = field.config.options ?? [];
    const match = opts.find(
      (o) => (typeof o === "string" ? o : o.value) === strVal,
    );
    const label = match
      ? typeof match === "string"
        ? match
        : match.label
      : strVal;
    const color = match && typeof match !== "string" ? match.color : undefined;
    return (
      <span
        className="portal-enum-badge"
        style={
          color
            ? {
                borderLeft: `3px solid ${color}`,
                background: `${color}18`,
                color,
              }
            : undefined
        }
      >
        {label}
      </span>
    );
  }
  return <span>{String(value)}</span>;
}

/* ── Field input (edit mode) ─────────────────────────────────── */
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: EntityField;
  value: unknown;
  onChange: (v: unknown) => void;
}): React.ReactElement {
  const strVal = value === null || value === undefined ? "" : String(value);
  switch (field.fieldType) {
    case "boolean":
      return (
        <label className="portal-checkbox">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
    case "number":
      return (
        <input
          className="portal-input"
          type="number"
          value={strVal}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
        />
      );
    case "currency": {
      const currVal =
        value !== null && typeof value === "object"
          ? (value as { amount?: unknown; currency?: unknown })
          : { amount: "", currency: "" };
      const amountStr =
        currVal.amount === null || currVal.amount === undefined
          ? ""
          : String(currVal.amount);
      const currencyStr =
        currVal.currency === null || currVal.currency === undefined
          ? ""
          : String(currVal.currency);
      const allowed = field.config.allowedCurrencies ?? [];
      const currencies =
        allowed.length > 0 ? allowed : ["USD", "EUR", "GBP", "INR", "AED"];
      return (
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            className="portal-input"
            type="number"
            placeholder="0.00"
            value={amountStr}
            style={{ flex: 1 }}
            onChange={(e) =>
              onChange({
                amount: e.target.value === "" ? null : Number(e.target.value),
                currency: currencyStr || currencies[0],
              })
            }
          />
          <select
            className="portal-input"
            value={currencyStr || currencies[0]}
            style={{ width: "90px" }}
            onChange={(e) =>
              onChange({
                amount: amountStr === "" ? null : Number(amountStr),
                currency: e.target.value,
              })
            }
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case "date":
      return (
        <input
          className="portal-input"
          type="date"
          value={strVal}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "datetime":
      return (
        <input
          className="portal-input"
          type="datetime-local"
          value={strVal}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "enum":
    case "multi_enum": {
      const opts = (field.config.options ?? []).map((o) =>
        typeof o === "string"
          ? { label: o, value: o }
          : { label: o.label, value: o.value },
      );
      return (
        <select
          className="portal-input"
          value={strVal}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">Select…</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case "longtext":
      return (
        <textarea
          className="portal-input portal-textarea"
          value={strVal}
          rows={4}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    default:
      return (
        <input
          className="portal-input"
          type="text"
          value={strVal}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
}

/* ── State badge with color ──────────────────────────────────── */
function StateBadge({
  stateName,
  allStates,
}: {
  stateName: string | null;
  allStates: WorkflowState[];
}): React.ReactElement {
  if (!stateName) return <span className="rcd-muted">—</span>;
  const stateObj = allStates.find((s) => s.name === stateName);
  const color = stateObj?.color ?? null;
  return (
    <span
      className="rcd-state-badge"
      style={
        color
          ? {
              background: `${color}20`,
              color,
              borderColor: `${color}55`,
            }
          : undefined
      }
    >
      <span
        className="rcd-state-dot"
        style={color ? { background: color } : undefined}
      />
      {stateObj?.label ?? stateName}
    </span>
  );
}

/* ── History event icon ──────────────────────────────────────── */
function HistoryIcon({
  type,
}: {
  type: "create" | "update" | "transition" | "comment";
}): React.ReactElement {
  if (type === "create") {
    return (
      <div className="rcd-tl-icon rcd-tl-icon-create">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
    );
  }
  if (type === "update") {
    return (
      <div className="rcd-tl-icon rcd-tl-icon-update">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </div>
    );
  }
  if (type === "comment") {
    return (
      <div className="rcd-tl-icon rcd-tl-icon-comment">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="rcd-tl-icon rcd-tl-icon-transition">
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="5 12 19 12" />
        <polyline points="13 6 19 12 13 18" />
      </svg>
    </div>
  );
}

/* ── Comment composer with @mention ─────────────────────────── */
function CommentComposer({
  users,
  replyTo,
  onCancel,
  onSubmit,
  placeholder,
}: {
  users: OrgUser[];
  replyTo: WorkflowEvent | null;
  onCancel?: () => void;
  onSubmit: (
    text: string,
    mentions: string[],
    replyTo: string | null,
  ) => Promise<void>;
  placeholder?: string;
}): React.ReactElement {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentionResults =
    mentionQuery !== null
      ? users
          .filter((u) => {
            const q = mentionQuery.toLowerCase();
            return (
              (u.displayName ?? "").toLowerCase().includes(q) ||
              u.email.toLowerCase().includes(q)
            );
          })
          .slice(0, 6)
      : [];

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const val = e.target.value;
    setText(val);
    const cursor = e.target.selectionStart;
    const atMatch = /@([\w.]*)$/.exec(val.slice(0, cursor));
    if (atMatch) {
      setMentionQuery(atMatch[1] ?? "");
      setMentionAnchor(atMatch.index);
      setMentionIdx(0);
    } else {
      setMentionQuery(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (mentionQuery !== null && mentionResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx((i) => Math.min(i + 1, mentionResults.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const u = mentionResults[mentionIdx];
        if (u) insertMention(u);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  function insertMention(u: OrgUser): void {
    const name = u.displayName ?? u.email;
    const before = text.slice(0, mentionAnchor);
    const after = text.slice(mentionAnchor).replace(/^@[\w.]*/, "");
    setText(`${before}@${name} ${after}`);
    setMentionQuery(null);
    textareaRef.current?.focus();
  }

  function extractMentions(): string[] {
    const nameToId = new Map(
      users.map((u) => [u.displayName ?? u.email, u.userId]),
    );
    const ids: string[] = [];
    for (const m of text.matchAll(/@([\w. ]+?)(?=\s|$)/g)) {
      const uid = nameToId.get(m[1]?.trim() ?? "");
      if (uid) ids.push(uid);
    }
    return [...new Set(ids)];
  }

  async function handleSubmit(): Promise<void> {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(text.trim(), extractMentions(), replyTo?.id ?? null);
      setText("");
      setMentionQuery(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cmt-composer">
      {replyTo && (
        <div className="cmt-reply-banner">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 00-4-4H4" />
          </svg>
          Replying to{" "}
          <strong>
            {replyTo.actorDisplayName ?? replyTo.actorId.slice(0, 8) + "…"}
          </strong>
          {onCancel && (
            <button
              type="button"
              className="cmt-reply-cancel"
              onClick={onCancel}
            >
              ×
            </button>
          )}
        </div>
      )}
      <div className="cmt-input-wrap">
        <textarea
          ref={textareaRef}
          className="cmt-textarea"
          rows={3}
          placeholder={
            placeholder ??
            "Add a comment… Use @ to mention someone (Ctrl+Enter to post)"
          }
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={submitting}
        />
        {mentionQuery !== null && mentionResults.length > 0 && (
          <div className="cmt-mention-dropdown">
            {mentionResults.map((u, i) => (
              <button
                key={u.userId}
                type="button"
                className={`cmt-mention-item ${i === mentionIdx ? "cmt-mention-item-active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(u);
                }}
              >
                <span className="cmt-mention-avatar">
                  {(u.displayName ?? u.email).slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <span className="cmt-mention-name">
                    {u.displayName ?? u.email}
                  </span>
                  <span className="cmt-mention-email">{u.email}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="cmt-composer-footer">
        <span className="cmt-hint">@ to mention · Ctrl+Enter to post</span>
        <button
          type="button"
          className="portal-btn-primary cmt-post-btn"
          disabled={!text.trim() || submitting}
          onClick={() => void handleSubmit()}
        >
          {submitting ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}

/* ── Searchable assign dropdown ──────────────────────────────── */
function AssignDropdown({
  value,
  users,
  disabled,
  onChange,
}: {
  value: string;
  users: OrgUser[];
  disabled?: boolean;
  onChange: (userId: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedUser = users.find((u) => u.userId === value);
  const filtered = search
    ? users.filter((u) => {
        const q = search.toLowerCase();
        return (
          (u.displayName ?? "").toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
        );
      })
    : users;

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onClickOutside(e: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function select(userId: string): void {
    onChange(userId);
    setOpen(false);
    setSearch("");
  }

  return (
    <div ref={containerRef} className="asgn-drop">
      <button
        type="button"
        className={`asgn-trigger ${open ? "asgn-trigger-open" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {selectedUser ? (
          <>
            <span className="asgn-avatar">
              {(selectedUser.displayName ?? selectedUser.email)
                .slice(0, 1)
                .toUpperCase()}
            </span>
            <span className="asgn-name">
              {selectedUser.displayName ?? selectedUser.email}
            </span>
          </>
        ) : (
          <>
            <span className="asgn-avatar asgn-avatar-empty">?</span>
            <span className="asgn-name asgn-unassigned">Unassigned</span>
          </>
        )}
        <svg
          className="asgn-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="asgn-menu">
          <div className="asgn-search-wrap">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              className="asgn-search"
              placeholder="Search people…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="asgn-options">
            <button
              type="button"
              className={`asgn-option ${!value ? "asgn-option-selected" : ""}`}
              onClick={() => select("")}
            >
              <span className="asgn-avatar asgn-avatar-empty">?</span>
              <span className="asgn-option-info">
                <span className="asgn-option-name">Unassigned</span>
              </span>
              {!value && (
                <svg
                  className="asgn-check"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
            {filtered.length === 0 && (
              <div className="asgn-empty">No results</div>
            )}
            {filtered.map((u) => (
              <button
                key={u.userId}
                type="button"
                className={`asgn-option ${value === u.userId ? "asgn-option-selected" : ""}`}
                onClick={() => select(u.userId)}
              >
                <span className="asgn-avatar">
                  {(u.displayName ?? u.email).slice(0, 1).toUpperCase()}
                </span>
                <span className="asgn-option-info">
                  <span className="asgn-option-name">
                    {u.displayName ?? u.email}
                  </span>
                  <span className="asgn-option-email">{u.email}</span>
                </span>
                {value === u.userId && (
                  <svg
                    className="asgn-check"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Searchable state transition dropdown ────────────────────── */
function StateDropdown({
  currentState: current,
  allStates,
  transitions,
  disabled,
  onTransition,
}: {
  currentState: string | null;
  allStates: WorkflowState[];
  transitions: Transition[];
  disabled?: boolean;
  onTransition: (transition: Transition) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const stateObj = allStates.find((s) => s.name === current);
  const color = stateObj?.color ?? null;
  const available = transitions.filter((t) => t.fromState === current);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (!current) return <span className="rcd-muted">—</span>;

  return (
    <div ref={containerRef} className="asgn-drop">
      <button
        type="button"
        className={`asgn-trigger asgn-trigger-state ${open ? "asgn-trigger-open" : ""}`}
        disabled={disabled === true || available.length === 0}
        onClick={() => setOpen((v) => !v)}
        title={
          available.length === 0 ? "No transitions available" : "Change state"
        }
      >
        <span
          className="rcd-state-dot"
          style={color ? { background: color } : undefined}
        />
        <span className="asgn-name">{stateObj?.label ?? current}</span>
        {available.length > 0 && (
          <svg
            className="asgn-chevron"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {open && available.length > 0 && (
        <div className="asgn-menu">
          <div className="asgn-menu-label">Move to…</div>
          <div className="asgn-options">
            {available.map((t) => {
              const toState = allStates.find((s) => s.name === t.toState);
              const toColor = toState?.color ?? null;
              return (
                <button
                  key={t.id}
                  type="button"
                  className="asgn-option"
                  onClick={() => {
                    setOpen(false);
                    onTransition(t);
                  }}
                >
                  <span
                    className="rcd-state-dot"
                    style={toColor ? { background: toColor } : undefined}
                  />
                  <span className="asgn-option-info">
                    <span className="asgn-option-name">
                      {t.label !== "" ? t.label : (toState?.label ?? t.toState)}
                    </span>
                    {t.requiresComment && (
                      <span className="asgn-option-email">
                        Comment required
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("amount" in obj && "currency" in obj)
      return `${String(obj.currency)} ${String(obj.amount)}`;
    return JSON.stringify(value);
  }
  return String(value);
}

/* ══════════════════════════════════════════════════════════════ */
export function CustomerRecordDetail(): React.ReactElement {
  const { typeSlug, id } = useParams<{ typeSlug: string; id: string }>();
  const { getTypeBySlug } = useEntityTypes();
  const entityType = typeSlug ? getTypeBySlug(typeSlug) : undefined;
  const entityTypeId = entityType?.id;

  const [fields, setFields] = useState<EntityField[]>([]);
  const [record, setRecord] = useState<EntityInstance | null>(null);
  const [history, setHistory] = useState<WorkflowEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [stateModal, setStateModal] = useState<Transition | null>(null);
  const [comment, setComment] = useState("");
  const [transError, setTransError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [editAssignedTo, setEditAssignedTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [allStates, setAllStates] = useState<WorkflowState[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [currentState, setCurrentState] = useState("");
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"comments" | "history">(
    "comments",
  );
  const [quickAssigning, setQuickAssigning] = useState(false);
  const [replyTo, setReplyTo] = useState<WorkflowEvent | null>(null);
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(
    new Set(),
  );
  const initializedCollapse = useRef(false);
  const [currentUserRoles, setCurrentUserRoles] = useState<string[]>([]);
  useEffect(() => {
    userManager
      .getUser()
      .then((u) => {
        if (!u) return;
        const roleClaim = u.profile["urn:zitadel:iam:org:project:roles"] as
          | Record<string, unknown>
          | undefined;
        setCurrentUserRoles(roleClaim ? Object.keys(roleClaim) : []);
        // Inject the current user into the users list so their name always resolves,
        // even when the /users API treats them as a ghost entry (no email/displayName in DB).
        const sub = u.profile.sub;
        const name =
          (u.profile.name as string | undefined) ??
          (u.profile.preferred_username as string | undefined) ??
          (u.profile.email as string | undefined) ??
          null;
        const email = (u.profile.email as string | undefined) ?? "";
        if (sub) {
          setUsers((prev) => {
            if (prev.some((p) => p.userId === sub)) return prev;
            return [
              ...prev,
              {
                userId: sub,
                email,
                displayName: name,
                loginName: email || sub,
              },
            ];
          });
        }
      })
      .catch(() => {
        /* leave defaults */
      });
  }, []);
  const isAdminOrAgent =
    currentUserRoles.includes("admin") || currentUserRoles.includes("agent");

  function toggleThread(id: string): void {
    setCollapsedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const getFieldLabel = (fieldName: string): string => {
    if (fieldName === "state" || fieldName === "currentState") return "State";
    if (fieldName === "assignedTo") return "Assigned To";
    const found = fields.find((f) => f.name === fieldName);
    return found ? found.label : fieldName;
  };

  const getActorName = (actorId: string | null): string => {
    if (!actorId) return "System";
    const u = users.find((user) => user.userId === actorId);
    if (!u) return actorId.slice(0, 8) + "…";
    // If displayName is the raw userId (UUID), fall through to email/loginName
    const display =
      u.displayName && u.displayName !== actorId ? u.displayName : null;
    return display ?? u.loginName ?? (u.email || actorId.slice(0, 8) + "…");
  };

  // Prefer backend-resolved display name; fall back to local users list when
  // backend could only resolve a truncated ID (ends with "…", no real name).
  const resolveActorName = (
    actorDisplayName: string | null | undefined,
    actorId: string | null,
  ): string => {
    const fromList = actorId ? getActorName(actorId) : null;
    // If backend gave us a real name (not just a truncated ID), prefer it.
    if (actorDisplayName && !actorDisplayName.endsWith("…"))
      return actorDisplayName;
    // If local users list has a real name, prefer that over the truncated ID.
    if (fromList && !fromList.endsWith("…")) return fromList;
    return actorDisplayName ?? fromList ?? "Unknown";
  };

  function loadRecord(): Promise<void> {
    if (!entityTypeId || !id) return Promise.resolve();
    return Promise.all([
      fetchWithAuth(`${API_URL}/entity-types/${entityTypeId}/fields`),
      fetchWithAuth(`${API_URL}/entities/${id}`),
      fetchWithAuth(`${API_URL}/entities/${id}/transitions/history`).catch(
        () => ({ data: [] }),
      ),
      fetchWithAuth(`${API_URL}/users`).catch(() => ({ data: [] })),
    ])
      .then(([fieldsRes, recRes, histRes, usersRes]) => {
        setFields(
          (fieldsRes as { data: EntityField[] }).data.filter(
            (f) => !f.isSystem,
          ),
        );
        setRecord((recRes as { data: EntityInstance }).data);
        setHistory((histRes as { data?: WorkflowEvent[] }).data ?? []);
        const apiUsers =
          (
            usersRes as {
              data?: Array<{
                userId: string;
                email: string;
                displayName: string | null;
                loginName?: string;
              }>;
            }
          ).data ?? [];
        // Merge API users with any already-injected entries (e.g. current OIDC user)
        setUsers((prev) => {
          const apiIds = new Set(apiUsers.map((u) => u.userId));
          return [...apiUsers, ...prev.filter((u) => !apiIds.has(u.userId))];
        });
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }

  // Collapse all parent threads on first load (and after a full reload)
  useEffect(() => {
    if (history.length === 0) return;
    const comments = history.filter((e) => e.metadata?.type === "comment");
    const parentIds = new Set(
      comments
        .map(
          (c) =>
            (c.metadata as { replyTo?: string | null } | undefined)?.replyTo ??
            null,
        )
        .filter((id): id is string => id !== null),
    );
    if (parentIds.size === 0) return;
    if (!initializedCollapse.current) {
      initializedCollapse.current = true;
      setCollapsedThreads(parentIds);
    }
  }, [history]);

  async function refreshHistory(): Promise<void> {
    if (!id) return;
    const histRes = await fetchWithAuth(
      `${API_URL}/entities/${id}/transitions/history`,
    ).catch(() => ({ data: [] }));
    setHistory((histRes as { data?: WorkflowEvent[] }).data ?? []);
  }

  async function submitComment(
    text: string,
    mentions: string[],
    replyTo: string | null,
  ): Promise<void> {
    if (!id) return;
    await fetchWithAuth(`${API_URL}/entities/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ text, mentions, replyTo }),
    });
    await refreshHistory();
  }

  useEffect(() => {
    void loadRecord();
  }, [entityTypeId, id]);

  useEffect(() => {
    if (!record?.workflowId && !entityTypeId) {
      setAllStates([]);
      return;
    }

    const wfUrl = record?.workflowId
      ? `${API_URL}/workflows/${record.workflowId}`
      : `${API_URL}/workflows?${new URLSearchParams({ entityTypeId: entityTypeId ?? "" }).toString()}`;

    fetchWithAuth(wfUrl)
      .then((res) => {
        const wf = record?.workflowId
          ? (
              res as {
                data: { states: WorkflowState[]; transitions: Transition[] };
              }
            ).data
          : ((
              res as {
                data?: Array<{
                  states?: WorkflowState[];
                  transitions?: Transition[];
                }>;
              }
            ).data ?? [])[0];
        if (wf) {
          setAllStates(wf.states as WorkflowState[]);
          setTransitions(wf.transitions as Transition[]);
        } else {
          setAllStates([]);
          setTransitions([]);
        }
      })
      .catch(() => {
        setAllStates([]);
      });
  }, [record?.workflowId, entityTypeId]);

  async function saveEdit(): Promise<void> {
    if (!id) return;
    setSaving(true);
    setSaveError(null);
    try {
      await fetchWithAuth(`${API_URL}/entities/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          fields: editValues,
          currentState,
          assignedTo: editAssignedTo || null,
        }),
      });
      setEditing(false);
      setLoading(true);
      void loadRecord();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function quickAssign(userId: string): Promise<void> {
    if (!id) return;
    setQuickAssigning(true);
    try {
      await fetchWithAuth(`${API_URL}/entities/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ assignedTo: userId || null }),
      });
      void loadRecord();
    } finally {
      setQuickAssigning(false);
    }
  }

  async function executeTransition(
    transition: Transition,
    userComment?: string,
  ): Promise<void> {
    if (!id) return;
    setTransitioning(transition.id);
    setTransError(null);
    try {
      await fetchWithAuth(`${API_URL}/entities/${id}/transitions`, {
        method: "POST",
        body: JSON.stringify({
          transitionId: transition.id,
          ...(userComment ? { comment: userComment } : {}),
        }),
      });
      setComment("");
      setStateModal(null);
      setLoading(true);
      void loadRecord();
    } catch (err) {
      setTransError(err instanceof Error ? err.message : "Transition failed");
    } finally {
      setTransitioning(null);
    }
  }

  if (loading)
    return (
      <div className="portal-loading">
        <div className="spinner" />
      </div>
    );

  if (error || !record) {
    return (
      <div className="rcd-page">
        <div className="portal-alert-error">{error ?? "Record not found"}</div>
        <Link
          to={`/records/${typeSlug ?? ""}`}
          className="portal-back-link"
          style={{ marginTop: "12px", display: "inline-block" }}
        >
          ← Back
        </Link>
      </div>
    );
  }

  const historyEvents = history;
  const commentEvents = historyEvents.filter(
    (e) => e.metadata?.type === "comment",
  );
  const timelineEvents = historyEvents.filter(
    (e) => e.metadata?.type !== "comment",
  );
  const sortedAll = [...historyEvents].sort(
    (a, b) =>
      new Date(a.triggeredAt).getTime() - new Date(b.triggeredAt).getTime(),
  );

  // Build a proper comment tree: each node knows its direct children
  const sortedComments = [...commentEvents].sort(
    (a, b) =>
      new Date(a.triggeredAt).getTime() - new Date(b.triggeredAt).getTime(),
  );
  const commentById = new Map(sortedComments.map((c) => [c.id, c]));

  // childrenOf[parentId] = direct children in chronological order
  const childrenOf = new Map<string, WorkflowEvent[]>();
  const topLevelComments: WorkflowEvent[] = [];
  for (const c of sortedComments) {
    const parentId =
      (c.metadata as { replyTo?: string | null } | undefined)?.replyTo ?? null;
    if (parentId && commentById.has(parentId)) {
      const arr = childrenOf.get(parentId) ?? [];
      arr.push(c);
      childrenOf.set(parentId, arr);
    } else {
      topLevelComments.push(c);
    }
  }

  const titleField = fields.find(
    (f) => f.name === "subject" || f.name === "title" || f.name === "name",
  );
  const recordTitle = titleField
    ? String(record.fields[titleField.name] ?? "")
    : `${entityType?.name ?? "Record"} #${record.id.slice(0, 8)}`;

  const createdByEvent = historyEvents.find(
    (e) => e.metadata?.type === "create",
  );

  function renderCommentBubble(event: WorkflowEvent): React.ReactElement {
    const meta = event.metadata;
    const commentText =
      (meta as { text?: string } | undefined)?.text ?? event.comment ?? "";
    const renderText = (): React.ReactNode =>
      commentText.split(/(@[\w. ]+)/g).map((part, i) =>
        part.startsWith("@") ? (
          <span key={i} className="cmt-mention-chip">
            {part}
          </span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      );
    return (
      <>
        <span className="rcd-feed-avatar">
          {(event.actorDisplayName ?? event.actorId).slice(0, 1).toUpperCase()}
        </span>
        <div className="rcd-feed-comment-body">
          <div className="rcd-feed-comment-meta">
            <span className="rcd-feed-comment-author">
              {event.actorDisplayName ?? event.actorId.slice(0, 8) + "…"}
            </span>
            <span className="rcd-feed-comment-time">
              {new Date(event.triggeredAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <button
              type="button"
              className="rcd-reply-btn"
              onClick={() => {
                setReplyTo(event);
                setActiveTab("comments");
              }}
              title="Reply"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 14 4 9 9 4" />
                <path d="M20 20v-7a4 4 0 00-4-4H4" />
              </svg>
              Reply
            </button>
          </div>
          <div className="rcd-feed-comment-text">{renderText()}</div>
        </div>
      </>
    );
  }

  function renderCommentNode(
    event: WorkflowEvent,
    depth: number,
  ): React.ReactElement {
    const children = childrenOf.get(event.id) ?? [];
    const hasChildren = children.length > 0;
    const collapsed = collapsedThreads.has(event.id);

    return (
      <div className={depth === 0 ? "rcd-comment-root" : "rcd-comment-child"}>
        <div className="rcd-comment-row">
          {renderCommentBubble(event)}
          {hasChildren && (
            <button
              type="button"
              className={`rcd-thread-toggle ${collapsed ? "rcd-thread-toggle-collapsed" : ""}`}
              onClick={() => toggleThread(event.id)}
              title={
                collapsed
                  ? `Show ${children.length} repl${children.length === 1 ? "y" : "ies"}`
                  : "Collapse replies"
              }
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <span>{collapsed ? children.length : ""}</span>
            </button>
          )}
        </div>
        {hasChildren && !collapsed && (
          <div className="rcd-comment-children">
            {children.map((child) => (
              <React.Fragment key={child.id}>
                {renderCommentNode(child, depth + 1)}
              </React.Fragment>
            ))}
          </div>
        )}
        {hasChildren && collapsed && (
          <div
            className="rcd-comment-collapsed-hint"
            onClick={() => toggleThread(event.id)}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {children.length} repl{children.length === 1 ? "y" : "ies"} hidden
          </div>
        )}
      </div>
    );
  }

  function renderFeedEvent(event: WorkflowEvent): React.ReactElement {
    const meta = event.metadata;
    const isCreate = meta?.type === "create";
    const isUpdate = meta?.type === "update";
    const isComment = meta?.type === "comment";

    if (isComment) {
      // standalone (no replies, not a reply) — used only for history tab
      return (
        <div key={event.id} className="rcd-feed-comment">
          {renderCommentBubble(event)}
        </div>
      );
    }

    const eventType = isCreate ? "create" : isUpdate ? "update" : "transition";
    return (
      <div key={event.id} className="rcd-feed-event">
        <div className="rcd-feed-event-icon-wrap">
          <HistoryIcon type={eventType} />
          <div className="rcd-feed-event-line" />
        </div>
        <div className="rcd-feed-event-body">
          {isCreate ? (
            <span className="rcd-feed-event-text">
              <strong>
                {resolveActorName(event.actorDisplayName, event.actorId)}
              </strong>{" "}
              created this record
            </span>
          ) : isUpdate ? (
            <div>
              <span className="rcd-feed-event-text">
                <strong>
                  {resolveActorName(event.actorDisplayName, event.actorId)}
                </strong>{" "}
                updated the record
              </span>
              {"changed" in (meta as Record<string, unknown>) &&
                typeof (meta as Record<string, unknown>)["changed"] ===
                  "object" &&
                (meta as Record<string, unknown>)["changed"] !== null &&
                Object.keys(
                  (meta as Record<string, unknown>)["changed"] as object,
                ).length > 0 && (
                  <ul className="rcd-tl-changes">
                    {Object.entries(
                      (
                        meta as Record<
                          string,
                          Record<string, Record<string, unknown>>
                        >
                      )["changed"] ?? {},
                    ).map(([fieldName, change]) => (
                      <li key={fieldName}>
                        <strong>{getFieldLabel(fieldName)}</strong>:{" "}
                        {fieldName === "assignedTo"
                          ? ((change["oldName"] as string | null) ??
                            getActorName(change["old"] as string | null))
                          : formatFieldValue(change["old"])}
                        {" → "}
                        {fieldName === "assignedTo"
                          ? ((change["newName"] as string | null) ??
                            getActorName(change["new"] as string | null))
                          : formatFieldValue(change["new"])}
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          ) : (
            <div className="rcd-feed-event-text">
              <strong>
                {resolveActorName(event.actorDisplayName, event.actorId)}
              </strong>{" "}
              moved{" "}
              {event.fromState && (
                <>
                  <span className="rcd-tl-state">{event.fromState}</span>
                  {" → "}
                </>
              )}
              <span className="rcd-tl-state rcd-tl-state-to">
                {event.toState}
              </span>
              {event.comment && (
                <div className="rcd-tl-comment" style={{ marginTop: "6px" }}>
                  "{event.comment}"
                </div>
              )}
            </div>
          )}
          <div className="rcd-feed-event-time">
            {new Date(event.triggeredAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rcd-page">
      {/* ── Breadcrumb nav ───────────────────────────────── */}
      <div className="rcd-nav">
        <Link to={`/records/${typeSlug ?? ""}`} className="rcd-bc-link">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {entityType?.plural ?? "Records"}
        </Link>
        <span className="rcd-bc-sep">/</span>
        <span className="rcd-bc-current">{recordTitle}</span>
      </div>

      {transError && (
        <div className="portal-alert-error rcd-trans-error">
          ⚠ {transError}
          <button
            onClick={() => setTransError(null)}
            className="rcd-error-close"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Cards area ───────────────────────────────────── */}
      <div className="rcd-cards">
        {/* ══ CARD 1: Details ══════════════════════════════ */}
        <div className="rcd-card rcd-detail-card">
          {/* Card header: title + state + actions */}
          <div className="rcd-card-header">
            <div className="rcd-card-header-left">
              <h1 className="rcd-title">{recordTitle}</h1>
              <div className="rcd-card-header-meta">
                <StateBadge
                  stateName={record.currentState}
                  allStates={allStates}
                />
                <span className="rcd-id-chip">{record.id.slice(0, 8)}</span>
              </div>
            </div>
            <div className="rcd-card-header-right">
              {!editing && isAdminOrAgent && (
                <button
                  type="button"
                  className="rcd-btn-secondary"
                  onClick={() => {
                    setEditValues(record.fields);
                    setCurrentState(record.currentState ?? "");
                    setEditAssignedTo(record.assignedTo ?? "");
                    setSaveError(null);
                    setEditing(true);
                    setDetailsExpanded(true);
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit
                </button>
              )}
              <button
                type="button"
                className={`rcd-expand-btn ${detailsExpanded ? "rcd-expand-btn-open" : ""}`}
                onClick={() => {
                  setDetailsExpanded((v) => !v);
                  if (editing) setEditing(false);
                }}
                aria-expanded={detailsExpanded}
                title={detailsExpanded ? "Collapse details" : "Expand details"}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          </div>

          {/* Always-visible info strip */}
          <div className="rcd-info-strip">
            {/* State */}
            <div className="rcd-info-item">
              <span className="rcd-info-lbl">State</span>
              <div className="rcd-info-val">
                <StateDropdown
                  currentState={record.currentState}
                  allStates={allStates}
                  transitions={transitions}
                  disabled={!!transitioning}
                  onTransition={(t) => {
                    if (t.requiresComment) {
                      setStateModal(t);
                    } else {
                      void executeTransition(t);
                    }
                  }}
                />
              </div>
            </div>

            <div className="rcd-info-divider" />

            {/* Assigned to */}
            <div className="rcd-info-item">
              <span className="rcd-info-lbl">Assigned to</span>
              <div className="rcd-info-val">
                <AssignDropdown
                  value={record.assignedTo ?? ""}
                  users={users}
                  disabled={quickAssigning}
                  onChange={(userId) => void quickAssign(userId)}
                />
              </div>
            </div>

            <div className="rcd-info-divider" />

            {/* Created */}
            <div className="rcd-info-item">
              <span className="rcd-info-lbl">Created</span>
              <span className="rcd-info-val">
                {new Date(record.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {createdByEvent && (
                  <span className="rcd-info-by">
                    {" "}
                    by{" "}
                    {resolveActorName(
                      createdByEvent.actorDisplayName,
                      createdByEvent.actorId,
                    )}
                  </span>
                )}
              </span>
            </div>

            <div className="rcd-info-divider" />

            {/* Last updated */}
            <div className="rcd-info-item">
              <span className="rcd-info-lbl">Last updated</span>
              <span className="rcd-info-val">
                {new Date(record.updatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>

            <div className="rcd-info-divider" />

            {/* Type */}
            <div className="rcd-info-item">
              <span className="rcd-info-lbl">Type</span>
              <span className="rcd-info-val">{entityType?.name ?? "—"}</span>
            </div>
          </div>

          {/* Expandable: all fields / edit form */}
          <div
            className={`rcd-expand-body ${detailsExpanded ? "rcd-expand-body-open" : ""}`}
          >
            <div className="rcd-expand-inner">
              {editing ? (
                <>
                  {saveError && (
                    <div
                      className="portal-alert-error"
                      style={{ marginBottom: "12px" }}
                    >
                      {saveError}
                    </div>
                  )}
                  <div className="portal-edit-grid">
                    {allStates.length > 0 && (
                      <div className="portal-field-group portal-field-full">
                        <label className="portal-field-label">State</label>
                        <select
                          className="portal-input"
                          value={currentState}
                          onChange={(e) => setCurrentState(e.target.value)}
                        >
                          {allStates.map((st) => (
                            <option key={st.id} value={st.name}>
                              {st.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="portal-field-group portal-field-full">
                      <label className="portal-field-label">Assigned To</label>
                      <select
                        className="portal-input"
                        value={editAssignedTo}
                        onChange={(e) => setEditAssignedTo(e.target.value)}
                      >
                        <option value="">Unassigned</option>
                        {users.map((u) => (
                          <option key={u.userId} value={u.userId}>
                            {u.displayName ?? u.email}
                          </option>
                        ))}
                      </select>
                    </div>
                    {fields.map((f) => (
                      <div
                        key={f.id}
                        className={`portal-field-group ${f.fieldType === "longtext" ? "portal-field-full" : ""}`}
                      >
                        <label className="portal-field-label">
                          {f.label}
                          {f.isRequired && (
                            <span className="portal-required">*</span>
                          )}
                        </label>
                        <FieldInput
                          field={f}
                          value={editValues[f.name]}
                          onChange={(v) =>
                            setEditValues((p) => ({ ...p, [f.name]: v }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <div className="rcd-edit-footer">
                    <button
                      className="portal-btn-secondary"
                      onClick={() => {
                        setEditing(false);
                        setSaveError(null);
                      }}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                    <button
                      className="portal-btn-primary"
                      onClick={() => void saveEdit()}
                      disabled={saving}
                    >
                      {saving ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="rcd-fields-grid">
                  {fields.map((f) => (
                    <div key={f.id} className="rcd-field-item">
                      <div className="rcd-field-lbl">{f.label}</div>
                      <div className="rcd-field-val">
                        <FieldValue
                          value={record.fields[f.name]}
                          fieldType={f.fieldType}
                          field={f}
                        />
                      </div>
                    </div>
                  ))}
                  {fields.length === 0 && (
                    <p
                      className="rcd-empty-hint"
                      style={{ padding: "0", gridColumn: "1/-1" }}
                    >
                      No custom fields defined.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ══ CARD 2: Activity tabs ════════════════════════ */}
        <div className="rcd-card rcd-activity-card">
          {/* Tab bar */}
          <div className="rcd-tabs">
            <button
              type="button"
              className={`rcd-tab ${activeTab === "comments" ? "rcd-tab-active" : ""}`}
              onClick={() => setActiveTab("comments")}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              Comments
              {commentEvents.length > 0 && (
                <span className="rcd-tab-count">{commentEvents.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`rcd-tab ${activeTab === "history" ? "rcd-tab-active" : ""}`}
              onClick={() => setActiveTab("history")}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              History
              {timelineEvents.length > 0 && (
                <span className="rcd-tab-count">{timelineEvents.length}</span>
              )}
            </button>
          </div>

          {/* Tab content */}
          <div className="rcd-tab-panel">
            {activeTab === "comments" ? (
              <>
                <div className="rcd-tab-scroll">
                  {topLevelComments.length === 0 ? (
                    <p className="rcd-empty-hint rcd-empty-hint-feed">
                      No comments yet. Be the first to comment.
                    </p>
                  ) : (
                    <div className="rcd-feed-list">
                      {topLevelComments.map((root) => (
                        <React.Fragment key={root.id}>
                          {renderCommentNode(root, 0)}
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rcd-composer-dock">
                  <CommentComposer
                    users={users}
                    replyTo={replyTo}
                    onCancel={() => setReplyTo(null)}
                    onSubmit={(text, mentions, replyToId) =>
                      submitComment(text, mentions, replyToId).then(() =>
                        setReplyTo(null),
                      )
                    }
                  />
                </div>
              </>
            ) : (
              <div className="rcd-tab-scroll">
                {timelineEvents.length === 0 ? (
                  <p className="rcd-empty-hint rcd-empty-hint-feed">
                    No history yet.
                  </p>
                ) : (
                  <div className="rcd-feed-list">
                    {sortedAll
                      .filter((e) => e.metadata?.type !== "comment")
                      .map((event) => (
                        <React.Fragment key={event.id}>
                          {renderFeedEvent(event)}
                        </React.Fragment>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Transition modal ─────────────────────────────── */}
      {stateModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            setStateModal(null);
            setComment("");
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                Move to "{stateModal.label || stateModal.toState}"
              </h3>
              <button
                className="modal-close"
                onClick={() => {
                  setStateModal(null);
                  setComment("");
                }}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="rcd-modal-desc">
                This will transition the record from{" "}
                <strong>{record.currentState}</strong> to{" "}
                <strong>{stateModal.toState}</strong>.
              </p>
              <div className="form-group">
                <label className="form-label">
                  Comment {stateModal.requiresComment ? "*" : "(optional)"}
                </label>
                <textarea
                  className="form-input portal-textarea"
                  rows={3}
                  placeholder="Add a note about this transition…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => {
                  setStateModal(null);
                  setComment("");
                }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={
                  (stateModal.requiresComment && !comment.trim()) ||
                  transitioning === stateModal.id
                }
                onClick={() =>
                  void executeTransition(stateModal, comment || undefined)
                }
              >
                {transitioning === stateModal.id ? "Moving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
