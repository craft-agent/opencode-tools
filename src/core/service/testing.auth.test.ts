import { describe, expect, test } from "bun:test"
import { ClientError, OpenCode, isUnauthorizedError, type OpenCodeClient } from "@opencode/client"
import { ToolError } from "../errors"
import { connectService, withService } from "./connect"
import { FAKE_ENDPOINT, createFakeService, fakeRuntime } from "./testing"

const KNOWN_ROUTES: [string, (client: OpenCodeClient) => Promise<unknown>][] = [
  ["/api/info", (client) => client.server.info()],
  ["/api/agent", (client) => client.agent.list()],
  ["/api/model", (client) => client.model.list()],
  ["/api/model/default", (client) => client.model.default()],
  ["/api/provider", (client) => client.provider.list()],
  ["/api/vcs", (client) => client.vcs.get()],
  ["/api/vcs/status", (client) => client.vcs.status()],
]

describe("the fake service without credentials", () => {
  test.each(KNOWN_ROUTES)("%s answers with the declared unauthorized error", async (path, call) => {
    const service = createFakeService()
    const client = OpenCode.make({ baseUrl: FAKE_ENDPOINT.url, fetch: service.fetch })
    const error = await call(client).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(isUnauthorizedError(error)).toBe(true)
    expect(service.requests).toEqual([{ method: "GET", path, query: {}, authorized: false }])
  })

  test("a wrong authorization header is refused too", async () => {
    const service = createFakeService()
    const client = OpenCode.make({
      baseUrl: FAKE_ENDPOINT.url,
      headers: { authorization: "Basic other" },
      fetch: service.fetch,
    })
    expect(isUnauthorizedError(await client.server.info().catch((e: unknown) => e))).toBe(true)
  })

  test("an unknown path is still not found", async () => {
    const client = OpenCode.make({ baseUrl: FAKE_ENDPOINT.url, fetch: createFakeService().fetch })
    const error = (await client.server.pair().catch((e: unknown) => e)) as ClientError
    expect(error).toBeInstanceOf(ClientError)
    expect(error.cause).toEqual({ status: 404 })
  })

  test("a runtime whose endpoint lacks the headers fails the connection as a refusal of the credentials", async () => {
    const runtime = fakeRuntime(createFakeService())
    runtime.discover = async () => ({ url: FAKE_ENDPOINT.url })
    for (const run of [() => connectService({ runtime }), () => withService({ runtime }, async () => "unreachable")]) {
      const error = (await run().catch((e: unknown) => e)) as ToolError
      expect(error).toBeInstanceOf(ToolError)
      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe("The OpenCode service refused the tools' credentials.")
    }
  })
})
