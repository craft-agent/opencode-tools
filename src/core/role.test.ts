import { describe, expect, test } from "bun:test"
import { isToolError } from "./errors"
import { DEFAULT_ROLES, MAX_ROLES, modelText, parseModel, rolesOf } from "./role"
import type { ToolOptions } from "./tool"

const roles = (value: unknown) => ({ roles: value }) as unknown as ToolOptions

function refusal(value: unknown): string {
  try {
    rolesOf(roles(value))
  } catch (error) {
    expect(isToolError(error) && error.code).toBe("invalid_argument")
    return (error as Error).message
  }
  throw new Error("expected the roles to be refused")
}

const one = (role: unknown, name = "r") => refusal({ [name]: role })
const valid = { agent: "a", policy: "write" }

describe("defaults", () => {
  test("no roles, or none given, are the two default roles", () => {
    expect(rolesOf(undefined)).toEqual(DEFAULT_ROLES)
    expect(rolesOf({})).toEqual(DEFAULT_ROLES)
    expect(rolesOf(roles({}))).toEqual(DEFAULT_ROLES)
    expect(DEFAULT_ROLES).toEqual({
      plan: { agent: "plan", policy: "read-only" },
      build: { agent: "build", policy: "write" },
    })
  })

  test("mutating a result leaves the defaults alone", () => {
    const first = rolesOf(undefined) as Record<string, { agent: string }>
    first.plan!.agent = "changed"
    first.extra = { agent: "x" }
    expect(rolesOf(undefined)).toEqual(DEFAULT_ROLES)
    expect(DEFAULT_ROLES.plan!.agent).toBe("plan")
  })

  test("configured roles replace both", () => {
    expect(Object.keys(rolesOf(roles({ only: valid })))).toEqual(["only"])
  })
})

describe("the roles setting", () => {
  test.each([["s"], [[]], [1], [true], [null]])("refuses %j as not an object", (value) => {
    expect(refusal(value)).toBe('Setting "roles" must be an object of roles by name.')
  })

  test("allows 20 roles and refuses 21", () => {
    const named = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`r${i}`, valid]))
    expect(Object.keys(rolesOf(roles(named(MAX_ROLES))))).toHaveLength(MAX_ROLES)
    expect(refusal(named(MAX_ROLES + 1))).toBe('Setting "roles" names 21 roles; at most 20 are allowed.')
  })
})

describe("a role's name", () => {
  const nameMessage = (name: string) =>
    `Role name "${name}" must be a lowercase letter followed by at most 23 lowercase letters, digits or underscores.`

  test.each(["Bad", "1a", "a-b", "_a", "a b", ""])("refuses %j", (name) => {
    expect(one(valid, name)).toBe(nameMessage(name))
  })

  test("allows 24 characters and refuses 25", () => {
    const ok = `a${"b".repeat(23)}`
    expect(Object.keys(rolesOf(roles({ [ok]: valid })))).toEqual([ok])
    expect(one(valid, `${ok}b`)).toBe(nameMessage(`${ok}b`))
  })

  test("is cut to its first 40 characters in a message", () => {
    const long = `A${"b".repeat(60)}`
    expect(one(valid, long)).toBe(nameMessage(long.slice(0, 40)))
    expect(one("x", long)).not.toContain(long)
  })
})

describe("a role's shape", () => {
  test.each([[null], ["s"], [1], [[]], [true]])("refuses %j as not an object", (role) => {
    expect(one(role)).toBe('Role "r" must be an object with an agent and a policy.')
  })

  test("refuses an unknown key, cut to 40 characters", () => {
    expect(one({ ...valid, extra: 1 })).toBe('Role "r" has an unknown key "extra"; use agent, policy, model or note.')
    const key = "k".repeat(60)
    expect(one({ ...valid, [key]: 1 })).toBe(
      `Role "r" has an unknown key "${key.slice(0, 40)}"; use agent, policy, model or note.`,
    )
  })

  test.each([undefined, 1, "", "  ", null])("refuses the agent %j", (agent) => {
    expect(one({ agent, policy: "write" })).toBe('Role "r" needs an agent.')
  })

  test.each([undefined, "Write", "readonly", "", 1, null])("refuses the policy %j", (policy) => {
    expect(one({ agent: "a", policy })).toBe('Role "r" needs a policy of "read-only" or "write".')
  })

  test.each(["a", "/b", "a/", "a/b#", "acme/#high", "a /b", "", 1, null])("refuses the model %j", (model) => {
    expect(one({ ...valid, model })).toBe(
      'Role "r" has a model that is not written <provider>/<model> or <provider>/<model>#<variant>.',
    )
  })

  test.each([[1], [null], [["x"]], ["n".repeat(2001)]])("refuses the note %j", (note) => {
    expect(one({ ...valid, note })).toBe('Role "r" has a note that is not text of at most 2000 characters.')
  })

  test("checks in order: name, shape, keys, agent, policy, model, note", () => {
    expect(one({ extra: 1, model: "bad" }, "Bad")).toContain("Role name")
    expect(one({ extra: 1, model: "bad" })).toContain("unknown key")
    expect(one({ model: "bad", note: 1 })).toContain("needs an agent")
    expect(one({ agent: "a", model: "bad", note: 1 })).toContain("needs a policy")
    expect(one({ ...valid, model: "bad", note: 1 })).toContain("a model")
    expect(refusal({ ok: valid, Bad: {} })).toContain('"Bad"')
    expect(refusal({ first: { agent: "" }, second: { agent: "" } })).toContain('"first"')
  })
})

