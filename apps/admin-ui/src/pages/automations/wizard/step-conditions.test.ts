import { describe, it, expect } from "vitest";
import {
  isGroup,
  cloneNode,
  updateNodeAt,
  removeNodeAt,
} from "./step-conditions.js";
import type { ConditionGroup, ConditionLeaf, ConditionNode } from "./types.js";

const leaf = (field = "status", value = "open"): ConditionLeaf => ({
  op: "eq",
  field,
  value,
});

const group = (
  op: "and" | "or",
  children: ConditionNode[],
): ConditionGroup => ({ op, children });

describe("isGroup", () => {
  it("returns true for and/or nodes", () => {
    expect(isGroup(group("and", []))).toBe(true);
    expect(isGroup(group("or", []))).toBe(true);
  });

  it("returns false for leaf nodes", () => {
    expect(isGroup(leaf())).toBe(false);
    expect(isGroup({ op: "contains", field: "x", value: "y" })).toBe(false);
    expect(isGroup({ op: "empty", field: "x" })).toBe(false);
  });
});

describe("cloneNode", () => {
  it("deep-copies a leaf without sharing references", () => {
    const original = leaf("priority", "high");
    const copy = cloneNode(original) as ConditionLeaf;
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
  });

  it("deep-copies nested groups without sharing references", () => {
    const original = group("and", [leaf("a"), group("or", [leaf("b")])]);
    const copy = cloneNode(original) as ConditionGroup;
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.children[0]).not.toBe(original.children[0]);
    expect(copy.children[1]).not.toBe(original.children[1]);
  });
});

describe("updateNodeAt", () => {
  it("updates root when path is empty", () => {
    const root = group("and", [leaf()]);
    const updated = updateNodeAt(root, [], (n) => ({
      ...(n as ConditionGroup),
      op: "or",
    }));
    expect(updated.op).toBe("or");
    expect(updated.children).toHaveLength(1);
  });

  it("updates a direct child leaf", () => {
    const root = group("and", [leaf("x", "1"), leaf("y", "2")]);
    const updated = updateNodeAt(root, [1], () => leaf("z", "3"));
    expect((updated.children[0] as ConditionLeaf).field).toBe("x");
    expect((updated.children[1] as ConditionLeaf).field).toBe("z");
  });

  it("updates a deeply nested node", () => {
    const inner = group("or", [leaf("a"), leaf("b")]);
    const root = group("and", [leaf("top"), inner]);
    const updated = updateNodeAt(root, [1, 0], () => leaf("replaced"));
    const updatedInner = updated.children[1] as ConditionGroup;
    expect((updatedInner.children[0] as ConditionLeaf).field).toBe("replaced");
    expect((updatedInner.children[1] as ConditionLeaf).field).toBe("b");
  });

  it("does not mutate the original", () => {
    const root = group("and", [leaf("x")]);
    updateNodeAt(root, [0], () => leaf("y"));
    expect((root.children[0] as ConditionLeaf).field).toBe("x");
  });
});

describe("removeNodeAt", () => {
  it("returns a clone unchanged when path is empty", () => {
    const root = group("and", [leaf("x")]);
    const result = removeNodeAt(root, []);
    expect(result).toEqual(root);
    expect(result).not.toBe(root);
  });

  it("removes a direct child by index", () => {
    const root = group("and", [leaf("a"), leaf("b"), leaf("c")]);
    const result = removeNodeAt(root, [1]);
    expect(result.children).toHaveLength(2);
    expect((result.children[0] as ConditionLeaf).field).toBe("a");
    expect((result.children[1] as ConditionLeaf).field).toBe("c");
  });

  it("removes a nested child", () => {
    const inner = group("or", [leaf("x"), leaf("y"), leaf("z")]);
    const root = group("and", [leaf("top"), inner]);
    const result = removeNodeAt(root, [1, 0]);
    const resultInner = result.children[1] as ConditionGroup;
    expect(resultInner.children).toHaveLength(2);
    expect((resultInner.children[0] as ConditionLeaf).field).toBe("y");
  });

  it("does not mutate the original", () => {
    const root = group("and", [leaf("a"), leaf("b")]);
    removeNodeAt(root, [0]);
    expect(root.children).toHaveLength(2);
  });
});
