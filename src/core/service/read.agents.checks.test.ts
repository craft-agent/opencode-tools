import { describe, expect, test } from "bun:test"
import { MAX_DIRECTORY } from "./directory"
import { UNREADABLE_REPLY } from "./errors"
import { MAX_ID, MAX_LIST_CHARS } from "./schemas"
import { CWD, agentLike, failure, read, setup } from "./read.testing"

const JSON_HEADERS = { "content-type": "application/json" }

describe("the size a result keeps", () => {
  test("stops at the character budget, in order, and counts them all", async () => {
    const heavy = Array.from({ length: 60 }, (_, index) =>
      agentLike(`agent-${index}`, { name: "n".repeat(500), description: "d".repeat(500) }),
    )
    const result = await read({ method: "agents" }, setup({ state: { agents: heavy } }).ctx)
    expect(result.agents!.length).toBeGreaterThan(0)
    expect(result.agents!.length).toBeLessThan(60)
    expect(result.agents!.map((agent) => agent.id)).toEqual(heavy.slice(0, result.agents!.length).map((a) => a.id))
    expect(JSON.stringify(result.agents).length).toBeLessThanOrEqual(MAX_LIST_CHARS + result.agents!.length)
    expect(result).toMatchObject({ total: 60, truncated: true })
  })

  test("leaves out an agent whose id is too long to be used, and says so", async () => {
    const longest = "i".repeat(MAX_ID)
    const { ctx } = setup({
      state: { agents: [agentLike("a"), agentLike("x".repeat(MAX_ID + 1)), agentLike(longest), agentLike("b")] },
    })
    const result = await read({ method: "agents" }, ctx)
    expect(result.agents!.map((agent) => agent.id)).toEqual(["a", longest, "b"])
    expect(result).toMatchObject({ total: 4, truncated: true })
  })

  test("gives null for a model of an agent whose provider or id is too long", async () => {
    const long = "m".repeat(MAX_ID + 1)
    const { ctx } = setup({
      state: {
        agents: [
          agentLike("a", { model: { providerID: long, id: "model-1" } }),
          agentLike("b", { model: { providerID: "acme", id: long } }),
          agentLike("c", { model: { providerID: "acme", id: "model-1" } }),
        ],
      },
    })
    const result = await read({ method: "agents" }, ctx)
    expect(result.agents!.map((agent) => agent.model)).toEqual([null, null, "acme/model-1"])
    expect(result).toMatchObject({ total: 3, truncated: true })
  })

  test("is not truncated by an agent that simply has no model, nor by a model that fits", async () => {
    const { ctx } = setup({
      state: { agents: [agentLike("a"), agentLike("b", { model: { providerID: "i".repeat(MAX_ID), id: "m" } })] },
    })
    const result = await read({ method: "agents" }, ctx)
    expect(result.agents!.map((agent) => agent.model)).toEqual([null, `${"i".repeat(MAX_ID)}/m`])
    expect(result.truncated).toBe(false)
  })
})

describe("a reply of the wrong shape", () => {
  test.each([
    ["no data", "{}"],
    ["null data", '{"data":null}'],
    ["data that is not a list", '{"data":{}}'],
  ])("%s is upstream_error", async (_name, body) => {
    const { ctx, service } = setup()
    service.failNext("/api/agent", new Response(body, { headers: JSON_HEADERS }))
    const error = await failure(read({ method: "agents" }, ctx))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(UNREADABLE_REPLY)
  })

  test("an agent without an id is upstream_error", async () => {
    const { ctx, service } = setup()
    const body = JSON.stringify({ data: [{ name: "x", mode: "primary", hidden: false }] })
    service.failNext("/api/agent", new Response(body, { headers: JSON_HEADERS }))
    expect((await failure(read({ method: "agents" }, ctx))).message).toBe(UNREADABLE_REPLY)
  })

  test("fields it does not read, and a mode it does not know, are accepted", async () => {
    const { ctx, service } = setup()
    const body = JSON.stringify({
      data: [{ id: "a", name: "a", mode: "future", hidden: false, newField: { deep: 1 } }],
      cursor: null,
    })
    service.failNext("/api/agent", new Response(body, { headers: JSON_HEADERS }))
    expect((await read({ method: "agents" }, ctx)).agents).toEqual([
      { id: "a", name: "a", mode: "future", hidden: false, model: null, description: null },
    ])
  })
})

describe("the effective directory is checked whichever it is, before the service is connected", () => {
  const NOT_ABSOLUTE = "The call's working directory is not an absolute path; pass directory."

  test.each([
    ["a relative working directory", "relative/dir"],
    ["an empty working directory", ""],
  ])("%s is refused when it is the directory used", async (_name, cwd) => {
    const { service, runtime, ctx } = setup({ ctx: { cwd }, runtime: { running: false } })
    const error = await failure(read({ method: "agents" }, ctx))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(NOT_ABSOLUTE)
    expect(runtime.started).toEqual([])
    expect(service.requests).toEqual([])
  })

  test("a relative working directory does not matter when a directory is given", async () => {
    const { ctx } = setup({ ctx: { cwd: "relative/dir" } })
    expect((await read({ method: "agents", directory: "/work/other" }, ctx)).directory).toBe("/work/other")
  })

  test.each([
    ["given", { method: "agents", directory: "/work/a\0b" }, CWD],
    ["the working directory", { method: "agents" }, "/work/a\0b"],
  ])("a NUL character in the directory %s is refused", async (_name, args, cwd) => {
    const { service, runtime, ctx } = setup({ ctx: { cwd }, runtime: { running: false } })
    const error = await failure(read(args, ctx))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("directory must not contain a NUL character.")
    expect(runtime.started).toEqual([])
    expect(service.requests).toEqual([])
  })

  test("a directory of more than 4096 characters, given or used as the working directory, is refused first", async () => {
    const long = `/${"d".repeat(MAX_DIRECTORY)}`
    const refusal = `directory must be at most ${MAX_DIRECTORY} characters.`
    for (const [args, cwd] of [
      [{ method: "agents", directory: long }, CWD],
      [{ method: "agents" }, long],
      [{ method: "agents", directory: `${long}\0` }, CWD],
      [{ method: "agents", directory: `${"x".repeat(MAX_DIRECTORY + 1)}` }, CWD],
    ] as const) {
      const { service, runtime, ctx } = setup({ ctx: { cwd, ownDir: CWD }, runtime: { running: false } })
      const error = await failure(read(args, ctx))
      expect(error.code).toBe("invalid_argument")
      expect(error.message).toBe(refusal)
      expect(runtime.started).toEqual([])
      expect(service.requests).toEqual([])
    }
  })

  test("a directory of exactly 4096 characters is let through", async () => {
    const edge = `/${"d".repeat(MAX_DIRECTORY - 1)}`
    expect((await read({ method: "agents", directory: edge }, setup().ctx)).directory).toBe(edge)
  })

  test("every method that takes a directory refuses them alike", async () => {
    for (const args of [
      { method: "providers" },
      { method: "models", provider: "acme" },
      { method: "ready", role: "plan" },
    ]) {
      const { service, runtime, ctx } = setup({ ctx: { cwd: "" }, runtime: { running: false } })
      expect((await failure(read(args, ctx))).message).toBe(NOT_ABSOLUTE)
      expect(runtime.started).toEqual([])
      expect(service.requests).toEqual([])
    }
  })
})
