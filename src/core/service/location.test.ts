import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { connectService } from "./connect"
import { LOCATION_POLL_MS, LOCATION_TIMEOUT_MS, loadLocation } from "./location"
import { UNREADABLE_REPLY } from "./errors"
import { createFakeService, fakeRuntime, type FakeServiceState } from "./testing"

const DIRECTORY = "/work/acme"

async function connected(state: Partial<FakeServiceState> = {}) {
  const service = createFakeService(state)
  const runtime = fakeRuntime(service)
  const ctx = { runtime, signal: undefined as AbortSignal | undefined }
  const connection = await connectService(ctx)
  const plugins = () => service.requests.filter((request) => request.path === "/api/plugin").length
  return { service, runtime, ctx, connection, plugins }
}

describe("loadLocation", () => {
  test("waits for the cold reads of the fake's default, a poll after each, without real waiting", async () => {
    const { runtime, ctx, connection, plugins } = await connected()
    const before = runtime.now()
    await loadLocation(connection, DIRECTORY, ctx)
    expect(plugins()).toBe(3)
    expect(runtime.now() - before).toBe(2 * LOCATION_POLL_MS)
  })

  test("asks once and does not sleep for a directory that is loaded", async () => {
    const { runtime, ctx, connection, plugins } = await connected({ coldReads: 0 })
    const before = runtime.now()
    await loadLocation(connection, DIRECTORY, ctx)
    expect(plugins()).toBe(1)
    expect(runtime.now()).toBe(before)
  })

  test("asks about the directory it is given", async () => {
    const { service, ctx, connection } = await connected({ coldReads: 0 })
    await loadLocation(connection, "/work/other", ctx)
    expect(service.requests.at(-1)).toMatchObject({
      path: "/api/plugin",
      query: { "location[directory]": "/work/other" },
    })
  })

  test("fails as upstream_error once the time limit has passed on the clock, having slept between every ask", async () => {
    const { runtime, ctx, connection, plugins } = await connected({ coldReads: Infinity })
    const before = runtime.now()
    const error = (await loadLocation(connection, DIRECTORY, ctx).catch((e: unknown) => e)) as ToolError
    expect(error).toBeInstanceOf(ToolError)
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(
      `The OpenCode service did not finish loading "${DIRECTORY}" within 15 seconds; try again.`,
    )
    expect(runtime.now() - before).toBe(LOCATION_TIMEOUT_MS)
    expect(plugins()).toBe(LOCATION_TIMEOUT_MS / LOCATION_POLL_MS + 1)
  })

  test("shows the directory quoted, cut and with nothing in it that moves text", async () => {
    const { ctx, connection } = await connected({ coldReads: Infinity })
    const message = async (directory: string) =>
      ((await loadLocation(connection, directory, ctx).catch((e: unknown) => e)) as ToolError).message
    expect(await message(`/work/${"d".repeat(400)}`)).toBe(
      `The OpenCode service did not finish loading "/work/${"d".repeat(294)}" within 15 seconds; try again.`,
    )
    expect(await message("/work/a\n\u202eb")).toBe(
      'The OpenCode service did not finish loading "/work/a\\n\\u202eb" within 15 seconds; try again.',
    )
  })

  test("is ended by an abort while it waits, with the AbortError", async () => {
    const controller = new AbortController()
    const { runtime, connection } = await connected({ coldReads: Infinity })
    const sleep = runtime.sleep
    runtime.sleep = async (ms, signal) => {
      controller.abort()
      return sleep(ms, signal)
    }
    const error = (await loadLocation(connection, DIRECTORY, { runtime, signal: controller.signal }).catch(
      (e: unknown) => e,
    )) as Error
    expect(error.name).toBe("AbortError")
    expect(error).not.toBeInstanceOf(ToolError)
  })

  test("fails as not_found for a directory that is not there", async () => {
    const { ctx, connection } = await connected({ missing: [DIRECTORY] })
    const error = (await loadLocation(connection, DIRECTORY, ctx).catch((e: unknown) => e)) as ToolError
    expect(error.code).toBe("not_found")
    expect(error.message).toBe(`Location not found: ${DIRECTORY}`)
  })

  test("fails as upstream_error for a plugin list that cannot be read", async () => {
    const { service, ctx, connection } = await connected()
    for (const body of ["{}", '{"data":null}', '{"data":{}}']) {
      service.failNext("/api/plugin", new Response(body, { headers: { "content-type": "application/json" } }))
      const error = (await loadLocation(connection, DIRECTORY, ctx).catch((e: unknown) => e)) as ToolError
      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe(UNREADABLE_REPLY)
    }
  })

  test("does not go on when a plugin list stays empty, however long the service answers", async () => {
    const { ctx, connection } = await connected({ plugins: [] })
    const error = (await loadLocation(connection, DIRECTORY, ctx).catch((e: unknown) => e)) as ToolError
    expect(error.code).toBe("upstream_error")
  })
})
