import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../lib/api.js";
import { useRoles } from "../../lib/use-roles.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type FieldRow = {
  label: string;
  name: string;
  fieldType: string;
  isRequired: boolean;
};
type StateRow = {
  label: string;
  name: string;
  color: string;
  isTerminal: boolean;
};
type TransitionRow = {
  fromState: string;
  toState: string;
  label: string;
  allowedRoles: string[];
};

const FIELD_TYPES = [
  "text",
  "longtext",
  "number",
  "currency",
  "date",
  "datetime",
  "boolean",
  "enum",
  "multi_enum",
] as const;

const STATE_COLORS = [
  "#6366f1",
  "#3b82f6",
  "#f59e0b",
  "#8b5cf6",
  "#10b981",
  "#ef4444",
  "#6b7280",
  "#ec4899",
];

function toSnake(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

// ── Step indicators ────────────────────────────────────────────────────────────

function Steps({ current }: { current: number }): React.ReactElement {
  const steps = ["Record basics", "Fields", "Workflow states", "Transitions"];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0",
        marginBottom: "32px",
      }}
    >
      {steps.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <React.Fragment key={label}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "13px",
                  background: done
                    ? "var(--success)"
                    : active
                      ? "var(--accent-primary)"
                      : "var(--bg-tertiary)",
                  color: done || active ? "#fff" : "var(--text-muted)",
                  border: active
                    ? "2px solid var(--accent-primary)"
                    : "2px solid transparent",
                  transition: "all .2s",
                }}
              >
                {done ? "✓" : idx}
              </div>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: active ? 600 : 400,
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: "2px",
                  background: done ? "var(--success)" : "var(--border-color)",
                  margin: "0 8px",
                  marginBottom: "20px",
                  transition: "background .2s",
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Step 1: Record basics ──────────────────────────────────────────────────────

function Step1({
  name,
  setName,
  plural,
  setPlural,
  icon,
  setIcon,
}: {
  name: string;
  setName: (v: string) => void;
  plural: string;
  setPlural: (v: string) => void;
  icon: string;
  setIcon: (v: string) => void;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>
        What are you tracking? This becomes the record type users will create
        and move through the workflow.
      </p>
      <div className="form-group">
        <label className="form-label">Name *</label>
        <input
          className="form-input"
          placeholder="e.g. Support Ticket, Bug Report, Leave Request"
          value={name}
          autoFocus
          onChange={(e) => {
            const v = e.target.value;
            setName(v);
            if (!plural || plural === toAutoPlural(name))
              setPlural(toAutoPlural(v));
          }}
          required
        />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Plural *</label>
          <input
            className="form-input"
            placeholder="e.g. Support Tickets"
            value={plural}
            onChange={(e) => setPlural(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">Icon (emoji)</label>
          <input
            className="form-input"
            placeholder="e.g. 🎫"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            style={{ maxWidth: "100px" }}
          />
        </div>
      </div>
    </div>
  );
}

function toAutoPlural(name: string): string {
  const t = name.trim();
  if (!t) return "";
  if (t.endsWith("s") || t.endsWith("x") || t.endsWith("z")) return t + "es";
  return t + "s";
}

// ── Step 2: Fields ─────────────────────────────────────────────────────────────

function Step2({
  fields,
  setFields,
}: {
  fields: FieldRow[];
  setFields: (f: FieldRow[]) => void;
}): React.ReactElement {
  function add(): void {
    setFields([
      ...fields,
      { label: "", name: "", fieldType: "text", isRequired: false },
    ]);
  }
  function remove(i: number): void {
    setFields(fields.filter((_, idx) => idx !== i));
  }
  function update(i: number, patch: Partial<FieldRow>): void {
    setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>
        Define the data each record holds. You can add more fields later.
      </p>

      {fields.length === 0 && (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            border: "1px dashed var(--border-color)",
            borderRadius: "8px",
            color: "var(--text-muted)",
            fontSize: "13px",
          }}
        >
          No fields yet — every record will just have a state. Add fields to
          capture data.
        </div>
      )}

      {fields.map((f, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 140px 100px auto auto",
            gap: "10px",
            alignItems: "end",
          }}
        >
          <div className="form-group" style={{ margin: 0 }}>
            {i === 0 && <label className="form-label">Label</label>}
            <input
              className="form-input"
              placeholder="e.g. Subject"
              value={f.label}
              onChange={(e) => {
                const label = e.target.value;
                const name = toSnake(label);
                update(i, { label, name });
              }}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            {i === 0 && <label className="form-label">Type</label>}
            <select
              className="form-input"
              value={f.fieldType}
              onChange={(e) => update(i, { fieldType: e.target.value })}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div
            className="form-group"
            style={{
              margin: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
            }}
          >
            {i === 0 && <label className="form-label">Required</label>}
            <label className="form-checkbox" style={{ margin: "8px 0 0" }}>
              <input
                type="checkbox"
                checked={f.isRequired}
                onChange={(e) => update(i, { isRequired: e.target.checked })}
              />
              <span>Yes</span>
            </label>
          </div>
          <div style={{ paddingTop: i === 0 ? "20px" : "0" }}>
            <span
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                fontFamily: "monospace",
              }}
            >
              {f.name || "key"}
            </span>
          </div>
          <div style={{ paddingTop: i === 0 ? "20px" : "0" }}>
            <button
              type="button"
              className="btn-danger-sm"
              onClick={() => remove(i)}
              title="Remove field"
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn-secondary"
        style={{ alignSelf: "flex-start", fontSize: "13px" }}
        onClick={add}
      >
        + Add field
      </button>
    </div>
  );
}

