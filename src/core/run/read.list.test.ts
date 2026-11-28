import { describe, expect, test } from "bun:test"
import { MAX_LISTED, MAX_LIST_CHARS } from "../service/schemas"
import { fakeAsk, fakeChild, fakeEnd, fakeSession, type FakeService } from "../service/testing"
import { LIST_PAGE_SIZE, MAX_LIST_PAGES } from "./read.schemas"
import { DIRECTORY, boundRun, callsOf, readRun, requestsTo, runSetup } from "./read.testing"
import { failure } from "../service/read.testing"

const list = (ctx: Parameters<typeof readRun>[1], extra: Record<string, unknown> = {}) =>
  readRun({ method: "list", ...extra }, ctx)

/** A run last updated at `updated`, so that the order of a list is the test's own. */
function run(service: FakeService, id: string, updated: number, overrides: Parameters<typeof boundRun>[2] = {}) {
  const session = boundRun(service, id, overrides)
  session.time.updated = updated
  return session
}

describe("list: whose runs", () => {
  test("lists the caller's runs only: not another caller's, a person's own session, or a subagent's", async () => {
    const { service, ctx } = runSetup()
    run(service, "ses_mine", 3)
    run(service, "ses_theirs", 2, { caller: "someone-else" })
    delete run(service, "ses_person", 1).metadata
    const child = fakeChild(service, "ses_mine")
    child.time.updated = 9
    const result = await list(ctx)
    expect(result.runs!.map((entry) => entry.session)).toEqual(["ses_mine"])
    expect(result.total).toBe(1)
  })

  test("is empty, not an error, for a caller with no runs", async () => {
    const { service, ctx } = runSetup()
    run(service, "ses_theirs", 1, { caller: "someone-else" })
    expect(await list(ctx)).toEqual({ method: "list", service_started: false, runs: [], total: 0, truncated: false })
  })

  test("gives each run's session, title, role, directory, branch and state, newest update first", async () => {
    const { service, ctx } = runSetup()
    run(service, "ses_old", 1, { role: "build", branch: null })
    run(service, "ses_new", 2).title = "Review"
    const { runs } = await list(ctx)
    expect(runs).toEqual([
      { session: "ses_new", title: "Review", role: "plan", directory: DIRECTORY, branch: "main", state: "unknown" },
      { session: "ses_old", role: "build", directory: DIRECTORY, branch: null, state: "unknown" },
    ])
  })

  test("cleans and cuts a title as get does", async () => {
    const { service, ctx } = runSetup()
    run(service, "ses_a", 1).title = `a\u0000b\n${"t".repeat(300)}`
    const [entry] = (await list(ctx)).runs!
    expect(entry!.title).toStartWith("a b ttt")
    expect([...entry!.title!]).toHaveLength(100)
  })
})

describe("list: the directory", () => {
  test("keeps the runs of the exact directory, which is also what the service is asked for", async () => {
    const { service, ctx } = runSetup()
    run(service, "ses_here", 2)
    run(service, "ses_there", 1, { directory: "/work/other" })
    const result = await list(ctx, { directory: "/work/other" })
    expect(result.runs!.map((entry) => entry.session)).toEqual(["ses_there"])
    expect(requestsTo(service, "/api/session")[0]!.query.directory).toBe("/work/other")
  })

  test("lists every worktree's runs when it is left out, and does not default it", async () => {
    const { service, ctx } = runSetup()
    run(service, "ses_here", 2)
    run(service, "ses_there", 1, { directory: "/work/other" })
    expect((await list(ctx)).runs).toHaveLength(2)
    expect(requestsTo(service, "/api/session")[0]!.query).not.toHaveProperty("directory")
  })

  test("is refused before any service is contacted when it is not an absolute path", async () => {
    const { service, runtime, ctx } = runSetup({ runtime: { running: false } })
    const error = await failure(list(ctx, { directory: "work/relative" }))
    expect(error.code).toBe("invalid_argument")
    expect(service.requests).toEqual([])
    expect(runtime.started).toEqual([])
  })
})

