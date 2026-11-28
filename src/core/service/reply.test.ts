import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { UNREADABLE_REPLY } from "./errors"
import { agentsOf, defaultModelOf, locationOf, modelsOf, pluginsOf, projectOf, providersOf, vcsOf } from "./reply"

function unreadable(read: () => unknown): void {
  try {
    read()
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError)
    expect((error as ToolError).code).toBe("upstream_error")
    expect((error as ToolError).message).toBe(UNREADABLE_REPLY)
    return
  }
  throw new Error("expected the reply to be unreadable")
}

const agent = { id: "plan", name: "plan", mode: "primary", hidden: false }
const model = { id: "model-1", providerID: "acme", name: "Acme model-1", status: "active", variants: [{ id: "low" }] }

describe("every list reply", () => {
  const readers: [string, (reply: unknown) => unknown, unknown][] = [
    ["agentsOf", agentsOf, agent],
    ["modelsOf", modelsOf, model],
    ["providersOf", providersOf, { id: "acme", name: "Acme" }],
  ]

  test.each(readers)("%s refuses what is not a reply with a list", (_name, read) => {
    for (const reply of [{}, { data: null }, { data: {} }, { data: "x" }, null, undefined, [], "text", 5]) {
      unreadable(() => read(reply))
    }
  })

  test.each(readers)("%s gives the entries, whatever else the reply and the entries carry", (_name, read, entry) => {
    expect(read({ data: [] })).toEqual([])
    const entries = read({ location: { directory: "/x" }, data: [{ ...(entry as object), extra: { deep: [1] } }] })
    expect(entries).toEqual([{ ...(entry as object), extra: { deep: [1] } }])
  })

  test.each(readers)("%s refuses an entry of the wrong shape", (_name, read, entry) => {
    unreadable(() => read({ data: [{}] }))
    unreadable(() => read({ data: [{ ...(entry as object), id: 5 }] }))
    unreadable(() => read({ data: [entry, null] }))
  })
})

describe("agentsOf", () => {
  test("takes an agent's model, null or absent, and its description, null or absent", () => {
    const [withModel, nullish, absent] = agentsOf({
      data: [
        { ...agent, model: { providerID: "acme", id: "model-1", variant: "high" }, description: "Reviews." },
        { ...agent, model: null, description: null },
        agent,
      ],
    })
    expect(withModel).toMatchObject({ model: { providerID: "acme", id: "model-1", variant: "high" } })
    expect(nullish).toMatchObject({ model: null, description: null })
    expect(absent!.model).toBeUndefined()
  })

  test("refuses a mode that is not text, a hidden that is not a boolean and a model of the wrong shape", () => {
    unreadable(() => agentsOf({ data: [{ ...agent, mode: 1 }] }))
    unreadable(() => agentsOf({ data: [{ ...agent, hidden: "no" }] }))
    unreadable(() => agentsOf({ data: [{ ...agent, model: { id: "model-1" } }] }))
    unreadable(() => agentsOf({ data: [{ ...agent, description: 5 }] }))
  })

  test("accepts a mode it does not know", () => {
    expect(agentsOf({ data: [{ ...agent, mode: "future" }] })[0]!.mode).toBe("future")
  })
})

describe("modelsOf", () => {
  test("refuses variants that are not a list of ids", () => {
    unreadable(() => modelsOf({ data: [{ ...model, variants: undefined }] }))
    unreadable(() => modelsOf({ data: [{ ...model, variants: ["low"] }] }))
    unreadable(() => modelsOf({ data: [{ ...model, variants: [{}] }] }))
  })
})

describe("defaultModelOf", () => {
  test("is no model when data is null or left out", () => {
    expect(defaultModelOf({ data: null })).toBeUndefined()
    expect(defaultModelOf({})).toBeUndefined()
    expect(defaultModelOf({ location: { directory: "/x" } })).toBeUndefined()
  })

  test("is the model written by its provider and id, and nothing else", () => {
    expect(defaultModelOf({ data: { ...model } })).toEqual({ providerID: "acme", id: "model-1" })
  })

  test("refuses data that is not a model, and a reply that is not an object", () => {
    for (const reply of [{ data: {} }, { data: { id: "model-1" } }, { data: { providerID: "acme" } }, { data: 5 }]) {
      unreadable(() => defaultModelOf(reply))
    }
    for (const reply of [null, undefined, "text", []]) unreadable(() => defaultModelOf(reply))
  })
})

