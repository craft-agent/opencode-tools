import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { connectService, withService } from "./connect"
import { FAKE_ENDPOINT, createFakeService, fakeRuntime } from "./testing"

const JSON_HEADERS = { "content-type": "application/json" }

/** What a route that declares the status answers with the error's body. */
function declaredReply(body: Record<string, unknown>, status = 404): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

describe("withService: what use throws is its own", () => {
  test("a plain Error comes out as it is, not taken for the service's refusal", async () => {
    const mine = new Error("mine")
    const error = await withService({ runtime: fakeRuntime(createFakeService()) }, async () => {
      throw mine
    }).catch((e: unknown) => e)
    expect(error).toBe(mine)
    expect(error).not.toBeInstanceOf(ToolError)
  })

  test("a TypeError, a ToolError and a non-error come out as they are", async () => {
    const runtime = fakeRuntime(createFakeService())
    for (const thrown of [new TypeError("bug"), new ToolError("forbidden", "no"), "text"]) {
      const error = await withService({ runtime }, async () => {
        throw thrown
      }).catch((e: unknown) => e)
      expect(error).toBe(thrown)
    }
  })

  test("a declared error that use builds itself is not mapped either", async () => {
    const mine = Object.assign(new Error("no ses_1"), { _tag: "SessionNotFoundError", name: "SessionNotFoundError" })
    const error = await withService({ runtime: fakeRuntime(createFakeService()) }, async () => {
      throw mine
    }).catch((e: unknown) => e)
    expect(error).toBe(mine)
  })
})

describe("the client of a connection maps its own failures", () => {
  test("a missing session is not_found", async () => {
    const service = createFakeService()
    const { client } = await connectService({ runtime: fakeRuntime(service) })
    service.failNext(
      "/api/agent",
      declaredReply({ _tag: "SessionNotFoundError", sessionID: "ses_1", message: "no ses_1" }),
    )
    const error = (await client.agent.list().catch((e: unknown) => e)) as ToolError
    expect(error).toBeInstanceOf(ToolError)
    expect(error.code).toBe("not_found")
    expect(error.message).toBe("The session does not exist.")
  })

  test("the same inside withService", async () => {
    const service = createFakeService()
    const error = (await withService({ runtime: fakeRuntime(service) }, async ({ client }) => {
      service.failNext("/api/agent", declaredReply({ _tag: "SessionNotFoundError", sessionID: "s", message: "m" }))
      return client.agent.list()
    }).catch((e: unknown) => e)) as ToolError
    expect(error.code).toBe("not_found")
  })

  test("a declared status with a bare body is the service's refusal", async () => {
    const service = createFakeService()
    const { client } = await connectService({ runtime: fakeRuntime(service) })
    service.failNext("/api/agent", declaredReply({}))
    const error = (await client.agent.list().catch((e: unknown) => e)) as ToolError
    expect(error).toBeInstanceOf(ToolError)
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service refused the request.")
  })

  test("a nested method is mapped, however deep", async () => {
    const service = createFakeService()
    const { client } = await connectService({ runtime: fakeRuntime(service) })
    service.failNext("/api/model/default", new TypeError("fetch failed"))
    const shallow = (await client.model.default().catch((e: unknown) => e)) as ToolError
    expect(shallow.message).toBe("The OpenCode service could not be reached.")
    // The fake has no such route: it answers 404 with a bare body, which this route declares.
    const deep = (await client.vcs.branch.list().catch((e: unknown) => e)) as ToolError
    expect(deep).toBeInstanceOf(ToolError)
    expect(deep.message).toBe("The OpenCode service refused the request.")
  })

  test("a method called with the signal of the call already aborted yields an AbortError", async () => {
    const controller = new AbortController()
    const { client } = await connectService({ runtime: fakeRuntime(createFakeService()), signal: controller.signal })
    controller.abort()
    const error = (await client.agent.list().catch((e: unknown) => e)) as Error
    expect(error.name).toBe("AbortError")
    expect(error).not.toBeInstanceOf(ToolError)
  })

  test("a result that is not a promise is returned as it is", async () => {
    const { client } = await connectService({ runtime: fakeRuntime(createFakeService()) })
    const stream = client.experimental.session.log({ sessionID: "ses_1" })
    expect(typeof (stream as unknown as { then?: unknown }).then).toBe("undefined")
    expect(typeof stream[Symbol.asyncIterator]).toBe("function")
  })

  test("members are wrapped once", async () => {
    const { client } = await connectService({ runtime: fakeRuntime(createFakeService()) })
    expect(client.agent).toBe(client.agent)
    expect(client.agent.list).toBe(client.agent.list)
    expect(client.vcs.branch).toBe(client.vcs.branch)
  })
})

describe("the client of a connection keeps the service's address and credentials out of the text it forwards", () => {
  const authorization = `Basic ${Buffer.from("opencode:s3cretpw").toString("base64")}`

  async function connected() {
    const service = createFakeService()
    const runtime = fakeRuntime(service)
    runtime.discover = async () => ({ url: FAKE_ENDPOINT.url, headers: { authorization } })
    service.failNext("/api/info", new Response(JSON.stringify({ version: "2.4.2" }), { headers: JSON_HEADERS }))
    return { service, ...(await connectService({ runtime })) }
  }

  test("an invalid request that quotes the address, the header and the password", async () => {
    const { service, client } = await connected()
    const message = `bad ${FAKE_ENDPOINT.url} (service.test) with ${authorization} and s3cretpw`
    service.failNext("/api/agent", declaredReply({ _tag: "InvalidRequestError", message }, 400))
    const error = (await client.agent.list().catch((e: unknown) => e)) as ToolError
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      "The OpenCode service refused the request: bad [redacted] ([redacted]) with [redacted] and [redacted]",
    )
  })

  test("a message without them is untouched", async () => {
    const { service, client } = await connected()
    service.failNext("/api/agent", declaredReply({ _tag: "InvalidRequestError", message: "directory is odd" }, 400))
    const error = (await client.agent.list().catch((e: unknown) => e)) as ToolError
    expect(error.message).toBe("The OpenCode service refused the request: directory is odd")
  })
})