describe("list: states", () => {
  /** Six runs: running, completed, failed, waiting, never run, and one whose own turn ended while a subagent runs. */
  function runs() {
    const setup = runSetup()
    const { service } = setup
    const busy = service.clock.now
    run(service, "ses_running", 7, { busy, active: true })
    run(service, "ses_done", 6, { busy })
    fakeEnd(service, "ses_done", "succeeded")
    run(service, "ses_failed", 5, { busy })
    fakeEnd(service, "ses_failed", "failed", { type: "provider.error", message: "x" })
    run(service, "ses_waiting", 4, { busy, active: true })
    fakeAsk(service, "ses_waiting", { action: "bash", resources: ["ls"] })
    run(service, "ses_new", 3)
    run(service, "ses_parent", 2, { busy })
    fakeEnd(service, "ses_parent", "succeeded")
    const child = fakeChild(service, "ses_parent")
    for (const [id, updated] of [
      ["ses_done", 6],
      ["ses_failed", 5],
      ["ses_parent", 2],
    ] as const) {
      fakeSession(service, id).time.updated = updated
    }
    return { ...setup, child }
  }

  test("are each run's own, read from the service", async () => {
    const { ctx } = runs()
    const states = Object.fromEntries((await list(ctx)).runs!.map((entry) => [entry.session, entry.state]))
    expect(states).toEqual({
      ses_running: "running",
      ses_done: "completed",
      ses_failed: "failed",
      ses_waiting: "waiting",
      ses_new: "unknown",
      ses_parent: "running",
    })
  })

  test("are read with one read of the active set, each session of it read once", async () => {
    const { service, ctx, child } = runs()
    service.requests.length = 0
    await list(ctx)
    expect(requestsTo(service, "/session/active")).toHaveLength(1)
    expect(requestsTo(service, `/api/session/${child.id}`)).toHaveLength(1)
    const reads = requestsTo(service, "/api/session").filter((request) => request.query.parentID === undefined)
    expect(reads).toEqual([])
  })

  test("read the pending lists only of runs that are active, and the inbox only where nothing else settles the state", async () => {
    const { service, ctx, child } = runs()
    service.requests.length = 0
    await list(ctx)
    const asked = callsOf(service).filter((call) => /\/(permission|form)$/.test(call))
    const sessions = new Set(asked.map((call) => call.split("/")[3]))
    expect(sessions).toEqual(new Set(["ses_running", "ses_waiting", "ses_parent", child.id]))
    expect(callsOf(service).filter((call) => call.endsWith("/inbox"))).toEqual(["GET /api/session/ses_new/inbox"])
  })
})

describe("list: paging and size", () => {
  function many(service: FakeService, count: number, prefix = "ses_") {
    for (let index = 0; index < count; index += 1) run(service, `${prefix}${String(index).padStart(4, "0")}`, index + 1)
  }

  test("follows the service's cursor over two pages, and says nothing of more when the list ended", async () => {
    const { service, ctx } = runSetup()
    many(service, LIST_PAGE_SIZE + 20)
    const result = await list(ctx)
    const pages = requestsTo(service, "/api/session").filter((request) => request.query.parentID === "null")
    expect(pages.map((request) => request.query.cursor)).toEqual([undefined, expect.any(String)])
    expect(pages.every((request) => request.query.limit === String(LIST_PAGE_SIZE))).toBe(true)
    expect(result.total).toBe(LIST_PAGE_SIZE + 20)
    expect(result).not.toHaveProperty("more")
    expect(result.runs![0]!.session).toBe(`ses_${String(LIST_PAGE_SIZE + 19).padStart(4, "0")}`)
  })

  test("keeps at most MAX_LISTED entries and says it left some out", async () => {
    const { service, ctx } = runSetup()
    many(service, MAX_LISTED + 20)
    const result = await list(ctx)
    expect(result.runs).toHaveLength(MAX_LISTED)
    expect(result).toMatchObject({ total: MAX_LISTED + 20, truncated: true })
  })

  test("stops after MAX_LIST_PAGES pages and says the service held more", async () => {
    const { service, ctx } = runSetup()
    many(service, MAX_LIST_PAGES * LIST_PAGE_SIZE + 10)
    const result = await list(ctx)
    const pages = requestsTo(service, "/api/session").filter((request) => request.query.parentID === "null")
    expect(pages).toHaveLength(MAX_LIST_PAGES)
    expect(result).toMatchObject({ more: true, total: MAX_LIST_PAGES * LIST_PAGE_SIZE, truncated: true })
  })

  test("is not more when the last page it may read is the last the service has", async () => {
    const { service, ctx } = runSetup()
    many(service, MAX_LIST_PAGES * LIST_PAGE_SIZE)
    expect(await list(ctx)).not.toHaveProperty("more")
  })

  test("keeps within MAX_LIST_CHARS as JSON, counting what was left out", async () => {
    const { service, ctx } = runSetup()
    for (let index = 0; index < MAX_LISTED - 5; index += 1) {
      const session = run(service, `ses_${String(index).padStart(4, "0")}`, index + 1, {
        directory: `/work/${"d".repeat(150)}`,
      })
      session.title = "t".repeat(150)
    }
    const result = await list(ctx)
    expect(result.runs!.length).toBeLessThan(MAX_LISTED - 5)
    expect(JSON.stringify(result.runs).length).toBeLessThanOrEqual(MAX_LIST_CHARS + 2)
    expect(result).toMatchObject({ total: MAX_LISTED - 5, truncated: true })
  })

  test("leaves out a run whose id is too long to be used again, and says so", async () => {
    const { service, ctx } = runSetup()
    run(service, "ses_fine", 2)
    run(service, `ses_${"x".repeat(250)}`, 1)
    const result = await list(ctx)
    expect(result.runs!.map((entry) => entry.session)).toEqual(["ses_fine"])
    expect(result).toMatchObject({ total: 2, truncated: true })
  })
})
