import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { shown } from "../text"
import { MAX_DESCRIPTION, MAX_LISTED, MAX_NAME } from "./schemas"
import { CWD, agentLike, failure, read, setup } from "./read.testing"

describe("agents", () => {
  test("lists the agents as the service gives them, subagents and hidden ones included", async () => {
    const { ctx } = setup({
      state: {
        agents: [
          agentLike("plan", { mode: "primary" }),
          agentLike("scout", { mode: "subagent" }),
          agentLike("any", { mode: "all" }),
          agentLike("internal", { mode: "primary", hidden: true }),
        ],
      },
    })
    const result = await read({ method: "agents" }, ctx)
    expect(result.agents!.map(({ id, mode, hidden }) => [id, mode, hidden])).toEqual([
      ["plan", "primary", false],
      ["scout", "subagent", false],
      ["any", "all", false],
      ["internal", "primary", true],
    ])
    expect(result).toMatchObject({
      method: "agents",
      service_started: false,
      directory: CWD,
      total: 4,
      truncated: false,
    })
  })

  test("writes an agent's model with its variant, without a variant that is none, or as null", async () => {
    const { ctx } = setup({
      state: {
        agents: [
          agentLike("a", { model: { providerID: "acme", id: "model-1", variant: "high" } }),
          agentLike("b", { model: { providerID: "acme", id: "model-1" } }),
          agentLike("c", { model: { providerID: "acme", id: "model-1", variant: "default" } }),
          agentLike("d"),
        ],
      },
    })
    const result = await read({ method: "agents" }, ctx)
    expect(result.agents!.map((agent) => agent.model)).toEqual([
      "acme/model-1#high",
      "acme/model-1",
      "acme/model-1",
      null,
    ])
  })

  test("gives a description as it is, or null when it is absent or blank, and cuts a long one", async () => {
    const long = "d".repeat(MAX_DESCRIPTION + 50)
    const { ctx } = setup({
      state: {
        agents: [
          agentLike("a", { description: "Reviews code." }),
          agentLike("b"),
          agentLike("c", { description: " \n\t " }),
          agentLike("d", { description: long }),
        ],
      },
    })
    const descriptions = (await read({ method: "agents" }, ctx)).agents!.map((agent) => agent.description)
    expect(descriptions.slice(0, 3)).toEqual(["Reviews code.", null, null])
    expect(Array.from(descriptions[3]!)).toHaveLength(MAX_DESCRIPTION)
    expect(descriptions[3]!.endsWith("…")).toBe(true)
  })

  test("cuts a long name", async () => {
    const { ctx } = setup({ state: { agents: [agentLike("a", { name: "n".repeat(MAX_NAME + 20) })] } })
    const [agent] = (await read({ method: "agents" }, ctx)).agents!
    expect(Array.from(agent!.name)).toHaveLength(MAX_NAME)
    expect(agent!.id).toBe("a")
  })

  test("keeps the first 100 and counts them all", async () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => agentLike(`agent-${index}`))
    const over = await read({ method: "agents" }, setup({ state: { agents: many(MAX_LISTED + 1) } }).ctx)
    expect(over.agents).toHaveLength(MAX_LISTED)
    expect(over.agents![0]!.id).toBe("agent-0")
    expect(over.agents!.at(-1)!.id).toBe(`agent-${MAX_LISTED - 1}`)
    expect(over).toMatchObject({ total: MAX_LISTED + 1, truncated: true })
    const exact = await read({ method: "agents" }, setup({ state: { agents: many(MAX_LISTED) } }).ctx)
    expect(exact).toMatchObject({ total: MAX_LISTED, truncated: false })
  })
})

describe("the directory", () => {
  test("defaults to the working directory of the call and reaches the service as the location", async () => {
    const { service, ctx } = setup()
    expect((await read({ method: "agents" }, ctx)).directory).toBe(CWD)
    expect(service.requests.at(-1)).toMatchObject({ path: "/api/agent", query: { "location[directory]": CWD } })
  })

  test("is the argument when given, normalized and without a trailing separator", async () => {
    const { service, ctx } = setup()
    const result = await read({ method: "agents", directory: "/work/other//sub/../" }, ctx)
    expect(result.directory).toBe("/work/other")
    expect(service.requests.at(-1)!.query["location[directory]"]).toBe("/work/other")
    expect((await read({ method: "agents", directory: "/" }, ctx)).directory).toBe("/")
  })

  test("must be absolute", async () => {
    const { service, runtime, ctx } = setup({ runtime: { running: false } })
    for (const directory of ["relative/dir", "./here", ""]) {
      const error = await failure(read({ method: "agents", directory }, ctx))
      expect(error.code).toBe("invalid_argument")
      expect(error.message).toBe("directory must be an absolute path.")
    }
    expect(runtime.started).toEqual([])
    expect(service.requests).toEqual([])
  })

  test("that does not exist is not_found, as the service says", async () => {
    const { ctx } = setup({ state: { missing: ["/work/gone"] } })
    const error = await failure(read({ method: "agents", directory: "/work/gone" }, ctx))
    expect(error.code).toBe("not_found")
    expect(error.message).toBe("Location not found: /work/gone")
  })
})

describe("the directory the tools are installed in", () => {
  let own: string
  let inside: string

  beforeEach(() => {
    own = mkdtempSync(join(tmpdir(), "service-own-"))
    inside = join(own, "sub")
    mkdirSync(inside)
  })
  afterEach(() => rmSync(own, { recursive: true, force: true }))

  const refusal = (directory: string) =>
    `${shown(directory, 300)} is where these tools are installed, not a project; pass directory, or make the call from the project's directory.`

  test("is refused when it, or a directory within it, is given", async () => {
    const { service, runtime, ctx } = setup({ ctx: { ownDir: own }, runtime: { running: false } })
    for (const directory of [own, inside]) {
      const error = await failure(read({ method: "agents", directory }, ctx))
      expect(error.code).toBe("invalid_argument")
      expect(error.message).toBe(refusal(directory))
    }
    expect(runtime.started).toEqual([])
    expect(service.requests).toEqual([])
  })

  test("is refused when it is the working directory of the call", async () => {
    const { service, ctx } = setup({ ctx: { ownDir: own, cwd: inside } })
    const error = await failure(read({ method: "agents" }, ctx))
    expect(error.message).toBe(refusal(inside))
    expect(service.requests).toEqual([])
  })

  test("does not stop a call from elsewhere, nor a given directory that is not within it", async () => {
    const { ctx } = setup({ ctx: { ownDir: own } })
    expect((await read({ method: "agents" }, ctx)).directory).toBe(CWD)
    expect((await read({ method: "agents", directory: tmpdir() }, ctx)).directory).toBe(tmpdir())
  })
})