// ── Step 3: States ────────────────────────────────────────────────────────────

function Step3({
  states,
  setStates,
  initialState,
  setInitialState,
}: {
  states: StateRow[];
  setStates: (s: StateRow[]) => void;
  initialState: string;
  setInitialState: (s: string) => void;
}): React.ReactElement {
  function add(): void {
    const colorIdx = states.length % STATE_COLORS.length;
    setStates([
      ...states,
      {
        label: "",
        name: "",
        color: STATE_COLORS[colorIdx] ?? "#6366f1",
        isTerminal: false,
      },
    ]);
  }
  function remove(i: number): void {
    const next = states.filter((_, idx) => idx !== i);
    setStates(next);
    if (initialState === states[i]?.name) setInitialState(next[0]?.name ?? "");
  }
  function update(i: number, patch: Partial<StateRow>): void {
    const next = states.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    setStates(next);
    if (patch.name && initialState === states[i]?.name)
      setInitialState(patch.name);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>
        Define the stages a record moves through. Mark one as the starting state
        and any as terminal (end states).
      </p>

      {states.length === 0 && (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            border: "1px dashed var(--border-color)",
            borderRadius: "8px",
            color: "var(--text-muted)",
            fontSize: "13px",
          }}
        >
          Add at least one state to create the workflow.
        </div>
      )}

      {states.map((s, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 42px auto auto auto",
            gap: "10px",
            alignItems: "end",
          }}
        >
          <div className="form-group" style={{ margin: 0 }}>
            {i === 0 && <label className="form-label">State name</label>}
            <input
              className="form-input"
              placeholder="e.g. Open, In Progress, Resolved"
              value={s.label}
              onChange={(e) => {
                const label = e.target.value;
                const name = toSnake(label);
                update(i, { label, name });
              }}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            {i === 0 && <label className="form-label">Color</label>}
            <input
              type="color"
              value={s.color}
              onChange={(e) => update(i, { color: e.target.value })}
              style={{
                width: "42px",
                height: "38px",
                padding: "2px",
                borderRadius: "6px",
                border: "1px solid var(--border-color)",
                background: "none",
                cursor: "pointer",
              }}
            />
          </div>
          <div
            style={{
              paddingTop: i === 0 ? "20px" : "0",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "2px",
            }}
          >
            {i === 0 && (
              <span className="form-label" style={{ fontSize: "11px" }}>
                Start
              </span>
            )}
            <input
              type="radio"
              name="initialState"
              checked={initialState === s.name}
              onChange={() => setInitialState(s.name)}
              disabled={!s.name}
              style={{ width: "16px", height: "16px", cursor: "pointer" }}
            />
          </div>
          <div
            style={{
              paddingTop: i === 0 ? "20px" : "0",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "2px",
            }}
          >
            {i === 0 && (
              <span className="form-label" style={{ fontSize: "11px" }}>
                End
              </span>
            )}
            <input
              type="checkbox"
              checked={s.isTerminal}
              onChange={(e) => update(i, { isTerminal: e.target.checked })}
              style={{ width: "16px", height: "16px", cursor: "pointer" }}
            />
          </div>
          <div style={{ paddingTop: i === 0 ? "20px" : "0" }}>
            <button
              type="button"
              className="btn-danger-sm"
              onClick={() => remove(i)}
              title="Remove state"
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn-secondary"
        style={{ alignSelf: "flex-start", fontSize: "13px" }}
        onClick={add}
      >
        + Add state
      </button>
    </div>
  );
}

