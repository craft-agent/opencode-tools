import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { connectService, withService } from "./connect"
import { createFakeService, fakeRuntime, type FakeRuntime, type FakeService } from "./testing"

const JSON_HEADERS = { "content-type": "application/json" }

async function rejection(pending: Promise<unknown>): Promise<unknown> {
  return pending.then(
    () => {
      throw new Error("The call did not reject")
    },
    (error: unknown) => error,
  )
}

function failingInfo(outcome: Parameters<FakeService["failNext"]>[1]): FakeRuntime {
  const service = createFakeService()
  service.failNext("/api/info", outcome)
  return fakeRuntime(service)
}

describe("connectService: when the info request fails", () => {
  test("a refused connection", async () => {
    const error = (await rejection(
      connectService({ runtime: failingInfo(new TypeError("fetch failed")) }),
    )) as ToolError
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service could not be reached.")
  })

  test("a service that is starting or stopping", async () => {
    const runtime = failingInfo(new Response("{}", { status: 503, headers: JSON_HEADERS }))
    const error = (await rejection(connectService({ runtime }))) as ToolError
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service is starting or stopping; try again in a moment.")
  })

  test("a reply that is not JSON", async () => {
    const runtime = failingInfo(new Response("{", { status: 200, headers: JSON_HEADERS }))
    const error = (await rejection(connectService({ runtime }))) as ToolError
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service sent a reply that could not be read.")
  })

  test("a refusal of the credentials", async () => {
    const body = JSON.stringify({ _tag: "UnauthorizedError", message: "Basic nope" })
    const error = (await rejection(
      connectService({ runtime: failingInfo(new Response(body, { status: 401, headers: JSON_HEADERS })) }),
    )) as ToolError
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service refused the tools' credentials.")
  })
})

describe("connectService: the time limit and the signal", () => {
  test("a request that never answers fails with the did-not-answer message", async () => {
    const service = createFakeService()
    service.failNext("/api/info", () => new Promise<Response>(() => {}))
    const before = Date.now()
    const error = (await rejection(
      connectService({ runtime: fakeRuntime(service) }, { requestTimeoutMs: 20 }),
    )) as ToolError
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service did not answer within 0.02 seconds.")
    expect(Date.now() - before).toBeLessThan(2000)
  })

  test("the limit applies to the requests made through the client too", async () => {
    const service = createFakeService()
    const connection = await connectService({ runtime: fakeRuntime(service) }, { requestTimeoutMs: 20 })
    service.failNext("/api/agent", () => new Promise<Response>(() => {}))
    const error = (await rejection(connection.client.agent.list())) as ToolError
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service did not answer within 0.02 seconds.")
  })

  test("an abort while the info request is pending rejects with an AbortError", async () => {
    const service = createFakeService()
    service.failNext("/api/info", () => new Promise<Response>(() => {}))
    const controller = new AbortController()
    const pending = connectService({ runtime: fakeRuntime(service), signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    const error = (await rejection(pending)) as Error
    expect(error.name).toBe("AbortError")
    expect(error).not.toBeInstanceOf(ToolError)
  })
})

describe("withService", () => {
  test("passes the result of use through, with the connection", async () => {
    const service = createFakeService()
    const result = await withService({ runtime: fakeRuntime(service) }, async ({ client, started, version }) => ({
      started,
      version,
      agents: (await client.agent.list()).data.length,
    }))
    expect(result).toEqual({ started: false, version: "2.4.2", agents: 3 })
  })

  test("maps a failure of the client", async () => {
    const service = createFakeService()
    const error = (await rejection(
      withService({ runtime: fakeRuntime(service) }, async ({ client }) => {
        service.failNext("/api/agent", new TypeError("fetch failed"))
        return client.agent.list()
      }),
    )) as ToolError
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service could not be reached.")
  })

  test("maps a declared 404 with an untagged body, as a route this service version lacks answers", async () => {
    const service = createFakeService()
    const error = (await rejection(
      withService({ runtime: fakeRuntime(service) }, async ({ client }) => {
        service.failNext("/api/agent", new Response("{}", { status: 404, headers: JSON_HEADERS }))
        return client.agent.list()
      }),
    )) as ToolError
    expect(error).toBeInstanceOf(ToolError)
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service refused the request.")
  })

  test("leaves an error it does not know as it is", async () => {
    const bug = new TypeError("bug")
    const error = await rejection(
      withService({ runtime: fakeRuntime(createFakeService()) }, async () => {
        throw bug
      }),
    )
    expect(error).toBe(bug)
  })

  test("fails with what the connection fails with, without calling use", async () => {
    let called = false
    const error = (await rejection(
      withService({ runtime: failingInfo(new TypeError("fetch failed")) }, async () => {
        called = true
      }),
    )) as ToolError
    expect(error.code).toBe("upstream_error")
    expect(called).toBe(false)
  })
})

describe("what no failure says", () => {
  test("neither the address nor a credential", async () => {
    const startError = Object.assign(new Error("spawn http://service.test Basic fake"), { code: "EACCES" })
    const cases: (() => Promise<unknown>)[] = [
      () => connectService({ runtime: failingInfo(new TypeError("fetch failed http://service.test Basic fake")) }),
      () => connectService({ runtime: failingInfo(new Response("{}", { status: 500, headers: JSON_HEADERS })) }),
      () => connectService({ runtime: failingInfo(new Response("{", { status: 200, headers: JSON_HEADERS })) }),
      () => connectService({ runtime: fakeRuntime(createFakeService(), { running: false, startError }) }),
      () =>
        connectService({ runtime: fakeRuntime(createFakeService(), { running: false, startsAfterPolls: Infinity }) }),
      () => connectService({ runtime: failingInfo(() => new Promise<Response>(() => {})) }, { requestTimeoutMs: 10 }),
      () => {
        const service = createFakeService()
        const body = JSON.stringify({ _tag: "ConflictError", message: "busy" })
        service.failNext("/api/agent", new Response(body, { status: 404, headers: JSON_HEADERS }))
        return withService({ runtime: fakeRuntime(service) }, ({ client }) => client.agent.list())
      },
    ]
    for (const run of cases) {
      const error = (await rejection(run())) as ToolError
      expect(error.message).not.toContain("service.test")
      expect(error.message).not.toContain("Basic")
      expect(error.cause).toBeUndefined()
    }
  })
})
