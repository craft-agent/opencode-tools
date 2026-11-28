import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { SERVICE_COMMAND, START_POLL_MS, START_TIMEOUT_MS, connectService } from "./connect"
import { SERVICE_ENV } from "./env"
import { MIN_SERVICE_VERSION } from "./version"
import { createFakeService, fakeRuntime } from "./testing"

async function rejection(pending: Promise<unknown>): Promise<unknown> {
  return pending.then(
    () => {
      throw new Error("The call did not reject")
    },
    (error: unknown) => error,
  )
}

function serviceWithVersion(version: string) {
  const service = createFakeService()
  service.state.info = { ...service.state.info, version }
  return service
}

describe("connectService: a running service", () => {
  test("is used as it is, without starting anything", async () => {
    const service = createFakeService()
    const runtime = fakeRuntime(service)
    const connection = await connectService({ runtime })
    expect(connection.started).toBe(false)
    expect(connection.version).toBe(MIN_SERVICE_VERSION)
    expect(runtime.started).toEqual([])
    expect(service.requests).toEqual([{ method: "GET", path: "/api/info", query: {}, authorized: true }])
  })

  test("hands out the client, the version, whether it was started and the call's time, and nothing else", async () => {
    const service = createFakeService()
    const connection = await connectService({ runtime: fakeRuntime(service) })
    expect(Object.keys(connection).sort()).toEqual(["client", "deadline", "started", "tmp", "version"])
    expect((await connection.client.agent.list()).data).toHaveLength(3)
    expect(service.requests.at(-1)?.authorized).toBe(true)
  })
})

describe("connectService: a missing service", () => {
  test("is started with the named variables only, then found", async () => {
    const polls = 3
    const named = Object.fromEntries(SERVICE_ENV.map((name) => [name, `${name}-value`]))
    const service = createFakeService()
    const runtime = fakeRuntime(service, {
      running: false,
      startsAfterPolls: polls - 1,
      env: {
        ...named,
        OPENCODE_TOOLS_GRANT_KEY: "grant",
        HARNESS_HOME: "/harness",
        ACME_API_KEY: "secret",
        HARNESS_SESSION: "1",
      },
    })
    const before = runtime.now()
    const connection = await connectService({ runtime })
    expect(connection.started).toBe(true)
    expect(connection.version).toBe(MIN_SERVICE_VERSION)
    expect(runtime.started).toEqual([{ argv: [...SERVICE_COMMAND], env: named }])
    expect(runtime.started[0]!.argv).toEqual(["opencode", "serve", "--service"])
    expect(runtime.now() - before).toBe(polls * START_POLL_MS)
    expect(service.requests).toHaveLength(1)
  })

  test("is started without variables that are unset or empty", async () => {
    const runtime = fakeRuntime(createFakeService(), {
      running: false,
      env: { PATH: "/bin", HOME: "", TERM: undefined },
    })
    await connectService({ runtime })
    expect(runtime.started[0]!.env).toEqual({ PATH: "/bin" })
  })

  test("that never comes up fails as upstream_error once the time is out", async () => {
    const runtime = fakeRuntime(createFakeService(), { running: false, startsAfterPolls: Infinity })
    const before = runtime.now()
    const error = (await rejection(connectService({ runtime }))) as ToolError
    expect(error).toBeInstanceOf(ToolError)
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service did not start within 30 seconds.")
    expect(runtime.started).toHaveLength(1)
    expect(runtime.now() - before).toBeGreaterThanOrEqual(START_TIMEOUT_MS)
    expect(runtime.now() - before).toBeLessThan(START_TIMEOUT_MS + START_POLL_MS)
  })

  test("that cannot be started because opencode is not installed says so", async () => {
    const startError = Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" })
    const runtime = fakeRuntime(createFakeService(), { running: false, startError })
    const error = (await rejection(connectService({ runtime }))) as ToolError
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe('OpenCode is not installed, or "opencode" is not on PATH.')
    expect(error.cause).toBeUndefined()
  })

  test("that cannot be started for another reason says only that", async () => {
    const startError = Object.assign(new Error("spawn opencode EACCES /secret/path"), { code: "EACCES" })
    const runtime = fakeRuntime(createFakeService(), { running: false, startError })
    const error = (await rejection(connectService({ runtime }))) as ToolError
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service could not be started.")
  })
})

describe("connectService: cancellation", () => {
  test("an aborted signal rejects with an AbortError and touches nothing", async () => {
    const service = createFakeService()
    const runtime = fakeRuntime(service, { running: false })
    const error = (await rejection(connectService({ runtime, signal: AbortSignal.abort() }))) as Error
    expect(error.name).toBe("AbortError")
    expect(error).not.toBeInstanceOf(ToolError)
    expect(runtime.started).toEqual([])
    expect(service.requests).toEqual([])
  })

  test("an abort while waiting for the start rejects with an AbortError", async () => {
    const controller = new AbortController()
    const runtime = fakeRuntime(createFakeService(), { running: false, startsAfterPolls: Infinity })
    const start = runtime.start
    runtime.start = async (argv, options) => {
      const result = await start(argv, options)
      controller.abort()
      return result
    }
    const error = (await rejection(connectService({ runtime, signal: controller.signal }))) as Error
    expect(error.name).toBe("AbortError")
    expect(error).not.toBeInstanceOf(ToolError)
  })

  test("an abort while the program is being started rejects with an AbortError, not the start's failure", async () => {
    const controller = new AbortController()
    const runtime = fakeRuntime(createFakeService(), { running: false })
    runtime.start = async () => {
      controller.abort()
      throw new Error("killed")
    }
    const error = (await rejection(connectService({ runtime, signal: controller.signal }))) as Error
    expect(error.name).toBe("AbortError")
  })
})

describe("connectService: the version", () => {
  test("below the minimum is refused, naming both versions", async () => {
    const runtime = fakeRuntime(serviceWithVersion("2.4.1"))
    const error = (await rejection(connectService({ runtime }))) as ToolError
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("OpenCode 2.4.1 is running; these tools need 2.4.2 or later.")
  })

  test.each(["2.4.2", "2.10.0", "2.4.2-beta.1", "0.0.0-dev-202611", "dev"])("%s is accepted", async (version) => {
    const connection = await connectService({ runtime: fakeRuntime(serviceWithVersion(version)) })
    expect(connection.version).toBe(version)
  })
})
