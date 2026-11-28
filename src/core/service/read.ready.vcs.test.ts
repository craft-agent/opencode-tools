import { describe, expect, test } from "bun:test"
import type { AgentInfo } from "@opencode/client"
import { BRANCH_TIMEOUT_MS, LOCATION_POLL_MS } from "./location"
import { CWD, agentLike, failure, read, setup, type ReadSetup } from "./read.testing"
import type { FakeServiceState } from "./testing"

const JSON_HEADERS = { "content-type": "application/json" }
const LOAD_MS = 2 * LOCATION_POLL_MS
const PLAIN = "/work/plain"
const args = { method: "ready", role: "plan" }

function noProjectRow(setting: ReadSetup): void {
  setting.service.failNext("/api/project", new Response("[]", { headers: JSON_HEADERS }))
}

const vcsRequests = (setting: ReadSetup) => setting.service.requests.filter((request) => request.path === "/api/vcs")

async function timed(setting: ReadSetup, extra: Record<string, unknown> = {}) {
  const before = setting.runtime.now()
  const result = await read({ ...args, ...extra }, setting.ctx)
  return { result, ms: setting.runtime.now() - before }
}

describe("ready: an agent that cannot hold a run", () => {
  const roleOf = (mode: string, state: Partial<FakeServiceState> = {}) =>
    setup({
      state: { agents: [agentLike("x", { mode: mode as AgentInfo["mode"] })], ...state },
      roles: { r: { agent: "x", policy: "write" } },
    })

  test.each(["subagent", "future", ""])("a mode of %j is agent_not_primary, with one message for all", async (mode) => {
    const result = await read({ method: "ready", role: "r" }, roleOf(mode).ctx)
    expect(result.ready).toBe(false)
    expect(result.findings).toEqual([
      {
        code: "agent_not_primary",
        message: `Role r's agent "x" is not a primary agent (its mode is ${JSON.stringify(mode)}); a run needs one.`,
      },
    ])
  })

  test.each(["primary", "all"])("a mode of %j can hold a run", async (mode) => {
    expect((await read({ method: "ready", role: "r" }, roleOf(mode).ctx)).ready).toBe(true)
  })

  test("shows a mode cut and quoted, so nothing in it moves text", async () => {
    const result = await read({ method: "ready", role: "r" }, roleOf(`a\n\u202e${"m".repeat(100)}`).ctx)
    const [finding] = result.findings!
    expect(finding!.message).toBe(
      `Role r's agent "x" is not a primary agent (its mode is "a\\n\\u202e${"m".repeat(37)}"); a run needs one.`,
    )
  })
})

describe("ready: a directory the service keeps no project for", () => {
  test("is a repository once vcs.get has settled, and the branch is read from that same look", async () => {
    const setting = setup()
    noProjectRow(setting)
    const { result, ms } = await timed(setting)
    expect(result.ready).toBe(true)
    expect(result.summary).toBe(`Role plan is ready in ${CWD}: agent plan, model acme/model-1, branch main.`)
    expect(ms).toBe(LOAD_MS + LOCATION_POLL_MS)
    // The first look, which lagged, and one more: the settled state is waited for once.
    expect(vcsRequests(setting)).toHaveLength(2)
  })

  test("is no repository after exactly the time vcs.get is given to settle, when it never shows one", async () => {
    const setting = setup()
    noProjectRow(setting)
    const { result, ms } = await timed(setting, { directory: PLAIN })
    expect(result.findings).toEqual([{ code: "not_a_repository", message: `${PLAIN} is not in a Git repository.` }])
    expect(ms).toBe(LOAD_MS + BRANCH_TIMEOUT_MS)
    expect(vcsRequests(setting)).toHaveLength(1 + BRANCH_TIMEOUT_MS / LOCATION_POLL_MS)
  })

  test("is no repository for a repository too when vcs.get shows no provider within the time", async () => {
    const setting = setup({ state: { vcsLagReads: Infinity } })
    noProjectRow(setting)
    const { result, ms } = await timed(setting)
    expect(result.ready).toBe(false)
    expect(result.findings!.map((finding) => finding.code)).toEqual(["not_a_repository"])
    expect(ms).toBe(LOAD_MS + BRANCH_TIMEOUT_MS)
  })
})

describe("ready: a look at vcs.get that fails", () => {
  const lagging = () => new Response('{"data":{"branch":{}}}', { headers: JSON_HEADERS })
  const failing = () => new Response("{}", { status: 500, headers: JSON_HEADERS })

  test("does not fail the check: the repository is ready, without a branch", async () => {
    const setting = setup({ state: { coldReads: 0 } })
    setting.service.failNext("/api/vcs", lagging())
    setting.service.failNext("/api/vcs", failing())
    const result = await read(args, setting.ctx)
    expect(result.ready).toBe(true)
    expect(result.summary).toBe(`Role plan is ready in ${CWD}: agent plan, model acme/model-1.`)
    expect(vcsRequests(setting)).toHaveLength(2)
  })

  test("with no project row, keeps what was read last: not a repository", async () => {
    const setting = setup({ state: { coldReads: 0 } })
    noProjectRow(setting)
    setting.service.failNext("/api/vcs", lagging())
    setting.service.failNext("/api/vcs", failing())
    const result = await read(args, setting.ctx)
    expect(result.findings!.map((finding) => finding.code)).toEqual(["not_a_repository"])
    expect(vcsRequests(setting)).toHaveLength(2)
  })

  test("a reply that cannot be read on a retry is a failed look too", async () => {
    const setting = setup({ state: { coldReads: 0 } })
    setting.service.failNext("/api/vcs", lagging())
    setting.service.failNext("/api/vcs", new Response("{", { headers: JSON_HEADERS }))
    expect((await read(args, setting.ctx)).ready).toBe(true)
  })

  test("is not the call's abort, which still ends the call with its AbortError", async () => {
    const controller = new AbortController()
    const setting = setup({ state: { coldReads: 0 }, ctx: { signal: controller.signal } })
    const sleep = setting.runtime.sleep
    setting.runtime.sleep = async (ms, signal) => {
      controller.abort()
      return sleep(ms, signal)
    }
    const error = (await read(args, setting.ctx).catch((e: unknown) => e)) as Error
    expect(error.name).toBe("AbortError")
  })

  test("a first look that fails is still the call's failure", async () => {
    const setting = setup({ state: { coldReads: 0 } })
    setting.service.failNext("/api/vcs", failing())
    expect((await failure(read(args, setting.ctx))).code).toBe("upstream_error")
  })
})