// ── Step 4: Transitions ───────────────────────────────────────────────────────

function Step4({
  transitions,
  setTransitions,
  stateNames,
  availableRoles,
}: {
  transitions: TransitionRow[];
  setTransitions: (t: TransitionRow[]) => void;
  stateNames: string[];
  availableRoles: string[];
}): React.ReactElement {
  function add(): void {
    setTransitions([
      ...transitions,
      {
        fromState: stateNames[0] ?? "",
        toState: stateNames[1] ?? stateNames[0] ?? "",
        label: "",
        allowedRoles: ["admin", "agent"],
      },
    ]);
  }
  function remove(i: number): void {
    setTransitions(transitions.filter((_, idx) => idx !== i));
  }
  function update(i: number, patch: Partial<TransitionRow>): void {
    setTransitions(
      transitions.map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>
        Optional — define which state changes are allowed and who can trigger
        them. You can also add or edit transitions from the workflow detail page
        later.
      </p>

      {transitions.length === 0 && (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            border: "1px dashed var(--border-color)",
            borderRadius: "8px",
            color: "var(--text-muted)",
            fontSize: "13px",
          }}
        >
          No transitions defined — users will not be able to move records
          between states until you add some (here or in the workflow detail).
        </div>
      )}

      {transitions.map((t, i) => (
        <div
          key={i}
          style={{
            background: "var(--bg-tertiary)",
            borderRadius: "8px",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              gap: "10px",
              alignItems: "end",
            }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">From state</label>
              <select
                className="form-input"
                value={t.fromState}
                onChange={(e) => update(i, { fromState: e.target.value })}
              >
                {stateNames.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div
              style={{
                paddingBottom: "8px",
                color: "var(--text-muted)",
                fontSize: "18px",
              }}
            >
              →
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">To state</label>
              <select
                className="form-input"
                value={t.toState}
                onChange={(e) => update(i, { toState: e.target.value })}
              >
                {stateNames.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
            }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">
                Button label{" "}
                <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                  (optional)
                </span>
              </label>
              <input
                className="form-input"
                placeholder="e.g. Start Working, Resolve, Close"
                value={t.label}
                onChange={(e) => update(i, { label: e.target.value })}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Who can trigger</label>
              <select
                multiple
                className="form-input"
                style={{
                  height: `${Math.min(availableRoles.length, 5) * 32 + 8}px`,
                  padding: "4px",
                }}
                value={t.allowedRoles}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions).map(
                    (o) => o.value,
                  );
                  update(i, { allowedRoles: selected });
                }}
              >
                {availableRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  marginTop: "4px",
                  display: "block",
                }}
              >
                Hold Ctrl / Cmd to select multiple
              </span>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn-danger-sm"
              onClick={() => remove(i)}
            >
              Remove transition
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn-secondary"
        style={{ alignSelf: "flex-start", fontSize: "13px" }}
        onClick={add}
        disabled={stateNames.length < 2}
      >
        + Add transition
      </button>
      {stateNames.length < 2 && (
        <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
          Need at least 2 states to define transitions.
        </p>
      )}
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export function CreateWorkflow(): React.ReactElement {
  const navigate = useNavigate();
  const { roles: availableRoles } = useRoles();
  const [step, setStep] = useState(1);

  // Step 1
  const [name, setName] = useState("");
  const [plural, setPlural] = useState("");
  const [icon, setIcon] = useState("");

  // Step 2
  const [fields, setFields] = useState<FieldRow[]>([]);

  // Step 3
  const [states, setStates] = useState<StateRow[]>([]);
  const [initialState, setInitialState] = useState("");

  // Step 4
  const [transitions, setTransitions] = useState<TransitionRow[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stateNames = states.filter((s) => s.name).map((s) => s.name);

  function canNext(): boolean {
    if (step === 1) return name.trim().length > 0 && plural.trim().length > 0;
    if (step === 2) return true;
    if (step === 3)
      return states.length > 0 && !!initialState && states.every((s) => s.name);
    if (step === 4) return true; // transitions are optional
    return false;
  }

  async function handleCreate(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      // 1. Create entity type
      const etRes = (await fetchWithAuth(`${API_URL}/entity-types`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          plural: plural.trim(),
          icon: icon.trim() || undefined,
          allowCustomFields: true,
        }),
      })) as { data: { id: string } };
      const entityTypeId = etRes.data.id;

      // 2. Create fields
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        if (!f?.label.trim()) continue;
        await fetchWithAuth(`${API_URL}/entity-types/${entityTypeId}/fields`, {
          method: "POST",
          body: JSON.stringify({
            name: f.name || toSnake(f.label),
            label: f.label.trim(),
            fieldType: f.fieldType,
            isRequired: f.isRequired,
            sortOrder: i,
            config: {},
          }),
        });
      }

      // 3. Create workflow (also creates initial state via the engine)
      const wfRes = (await fetchWithAuth(`${API_URL}/workflows`, {
        method: "POST",
        body: JSON.stringify({
          name: `${name.trim()} Workflow`,
          entityTypeId,
          initialState,
        }),
      })) as { data: { id: string } };
      const workflowId = wfRes.data.id;

      // 4. Create additional states
      for (let i = 0; i < states.length; i++) {
        const s = states[i];
        if (!s || s.name === initialState) continue;
        await fetchWithAuth(`${API_URL}/workflows/${workflowId}/states`, {
          method: "POST",
          body: JSON.stringify({
            name: s.name,
            label: s.label,
            color: s.color,
            isTerminal: s.isTerminal,
            sortOrder: i,
          }),
        });
      }

      // 5. Create transitions
      for (const t of transitions) {
        if (!t.fromState || !t.toState) continue;
        await fetchWithAuth(`${API_URL}/workflows/${workflowId}/transitions`, {
          method: "POST",
          body: JSON.stringify({
            fromState: t.fromState,
            toState: t.toState,
            label: t.label.trim() || undefined,
            allowedRoles:
              t.allowedRoles.length > 0 ? t.allowedRoles : undefined,
          }),
        });
      }

      navigate(`/workflows/${workflowId}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create workflow",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: "640px" }}>
      <div style={{ marginBottom: "24px" }}>
        <button
          className="back-link"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
          onClick={() => navigate("/workflows")}
        >
          ← Workflows
        </button>
        <h2 className="page-title" style={{ marginTop: "8px" }}>
          New Workflow
        </h2>
        <p className="page-subtitle">
          Set up a record type and its workflow in one go.
        </p>
      </div>

      <Steps current={step} />

      <div className="data-panel" style={{ padding: "28px" }}>
        {error && (
          <div className="alert alert-error" style={{ marginBottom: "20px" }}>
            {error}
          </div>
        )}

        {step === 1 && (
          <Step1
            name={name}
            setName={setName}
            plural={plural}
            setPlural={setPlural}
            icon={icon}
            setIcon={setIcon}
          />
        )}
        {step === 2 && <Step2 fields={fields} setFields={setFields} />}
        {step === 3 && (
          <Step3
            states={states}
            setStates={setStates}
            initialState={initialState}
            setInitialState={setInitialState}
          />
        )}
        {step === 4 && (
          <Step4
            transitions={transitions}
            setTransitions={setTransitions}
            stateNames={stateNames}
            availableRoles={availableRoles}
          />
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "28px",
            paddingTop: "20px",
            borderTop: "1px solid var(--border-color)",
          }}
        >
          <button
            className="btn-secondary"
            onClick={() =>
              step > 1 ? setStep(step - 1) : navigate("/workflows")
            }
          >
            {step === 1 ? "Cancel" : "← Back"}
          </button>
          {step < 4 ? (
            <button
              className="btn-primary"
              disabled={!canNext()}
              onClick={() => setStep(step + 1)}
            >
              Next →
            </button>
          ) : (
            <div style={{ display: "flex", gap: "10px" }}>
              {transitions.length === 0 && (
                <button
                  className="btn-secondary"
                  disabled={saving}
                  onClick={() => void handleCreate()}
                >
                  {saving ? "Creating…" : "Skip & Create"}
                </button>
              )}
              <button
                className="btn-primary"
                disabled={saving}
                onClick={() => void handleCreate()}
              >
                {saving
                  ? "Creating…"
                  : transitions.length > 0
                    ? "Create Workflow"
                    : "Create without transitions"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
