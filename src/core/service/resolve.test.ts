import { describe, expect, test } from "bun:test"
import type { Role } from "../role"
import type { AgentEntry, ModelEntry } from "./reply"
import { resolveRole } from "./resolve"

const agent = (fields: Partial<AgentEntry> = {}): AgentEntry => ({
  id: "plan",
  name: "plan",
  mode: "primary",
  hidden: false,
  ...fields,
})
const model = (fields: Partial<ModelEntry> = {}): ModelEntry => ({
  id: "m1",
  providerID: "acme",
  name: "m1",
  status: "active",
  variants: [{ id: "low" }],
  ...fields,
})
const role: Role = { agent: "plan", policy: "read-only" }
const fallback = { providerID: "acme", id: "default" }

describe("resolveRole: the agent", () => {
  test("a missing agent is a finding, and the model still resolves", () => {
    const resolved = resolveRole("plan", role, [], [], fallback)
    expect(resolved.agent).toBeUndefined()
    expect(resolved.findings.map((finding) => finding.code)).toEqual(["agent_missing"])
    expect(resolved.model).toEqual(fallback)
  })

  test("a subagent is not primary, and `all` is", () => {
    expect(resolveRole("plan", role, [agent({ mode: "subagent" })], [], fallback).findings.map((f) => f.code)).toEqual([
      "agent_not_primary",
    ])
    expect(resolveRole("plan", role, [agent({ mode: "all" })], [], fallback).findings).toEqual([])
  })

  test("a hidden agent is a finding, after the mode's", () => {
    const resolved = resolveRole("plan", role, [agent({ mode: "subagent", hidden: true })], [], fallback)
    expect(resolved.findings.map((finding) => finding.code)).toEqual(["agent_not_primary", "agent_hidden"])
  })
})

describe("resolveRole: the model", () => {
  test("the role's model wins, with its variant", () => {
    const resolved = resolveRole("plan", { ...role, model: "acme/m1#low" }, [agent()], [model()], fallback)
    expect(resolved.findings).toEqual([])
    expect(resolved.model).toEqual({ providerID: "acme", id: "m1", variant: "low" })
    expect(resolved.agent?.id).toBe("plan")
  })

  test("a model the service does not list is a finding with no model", () => {
    const resolved = resolveRole("plan", { ...role, model: "acme/other" }, [agent()], [model()], fallback)
    expect(resolved.findings.map((finding) => finding.code)).toEqual(["model_unavailable"])
    expect(resolved.model).toBeUndefined()
  })

  test("an unknown variant is a finding, and the model stays", () => {
    const resolved = resolveRole("plan", { ...role, model: "acme/m1#high" }, [agent()], [model()], fallback)
    expect(resolved.findings.map((finding) => finding.code)).toEqual(["variant_unavailable"])
    expect(resolved.model).toMatchObject({ id: "m1", variant: "high" })
  })

  test("the agent's own model is used when the role names none and the service lists it", () => {
    const own = { providerID: "acme", id: "m1" }
    const resolved = resolveRole("plan", role, [agent({ model: own })], [model()], fallback)
    expect(resolved.model).toEqual(own)
    expect(resolved.findings).toEqual([])
  })

  test("an agent's model the service does not list gives way to the default", () => {
    const resolved = resolveRole("plan", role, [agent({ model: { providerID: "x", id: "y" } })], [model()], fallback)
    expect(resolved.model).toEqual(fallback)
  })

  test("with no model anywhere, a run cannot start", () => {
    const resolved = resolveRole("plan", role, [agent()], [], undefined)
    expect(resolved.findings.map((finding) => finding.code)).toEqual(["no_model"])
    expect(resolved.model).toBeUndefined()
  })
})
