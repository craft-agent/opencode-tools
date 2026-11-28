import { describe, expect, test } from "bun:test"
import { WAIT_SECONDS_OPTION } from "../deadline"
import { START_POLL_MS } from "./connect"
import { LOCATION_POLL_MS } from "./location"
import { CWD, read, setup } from "./read.testing"
import type { ServiceReadOutput } from "./schemas"
import type { FakeRuntimeOptions, FakeServiceState } from "./testing"

const MS_PER_SECOND = 1000
const WAIT_SECONDS = 5
const READY = { method: "ready", role: "plan" }

/** A call of `ready` under a `wait_seconds` of `WAIT_SECONDS`, and how much of the fake clock it used. */
async function calledWith(runtime: FakeRuntimeOptions, state: Partial<FakeServiceState> = {}) {
  const setting = setup({ state, runtime, ctx: { options: { [WAIT_SECONDS_OPTION]: WAIT_SECONDS } } })
  const before = setting.runtime.now()
  const outcome: { result?: ServiceReadOutput; error?: unknown } = await read(READY, setting.ctx).then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  )
  return { ...outcome, ms: setting.runtime.now() - before, setting }
}

describe("opencode_service_read: the call's time", () => {
  test("a service that registers too late ends the call at wait_seconds", async () => {
    const { error, ms, setting } = await calledWith({ running: false, startsAfterPolls: 1000 })
    expect((error as Error).message).toBe(
      "The call's time of 5 seconds ended while it waited for the OpenCode service to start.",
    )
    expect(ms).toBeLessThan(WAIT_SECONDS * MS_PER_SECOND + START_POLL_MS)
    expect(setting.runtime.started).toHaveLength(1)
  })

  test("a directory that loads too late, after a late start, ends the call at wait_seconds", async () => {
    const { error, ms } = await calledWith({ running: false, startsAfterPolls: 8 }, { coldReads: Infinity })
    expect((error as Error).message).toBe(
      `The call's time of 5 seconds ended while it waited for the OpenCode service to load "${CWD}".`,
    )
    expect(ms).toBeGreaterThanOrEqual(WAIT_SECONDS * MS_PER_SECOND)
    expect(ms).toBeLessThan(WAIT_SECONDS * MS_PER_SECOND + LOCATION_POLL_MS)
  })

  test("a late service and a cold directory that fit the time give the result", async () => {
    const { result, ms } = await calledWith({ running: false, startsAfterPolls: 4 })
    expect(result?.ready).toBe(true)
    expect(result?.service_started).toBe(true)
    expect(ms).toBeLessThan(WAIT_SECONDS * MS_PER_SECOND)
  })

  test("the wait for the branch is cut to what the call has left, and the branch is left out", async () => {
    const polls = 17
    const { result, ms } = await calledWith({ running: false, startsAfterPolls: polls }, { vcsLagReads: Infinity })
    expect(result?.ready).toBe(true)
    expect(result?.summary).not.toContain("branch")
    expect(ms).toBeLessThanOrEqual(WAIT_SECONDS * MS_PER_SECOND + LOCATION_POLL_MS)
  })
})
