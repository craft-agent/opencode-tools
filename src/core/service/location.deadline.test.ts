import { describe, expect, test } from "bun:test"
import { WAIT_SECONDS_OPTION } from "../deadline"
import { ToolError } from "../errors"
import { connectService } from "./connect"
import { LOCATION_POLL_MS, LOCATION_TIMEOUT_MS, loadLocation } from "./location"
import { createFakeService, fakeRuntime } from "./testing"

const DIRECTORY = "/work/acme"
const MS_PER_SECOND = 1000

async function neverLoaded(seconds: number) {
  const runtime = fakeRuntime(createFakeService({ coldReads: Infinity }))
  const ctx = { runtime, options: { [WAIT_SECONDS_OPTION]: seconds } }
  const connection = await connectService(ctx)
  const before = runtime.now()
  const error = (await loadLocation(connection, DIRECTORY, ctx).catch((e: unknown) => e)) as ToolError
  return { error, ms: runtime.now() - before }
}

describe("loadLocation: the call's time", () => {
  test("a directory that never loads fails at the call's limit when that is under the load limit", async () => {
    const seconds = 5
    const { error, ms } = await neverLoaded(seconds)
    expect(error).toBeInstanceOf(ToolError)
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(
      `The call's time of 5 seconds ended while it waited for the OpenCode service to load "${DIRECTORY}".`,
    )
    expect(ms).toBeGreaterThanOrEqual(seconds * MS_PER_SECOND)
    expect(ms).toBeLessThan(seconds * MS_PER_SECOND + LOCATION_POLL_MS)
  })

  test("what the call used before the load comes off the load's time", async () => {
    const runtime = fakeRuntime(createFakeService({ coldReads: Infinity }))
    const ctx = { runtime, options: { [WAIT_SECONDS_OPTION]: 20 } }
    const connection = await connectService(ctx)
    runtime.clock.now += 12 * MS_PER_SECOND
    const error = (await loadLocation(connection, DIRECTORY, ctx).catch((e: unknown) => e)) as ToolError
    expect(error.message).toBe(
      `The call's time of 20 seconds ended while it waited for the OpenCode service to load "${DIRECTORY}".`,
    )
  })

  test("a limit above the load limit leaves the load message", async () => {
    const { error, ms } = await neverLoaded(LOCATION_TIMEOUT_MS / MS_PER_SECOND + 1)
    expect(error.message).toBe(
      `The OpenCode service did not finish loading "${DIRECTORY}" within 15 seconds; try again.`,
    )
    expect(ms).toBe(LOCATION_TIMEOUT_MS)
  })

  test("a directory that loads within the call's time is waited for as before", async () => {
    const runtime = fakeRuntime(createFakeService())
    const ctx = { runtime, options: { [WAIT_SECONDS_OPTION]: 5 } }
    const connection = await connectService(ctx)
    const before = runtime.now()
    await loadLocation(connection, DIRECTORY, ctx)
    expect(runtime.now() - before).toBe(2 * LOCATION_POLL_MS)
  })
})
