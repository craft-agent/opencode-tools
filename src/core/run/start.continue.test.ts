import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { failure } from "../service/read.testing"
import { fakeSession } from "../service/testing"
import { bindingOf, withBinding } from "./binding"
import { NOTE_KEY, noteFor } from "./note"
import { cleanup, git } from "./git.testing"
import {
  callsOf,
  expectedBinding,
  expectedRuleset,
  requestsTo,
  seedRun,
  seedSession,
  startReadOnly,
  startSetup,
  startWrite,
  type StartSetup,
} from "./start.testing"

afterEach(cleanup)

const BRIEF = "Go on."
const MISSING = "The session does not exist."

describe("continuing a session", () => {
  test("sets the run's own session up again, with no creation, and sends the brief", async () => {
    const setup = await startSetup()
    await seedRun(setup, "ses_mine")
    const result = await startReadOnly({ role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx)
    expect(result).toEqual({
      session: "ses_mine",
      new: false,
      role: "plan",
      agent: "plan",
      policy: "read-only",
      model: "acme/model-1",
      directory: setup.directory,
      branch: "main",
      state: "running",
      note: "entry",
      service_started: false,
    })
    expect(callsOf(setup.service)).toEqual([
      "GET /api/info",
      "GET /api/session/ses_mine",
      "GET /api/agent",
      "GET /api/model",
      "GET /api/model/default",
      "GET /api/session/active",
      "PATCH /api/session/ses_mine",
      "GET /api/session/ses_mine",
      "GET /api/session",
      `PUT /api/experimental/session/ses_mine/instructions/entries/${NOTE_KEY}`,
      "POST /api/session/ses_mine/prompt",
    ])
    const [update] = requestsTo(setup.service, "/api/session/ses_mine").filter((request) => request.method === "PATCH")
    const { starting } = bindingOf((update!.body as { metadata: object }).metadata)!
    expect(starting?.token).toBeString()
    expect(update!.body).toMatchObject({ permissions: await expectedRuleset(setup, "read-only") })
  })

  const SEEDS: [string, (setup: StartSetup) => unknown][] = [
    ["does not exist", () => undefined],
    ["has no binding", (setup) => seedSession(setup.service, { id: "ses_x", directory: setup.directory })],
    [
      "is another caller's",
      (setup) =>
        seedRun(setup, "ses_x", "plan", {
          metadata: withBinding(undefined, expectedBinding(setup, "plan", { caller: "someone-else" })),
        }),
    ],
    ["is a subagent's", (setup) => seedRun(setup, "ses_x", "plan", { parentID: "ses_parent" })],
  ]

  test.each(SEEDS)("a session that %s fails as one that does not exist", async (_name, seed) => {
    const setup = await startSetup()
    await seed(setup)
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF, session: "ses_x" }, setup.ctx))
    expect(error.code).toBe("not_found")
    expect(error.message).toBe(MISSING)
    expect(setup.service.requests.filter((request) => request.method !== "GET")).toEqual([])
  })

  test("under another role switches the agent, replaces the ruleset and the role, and keeps other metadata", async () => {
    const setup = await startSetup()
    await seedRun(setup, "ses_mine", "plan", {
      metadata: { other: { kept: true }, ...withBinding(undefined, expectedBinding(setup)) },
    })
    const result = await startWrite({ role: "build", brief: BRIEF, session: "ses_mine" }, setup.ctx)
    expect(result).toMatchObject({ session: "ses_mine", new: false, role: "build", agent: "build", policy: "write" })

    const held = fakeSession(setup.service, "ses_mine")
    expect(held.agent).toBe("build")
    expect(held.permissions).toEqual(await expectedRuleset(setup, "write"))
    expect(held.metadata!.other).toEqual({ kept: true })
    expect(bindingOf(held.metadata)).toMatchObject({ ...expectedBinding(setup, "build"), starting: expect.anything() })
    expect(requestsTo(setup.service, "/agent").filter((request) => request.method === "POST")[0]!.body).toEqual({
      agent: "build",
    })
    expect(held.entries[NOTE_KEY]).toBe(noteFor("write", undefined, undefined))
    expect(
      setup.service.requests.filter((request) => request.method === "POST" && request.path === "/api/session"),
    ).toEqual([])
  })

  test("switches no agent and no model that is already the session's", async () => {
    const setup = await startSetup()
    await seedRun(setup, "ses_mine")
    await startReadOnly({ role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx)
    expect(requestsTo(setup.service, "/agent").filter((request) => request.method === "POST")).toEqual([])
    expect(requestsTo(setup.service, "/model").filter((request) => request.method === "POST")).toEqual([])
  })
})

