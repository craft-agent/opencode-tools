import { afterEach, describe, expect, test } from "bun:test"
import { symlink } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { ErrorCode } from "../errors"
import { failure } from "../service/read.testing"
import { cleanup, tempDir } from "./git.testing"
import {
  agentNamed,
  requestsTo,
  seedSession,
  startReadOnly,
  startSetup,
  startWrite,
  type StartSetup,
} from "./start.testing"

afterEach(cleanup)

const BRIEF = "Do the work."

describe("a call that cannot run", () => {
  async function expectRefusedBeforeAnyService(
    call: (setup: StartSetup) => Promise<unknown>,
    code: ErrorCode,
    message: string,
  ) {
    const setup = await startSetup({ runtime: { running: false } })
    const error = await failure(call(setup))
    expect(error.code).toBe(code)
    expect(error.message).toBe(message)
    expect(setup.runtime.started).toEqual([])
    expect(setup.service.requests).toEqual([])
  }

  test("is refused when the read-only tool is given a write role", async () => {
    await expectRefusedBeforeAnyService(
      (setup) => startReadOnly({ role: "build", brief: BRIEF }, setup.ctx),
      "invalid_argument",
      'Role "build" has the policy write; start it with opencode_run_start_write.',
    )
  })

  test("is refused when the write tool is given a read-only role", async () => {
    await expectRefusedBeforeAnyService(
      (setup) => startWrite({ role: "plan", brief: BRIEF }, setup.ctx),
      "invalid_argument",
      'Role "plan" has the policy read-only; start it with opencode_run_start.',
    )
  })

  test("is refused for a role that is not configured, naming the roles", async () => {
    await expectRefusedBeforeAnyService(
      (setup) => startReadOnly({ role: "ghost", brief: BRIEF }, setup.ctx),
      "invalid_argument",
      'No role "ghost" is configured; the roles are: plan, build.',
    )
  })

  test("is refused for a blank brief", async () => {
    await expectRefusedBeforeAnyService(
      (setup) => startReadOnly({ role: "plan", brief: " \n\t " }, setup.ctx),
      "invalid_argument",
      "brief must not be blank.",
    )
  })

  test("is refused for a directory and a session together", async () => {
    await expectRefusedBeforeAnyService(
      (setup) => startReadOnly({ role: "plan", brief: BRIEF, directory: setup.directory, session: "ses_1" }, setup.ctx),
      "invalid_argument",
      "Give directory for a new session, or session to continue one, not both.",
    )
  })

  test("is refused for a directory that is not a Git worktree, before any service", async () => {
    const setup = await startSetup({ runtime: { running: false } })
    const error = await failure(
      startReadOnly({ role: "plan", brief: BRIEF, directory: dirname(setup.directory) }, setup.ctx),
    )
    expect(error.code).toBe("invalid_argument")
    expect(setup.service.requests).toEqual([])
  })

  test("is refused for a write run in a protected directory, before any service", async () => {
    const setup = await startSetup({ runtime: { running: false } })
    setup.ctx.options = { protected_dirs: [dirname(setup.directory)] }
    const error = await failure(startWrite({ role: "build", brief: BRIEF }, setup.ctx))
    expect(error.code).toBe("forbidden")
    expect(setup.service.requests).toEqual([])
  })

  test("is refused for a brief over the limit, and a role over its length", async () => {
    const setup = await startSetup()
    expect((await failure(startReadOnly({ role: "plan", brief: "x".repeat(100_001) }, setup.ctx))).code).toBe(
      "invalid_argument",
    )
    expect((await failure(startReadOnly({ role: "p".repeat(65), brief: BRIEF }, setup.ctx))).code).toBe(
      "invalid_argument",
    )
    expect(setup.service.requests).toEqual([])
  })
})

describe("a role with a finding", () => {
  test("whose agent the directory lacks creates no session", async () => {
    const setup = await startSetup({ options: { roles: { ghost: { agent: "ghost", policy: "read-only" } } } })
    const error = await failure(startReadOnly({ role: "ghost", brief: BRIEF }, setup.ctx))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('Role ghost\'s agent "ghost" is not an agent of this directory')
    expect(error.details).toEqual({ findings: ["agent_missing"] })
    expect(setup.service.state.sessions).toEqual([])
    expect(requestsTo(setup.service, "/prompt")).toEqual([])
  })

  test("whose model the service lacks, joined with the agent's finding by a space", async () => {
    const setup = await startSetup({
      state: { agents: [agentNamed("scout", "subagent")] },
      options: { roles: { odd: { agent: "scout", policy: "read-only", model: "acme/nope" } } },
    })
    const error = await failure(startReadOnly({ role: "odd", brief: BRIEF }, setup.ctx))
    expect(error.details).toEqual({ findings: ["agent_not_primary", "model_unavailable"] })
    expect(error.message).toMatch(/a run needs one\. Role odd's model acme\/nope is not a model/)
    expect(setup.service.requests.filter((request) => request.method === "POST")).toEqual([])
  })
})

describe("the call's time", () => {
  test("ends while a service that is slow to start registers, before any session exists", async () => {
    const setup = await startSetup({
      runtime: { running: false, startsAfterPolls: Number.POSITIVE_INFINITY },
      options: { wait_seconds: 1 },
    })
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain(
      "The call's time of 1 second ended while it waited for the OpenCode service to start",
    )
    expect(setup.runtime.started).toHaveLength(1)
    expect(setup.service.state.sessions).toEqual([])
    expect(setup.service.requests).toEqual([])
  })
})

describe("a write run's worktree", () => {
  test("is refused while another session is running in it, whoever's it is", async () => {
    const setup = await startSetup()
    seedSession(setup.service, { id: "ses_other", directory: setup.directory, active: true })
    const error = await failure(startWrite({ role: "build", brief: BRIEF }, setup.ctx))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `Another session is running in "${setup.directory}"; a write run starts when it has finished.`,
    )
    expect(error.details).toEqual({ reason: "worktree_busy" })
    expect(setup.service.state.sessions).toHaveLength(1)
  })

  test("is not refused for a session that runs elsewhere, or one that is idle here", async () => {
    const setup = await startSetup()
    seedSession(setup.service, { id: "ses_far", directory: "/work/elsewhere", active: true })
    seedSession(setup.service, { id: "ses_idle", directory: setup.directory })
    expect((await startWrite({ role: "build", brief: BRIEF }, setup.ctx)).state).toBe("running")
  })

  test("is compared by real path, so a link to the worktree is the worktree", async () => {
    const setup = await startSetup()
    const link = join(await tempDir(), "link")
    await symlink(setup.directory, link)
    seedSession(setup.service, { id: "ses_linked", directory: link, active: true })
    expect((await failure(startWrite({ role: "build", brief: BRIEF }, setup.ctx))).details).toEqual({
      reason: "worktree_busy",
    })
  })

  test("is no concern of a read-only run, which may share it", async () => {
    const setup = await startSetup()
    seedSession(setup.service, { id: "ses_other", directory: setup.directory, active: true })
    expect((await startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx)).state).toBe("running")
    expect(setup.service.requests.filter((request) => request.path === "/api/session/active")).toEqual([])
  })
})
