import { describe, expect, test } from "bun:test"
import { BRANCH_TIMEOUT_MS, LOCATION_POLL_MS } from "./location"
import { CWD, failure, modelLike, read, repository, setup, variantsOf } from "./read.testing"
import type { FakeServiceState } from "./testing"

const JSON_HEADERS = { "content-type": "application/json" }
/** What the fake's default cold start costs on its clock: a poll after each of its two cold reads. */
const LOAD_MS = 2 * LOCATION_POLL_MS
const PLAIN = "/work/plain"

/** How much of the fake clock a call used. */
async function timed(setting: ReturnType<typeof setup>, args: Record<string, unknown>) {
  const before = setting.runtime.now()
  const result = await read(args, setting.ctx)
  return { result, ms: setting.runtime.now() - before }
}

const COLD_METHODS: Record<string, unknown>[] = [
  { method: "agents" },
  { method: "providers" },
  { method: "models", provider: "acme" },
  { method: "ready", role: "plan" },
]

describe("a directory the service has not opened", () => {
  test("is waited for by every method that names one, and the first call gets the full result", async () => {
    const agents = await timed(setup(), { method: "agents" })
    expect(agents.result.agents!.map((agent) => agent.id)).toEqual(["plan", "build", "scout"])
    expect(agents.ms).toBe(LOAD_MS)

    const providers = await timed(setup(), { method: "providers" })
    expect(providers.result.providers).toEqual([{ id: "acme", name: "Acme", models: 2 }])
    expect(providers.ms).toBe(LOAD_MS)

    const models = await timed(setup(), { method: "models", provider: "acme" })
    expect(models.result.models!.map((model) => model.id)).toEqual(["model-1", "model-2"])
    expect(models.ms).toBe(LOAD_MS)
  })

  test("is not waited for again by a second call, or when the service has loaded it already", async () => {
    const setting = setup()
    await read({ method: "agents" }, setting.ctx)
    const second = await timed(setting, { method: "agents" })
    expect(second.ms).toBe(0)
    expect((await timed(setup({ state: { coldReads: 0 } }), { method: "agents" })).ms).toBe(0)
  })

  test("is waited for by directory, so another directory waits again", async () => {
    const setting = setup()
    await read({ method: "agents" }, setting.ctx)
    expect((await timed(setting, { method: "agents", directory: "/work/other" })).ms).toBe(LOAD_MS)
  })

  test("status names none and sends no location request at all", async () => {
    const setting = setup()
    const { ms } = await timed(setting, { method: "status" })
    expect(ms).toBe(0)
    expect(setting.service.requests.map((request) => request.path)).toEqual(["/api/info"])
  })

  test.each(COLD_METHODS)("one that never loads fails %j and gives no result", async (args) => {
    const setting = setup({ state: { coldReads: Infinity } })
    const error = await failure(read(args, setting.ctx))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`The OpenCode service did not finish loading "${CWD}" within 15 seconds; try again.`)
    expect(setting.service.requests.every((request) => ["/api/info", "/api/plugin"].includes(request.path))).toBe(true)
  })
})