describe("vcsOf", () => {
  test("reads the provider and the branch, null or absent", () => {
    expect(vcsOf({ data: { provider: "git", branch: { current: "main", default: "main" } } })).toMatchObject({
      provider: "git",
      branch: { current: "main" },
    })
    expect(vcsOf({ data: { branch: {} } }).provider).toBeUndefined()
    expect(vcsOf({ data: { provider: null, branch: { current: null } } }).branch.current).toBeNull()
  })

  test("refuses data without a branch, or of the wrong shape", () => {
    for (const reply of [{}, { data: null }, { data: {} }, { data: { provider: "git" } }, { data: { branch: null } }]) {
      unreadable(() => vcsOf(reply))
    }
    unreadable(() => vcsOf({ data: { provider: 1, branch: {} } }))
    unreadable(() => vcsOf({ data: { branch: { current: 1 } } }))
  })
})

describe("pluginsOf", () => {
  test("gives the entries, whatever else they carry, and none for an empty list", () => {
    expect(pluginsOf({ data: [] })).toEqual([])
    expect(
      pluginsOf({
        location: { directory: "/x" },
        data: [
          { id: "acme.one", state: { status: "failed", error: "x" } },
          { state: { status: "active" }, extra: 1 },
        ],
      }),
    ).toHaveLength(2)
  })

  test("refuses a reply without a list, and an entry without a state with a status", () => {
    for (const reply of [{}, { data: null }, { data: {} }, { data: [null] }, { data: ["x"] }, null, [], "text"]) {
      unreadable(() => pluginsOf(reply))
    }
    for (const entry of [{}, { id: "acme.one" }, { state: {} }, { state: { status: 1 } }, { state: null }]) {
      unreadable(() => pluginsOf({ data: [entry] }))
      unreadable(() => pluginsOf({ data: [{ state: { status: "active" } }, entry] }))
    }
  })
})

describe("an id a decision uses", () => {
  test("is never empty: of an agent, a model, a provider, a default model, an agent's own model", () => {
    unreadable(() => agentsOf({ data: [{ ...agent, id: "" }] }))
    unreadable(() => agentsOf({ data: [{ ...agent, model: { providerID: "", id: "model-1" } }] }))
    unreadable(() => agentsOf({ data: [{ ...agent, model: { providerID: "acme", id: "" } }] }))
    unreadable(() => modelsOf({ data: [{ ...model, id: "" }] }))
    unreadable(() => modelsOf({ data: [{ ...model, providerID: "" }] }))
    unreadable(() => providersOf({ data: [{ id: "", name: "Acme" }] }))
    unreadable(() => defaultModelOf({ data: { id: "", providerID: "acme" } }))
    unreadable(() => defaultModelOf({ data: { id: "model-1", providerID: "" } }))
    unreadable(() => locationOf({ project: { id: "" } }))
    unreadable(() => projectOf([{ id: "" }], ""))
  })
})

describe("locationOf", () => {
  test("gives the id of the project, whatever else the reply carries", () => {
    expect(locationOf({ directory: "/x", project: { id: "p1", directory: "/x", canonical: "/x" } }).project.id).toBe(
      "p1",
    )
  })

  test("refuses a reply without a project id", () => {
    for (const reply of [
      {},
      { project: null },
      { project: {} },
      { project: { id: 5 } },
      { project: { id: "" } },
      null,
      [],
      "text",
    ]) {
      unreadable(() => locationOf(reply))
    }
  })
})

describe("projectOf", () => {
  const rows = [
    { id: "p1", vcs: "git", canonical: "/x", time: {}, sandboxes: [] },
    { id: "p2", vcs: null },
    { id: "p3" },
  ]

  test("gives the row with the id, its version control string, null or absent, whatever else it carries", () => {
    expect(projectOf(rows, "p1")).toMatchObject({ id: "p1", vcs: "git" })
    expect(projectOf(rows, "p2")).toMatchObject({ id: "p2", vcs: null })
    expect(projectOf(rows, "p3")!.vcs).toBeUndefined()
  })

  test("gives undefined when no row has the id, and for an empty list", () => {
    expect(projectOf(rows, "p4")).toBeUndefined()
    expect(projectOf([], "p1")).toBeUndefined()
  })

  test("takes the first row that has the id", () => {
    expect(projectOf([{ id: "p1", vcs: "git" }, { id: "p1" }], "p1")!.vcs).toBe("git")
  })

  test("refuses a reply that is not a list", () => {
    for (const reply of [{}, { data: [] }, null, undefined, "text", 5]) unreadable(() => projectOf(reply, "p1"))
  })

  test("refuses the row it looks for when that is malformed", () => {
    unreadable(() => projectOf([{ id: "p1", vcs: 1 }], "p1"))
    unreadable(() => projectOf([{ id: "p1", vcs: ["git"] }], "p1"))
  })

  test("does not read the other rows, whatever they are", () => {
    const others = [{}, { id: 5 }, { id: "p0", vcs: 1 }, null, "text", 5, [], { id: "" }]
    expect(projectOf([...others, { id: "p1", vcs: "git" }, ...others], "p1")).toMatchObject({ id: "p1", vcs: "git" })
    expect(projectOf(others, "p9")).toBeUndefined()
  })
})