describe("the model of a continued session", () => {
  const MOVED = { providerID: "acme", id: "model-2", variant: "high" }

  test("stays when the role names none, and is the one reported", async () => {
    const setup = await startSetup()
    await seedRun(setup, "ses_mine", "plan", { model: MOVED })
    const result = await startReadOnly({ role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx)
    expect(result.model).toBe("acme/model-2#high")
    expect(fakeSession(setup.service, "ses_mine").model).toEqual(MOVED)
    expect(requestsTo(setup.service, "/model").filter((request) => request.method === "POST")).toEqual([])
  })

  test("switches to the role's model when it names one that differs", async () => {
    const roles = { plan: { agent: "plan", policy: "read-only", model: "acme/model-2#low" } }
    const setup = await startSetup({ options: { roles } })
    await seedRun(setup, "ses_mine", "plan", { model: MOVED })
    const result = await startReadOnly({ role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx)
    expect(result.model).toBe("acme/model-2#low")
    const [switched] = requestsTo(setup.service, "/model").filter((request) => request.method === "POST")
    expect(switched!.body).toEqual({ model: { providerID: "acme", id: "model-2", variant: "low" } })
  })

  test("is not switched when the role names the model the session has", async () => {
    const roles = { plan: { agent: "plan", policy: "read-only", model: "acme/model-2#high" } }
    const setup = await startSetup({ options: { roles } })
    await seedRun(setup, "ses_mine", "plan", { model: MOVED })
    await startReadOnly({ role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx)
    expect(requestsTo(setup.service, "/model").filter((request) => request.method === "POST")).toEqual([])
  })
})

describe("a session that is running", () => {
  const REFUSAL = "Session ses_mine is running; a start needs it idle."

  test("is refused, and nothing is changed", async () => {
    const setup = await startSetup()
    await seedRun(setup, "ses_mine", "plan", { active: true })
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx))
    expect(error).toMatchObject({ code: "invalid_argument", message: REFUSAL, details: { reason: "running" } })
    expect(setup.service.requests.filter((request) => request.method !== "GET")).toEqual([])
  })

  test("is refused while a subagent of it, or a subagent's subagent, is running", async () => {
    const setup = await startSetup()
    await seedRun(setup, "ses_mine")
    seedSession(setup.service, { id: "ses_child", directory: setup.directory, parentID: "ses_mine" })
    seedSession(setup.service, {
      id: "ses_grandchild",
      directory: setup.directory,
      parentID: "ses_child",
      active: true,
    })
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx))
    expect(error).toMatchObject({ message: REFUSAL, details: { reason: "running" } })
    setup.service.state.active = ["ses_child"]
    expect(
      (await failure(startWrite({ role: "build", brief: BRIEF, session: "ses_mine" }, setup.ctx))).details,
    ).toEqual({ reason: "running" })
  })

  test("is not refused for another session, but a write start is refused while it runs in the worktree", async () => {
    const setup = await startSetup()
    await seedRun(setup, "ses_mine")
    seedSession(setup.service, { id: "ses_other", directory: setup.directory, active: true })
    expect((await startReadOnly({ role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx)).state).toBe("running")
    setup.service.state.active = ["ses_other"]
    const error = await failure(startWrite({ role: "build", brief: BRIEF, session: "ses_mine" }, setup.ctx))
    expect(error.details).toEqual({ reason: "worktree_busy" })
  })
})

describe("a session that has left its worktree", () => {
  const stale = (what: string) =>
    `Session ses_mine has left the worktree it was bound to (${what}); start a new session.`

  async function expectStale(setup: StartSetup, what: string) {
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx))
    expect(error.code).toBe("stale")
    expect(error.message).toBe(stale(what))
    expect(setup.service.requests.filter((request) => request.method !== "GET")).toEqual([])
  }

  test("is stale when its branch changed", async () => {
    const setup = await startSetup()
    await seedRun(setup, "ses_mine")
    git(setup.directory, "checkout", "-b", "side")
    await expectStale(setup, 'branch was "main", is "side"')
  })

  test("is stale when its HEAD is detached now", async () => {
    const setup = await startSetup()
    await seedRun(setup, "ses_mine")
    git(setup.directory, "checkout", "--detach")
    await expectStale(setup, 'branch was "main", is none')
  })

  test("is stale when the repository of its binding differs", async () => {
    const setup = await startSetup()
    const binding = expectedBinding(setup, "plan", { repository: "/other/.git" })
    await seedRun(setup, "ses_mine", "plan", { metadata: withBinding(undefined, binding) })
    await expectStale(setup, `repository was "/other/.git", is "${join(setup.directory, ".git")}"`)
  })

  test("is stale when its directory is a subdirectory, is gone, or is no worktree", async () => {
    const setup = await startSetup()
    const sub = join(setup.directory, "sub")
    await mkdir(sub)
    for (const directory of [sub, join(setup.directory, "gone"), dirname(setup.directory)]) {
      setup.service.state.sessions.length = 0
      await seedRun(setup, "ses_mine", "plan", { directory })
      await expectStale(setup, "its directory is no longer the top level of a worktree")
    }
  })

  test("is refused to a write start in a protected directory", async () => {
    const setup = await startSetup()
    setup.ctx.options = { protected_dirs: [dirname(setup.directory)] }
    await seedRun(setup, "ses_mine", "build")
    const error = await failure(startWrite({ role: "build", brief: BRIEF, session: "ses_mine" }, setup.ctx))
    expect(error.code).toBe("forbidden")
    expect(setup.service.requests.filter((request) => request.method !== "GET")).toEqual([])
  })
})