describe("ready on a directory the service has just opened", () => {
  const ready = (state: Partial<FakeServiceState> = {}) => setup({ state })
  const args = { method: "ready", role: "plan" }

  test("is ready on the first call for a repository, with its branch", async () => {
    const { result, ms } = await timed(ready(), args)
    expect(result.ready).toBe(true)
    expect(result.summary).toBe(`Role plan is ready in ${CWD}: agent plan, model acme/model-1, branch main.`)
    // The load, then one more look at the version control, which still showed none.
    expect(ms).toBe(LOAD_MS + LOCATION_POLL_MS)
  })

  test("is ready without a branch when the version control shows none for longer than it waits", async () => {
    const { result, ms } = await timed(ready({ vcsLagReads: Infinity }), args)
    expect(result.ready).toBe(true)
    expect(result.summary).toBe(`Role plan is ready in ${CWD}: agent plan, model acme/model-1.`)
    expect(ms).toBe(LOAD_MS + BRANCH_TIMEOUT_MS)
  })

  test("is not ready for a directory that is no repository, and does not wait for a branch", async () => {
    const setting = ready()
    const { result, ms } = await timed(setting, { ...args, directory: PLAIN })
    expect(result.ready).toBe(false)
    expect(result.findings).toEqual([{ code: "not_a_repository", message: `${PLAIN} is not in a Git repository.` }])
    expect(ms).toBe(LOAD_MS)
    expect(setting.service.requests.filter((request) => request.path === "/api/vcs")).toHaveLength(1)
  })

  test("does not wait for a branch when it is not ready for another reason either", async () => {
    const setting = setup({ roles: { r: { agent: "ghost", policy: "write" } } })
    const { result, ms } = await timed(setting, { method: "ready", role: "r" })
    expect(result.findings!.map((finding) => finding.code)).toEqual(["agent_missing"])
    expect(ms).toBe(LOAD_MS)
    expect(setting.service.requests.filter((request) => request.path === "/api/vcs")).toHaveLength(1)
  })

  test("is ready without a branch on a detached HEAD, and does not look again", async () => {
    const setting = ready({ repositories: { [CWD]: repository() } })
    const { result, ms } = await timed(setting, args)
    expect(result.summary).toBe(`Role plan is ready in ${CWD}: agent plan, model acme/model-1.`)
    // One look more, for the lag only: a provider and no branch is not waited on further.
    expect(ms).toBe(LOAD_MS + LOCATION_POLL_MS)
    const loaded = setup({ state: { vcsLagReads: 0, repositories: { [CWD]: repository() } } })
    const again = await timed(loaded, args)
    expect(again.result.ready).toBe(true)
    expect(again.ms).toBe(LOAD_MS)
    expect(loaded.service.requests.filter((request) => request.path === "/api/vcs")).toHaveLength(1)
  })

  test("takes the repository from the project, whatever vcs.get has said so far", async () => {
    const setting = ready({ vcsLagReads: Infinity })
    const found = await read({ ...args, directory: CWD }, setting.ctx)
    expect(found.findings).toEqual([])
  })

  test("takes the repository from vcs.get when the service keeps no project for the directory", async () => {
    const setting = ready({ coldReads: 0, vcsLagReads: 0 })
    setting.service.failNext("/api/project", new Response("[]", { headers: JSON_HEADERS }))
    expect((await read(args, setting.ctx)).ready).toBe(true)
    const plain = ready({ coldReads: 0, vcsLagReads: 0 })
    plain.service.failNext("/api/project", new Response("[]", { headers: JSON_HEADERS }))
    expect((await read({ ...args, directory: PLAIN }, plain.ctx)).findings!.map((finding) => finding.code)).toEqual([
      "not_a_repository",
    ])
  })

  test("trusts the project's row over vcs.get, and matches it by id, never by canonical", async () => {
    const setting = ready({ coldReads: 0, vcsLagReads: 0 })
    const rows = [
      { id: "someone-else", canonical: CWD, vcs: "git", time: {}, sandboxes: [] },
      { id: `project:${CWD}`, canonical: "/elsewhere", time: {}, sandboxes: [] },
    ]
    setting.service.failNext("/api/project", new Response(JSON.stringify(rows), { headers: JSON_HEADERS }))
    const result = await read(args, setting.ctx)
    expect(result.findings!.map((finding) => finding.code)).toEqual(["not_a_repository"])

    const other = ready({ coldReads: 0, vcsLagReads: 0, repositories: {} })
    const git = [{ id: `project:${CWD}`, canonical: "/elsewhere", vcs: "git", time: {}, sandboxes: [] }]
    other.service.failNext("/api/project", new Response(JSON.stringify(git), { headers: JSON_HEADERS }))
    expect((await read(args, other.ctx)).findings).toEqual([])
  })

  test("a reply of the location or the projects that cannot be read is upstream_error", async () => {
    for (const [path, body] of [
      ["/api/location", "{}"],
      ["/api/location", '{"project":{}}'],
      ["/api/project", "{}"],
      ["/api/project", '{"data":[]}'],
      ["/api/project", `[{"id":"project:${CWD}","vcs":1}]`],
    ] as const) {
      const setting = ready({ coldReads: 0 })
      setting.service.failNext(path, new Response(body, { headers: JSON_HEADERS }))
      const error = await failure(read(args, setting.ctx))
      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe("The OpenCode service sent a reply that could not be read.")
    }
  })

  test("resolves a model on the first call as well", async () => {
    const models = [modelLike("model-1"), modelLike("model-2", { variants: variantsOf("low", "high") })]
    const setting = setup({
      state: { models },
      roles: { r: { agent: "plan", policy: "write", model: "acme/model-2#high" } },
    })
    expect((await read({ method: "ready", role: "r" }, setting.ctx)).summary).toContain("model acme/model-2#high,")
  })
})