describe("what is stored", () => {
  test("trims the agent, the model and the note, and keeps only keys that are set", () => {
    expect(
      rolesOf(
        roles({
          r: { agent: " a ", policy: "read-only", model: " p/m#v ", note: "  hi  " },
          s: { agent: "b", policy: "write", note: "   " },
        }),
      ),
    ).toEqual({
      r: { agent: "a", policy: "read-only", model: "p/m#v", note: "hi" },
      s: { agent: "b", policy: "write" },
    })
    expect("note" in rolesOf(roles({ s: { ...valid, note: " " } })).s!).toBe(false)
  })

  test("allows a note of 2000 characters", () => {
    const note = "n".repeat(2000)
    expect(rolesOf(roles({ r: { ...valid, note } })).r!.note).toBe(note)
  })

  test("keeps the order the roles were given in", () => {
    expect(Object.keys(rolesOf(roles({ z: valid, a: valid, m: valid })))).toEqual(["z", "a", "m"])
  })
})

describe("the roles map", () => {
  test("has no inherited properties", () => {
    const defaults = rolesOf(undefined) as Record<string, unknown>
    expect(defaults["constructor"]).toBeUndefined()
    expect(defaults["toString"]).toBeUndefined()
    expect(defaults["__proto__"]).toBeUndefined()
  })

  test("returns a configured role named constructor", () => {
    const configured = rolesOf(roles({ constructor: valid })) as Record<string, unknown>
    expect(configured["constructor"]).toEqual(valid)
    expect(configured["toString"]).toBeUndefined()
  })

  test("refuses a __proto__ role from parsed JSON by the name rule", () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"agent":"a","policy":"write"}}')
    expect(refusal(parsed)).toContain('Role name "__proto__"')
  })
})

describe("escaping in messages", () => {
  test("a role name with a newline is escaped", () => {
    const message = one(valid, "a\nb")
    expect(message).toContain("a\\nb")
    expect(message).not.toContain("\n")
  })

  test("an unknown key with a control character is escaped", () => {
    const message = one({ ...valid, "k\u001bx": 1 })
    expect(message).toContain("k\\u001bx")
    expect(message).not.toContain("\u001b")
  })
})

describe("parseModel", () => {
  test("splits provider, model and variant", () => {
    expect(parseModel("a/b")).toEqual({ providerID: "a", modelID: "b" })
    expect(parseModel("a/b/c#high")).toEqual({ providerID: "a", modelID: "b/c", variant: "high" })
    expect(parseModel(" acme/model-1.5:beta#max ")).toEqual({
      providerID: "acme",
      modelID: "model-1.5:beta",
      variant: "max",
    })
  })

  test("splits as OpenCode does: at the first slash, then at the first # after it", () => {
    expect(parseModel("team#blue/model")).toEqual({ providerID: "team#blue", modelID: "model" })
    expect(parseModel("acme/group/model-1#high")).toEqual({
      providerID: "acme",
      modelID: "group/model-1",
      variant: "high",
    })
    expect(parseModel("acme/model-1#a#b")).toEqual({ providerID: "acme", modelID: "model-1", variant: "a#b" })
    expect(parseModel("team#blue/model#v")).toEqual({ providerID: "team#blue", modelID: "model", variant: "v" })
  })

  test.each(["a", "/b", "/model", "a/", "a/b#", "acme/#high", "acme/model-1#", "a /b", "", "  ", "#v", "a/b #v"])(
    "refuses %j",
    (text) => {
      expect(parseModel(text)).toBeUndefined()
    },
  )
})

describe("modelText", () => {
  test("writes the provider and the model, with a variant when it has one", () => {
    expect(modelText({ providerID: "acme", id: "model-1" })).toBe("acme/model-1")
    expect(modelText({ providerID: "acme", id: "model-1", variant: "high" })).toBe("acme/model-1#high")
  })

  test("leaves out the variant `default`, which means none", () => {
    expect(modelText({ providerID: "acme", id: "model-1", variant: "default" })).toBe("acme/model-1")
  })

  test("is the inverse of parseModel", () => {
    for (const text of ["acme/model-1", "acme/model-1#high", "a/b/c#x", "team#blue/model#a#b"]) {
      const parsed = parseModel(text)!
      expect(modelText({ providerID: parsed.providerID, id: parsed.modelID, variant: parsed.variant })).toBe(text)
    }
  })
})
