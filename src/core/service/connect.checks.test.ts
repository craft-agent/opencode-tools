import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { connectService } from "./connect"
import { createFakeService, fakeRuntime, type FakeRuntimeOptions } from "./testing"

const JSON_HEADERS = { "content-type": "application/json" }

function jsonReply(body: string): Response {
  return new Response(body, { status: 200, headers: JSON_HEADERS })
}

describe("connectService: no service is started for a cancelled call", () => {
  test("an abort while the first discover is pending", async () => {
    const controller = new AbortController()
    const options: FakeRuntimeOptions = {
      running: false,
      beforeDiscover: async () => {
        await Promise.resolve()
        controller.abort()
      },
    }
    const runtime = fakeRuntime(createFakeService(), options)
    const error = (await connectService({ runtime, signal: controller.signal }).catch((e: unknown) => e)) as Error
    expect(error.name).toBe("AbortError")
    expect(error).not.toBeInstanceOf(ToolError)
    expect(runtime.started).toEqual([])
  })

  test("an abort while a discover of the start loop is pending", async () => {
    const controller = new AbortController()
    let discovers = 0
    const runtime = fakeRuntime(createFakeService(), {
      running: false,
      startsAfterPolls: 0,
      beforeDiscover: () => {
        discovers += 1
        // The second discover is the first one after the start, and it would find the service.
        if (discovers === 2) controller.abort()
      },
    })
    const error = (await connectService({ runtime, signal: controller.signal }).catch((e: unknown) => e)) as Error
    expect(error.name).toBe("AbortError")
    expect(runtime.started).toHaveLength(1)
  })
})

describe("connectService: the reply of the info request", () => {
  test.each([
    ["an empty object", "{}"],
    ["null", "null"],
    ["a version that is not text", '{"version":5}'],
    ["a list", "[]"],
    ["a string", '"2.4.2"'],
  ])("%s is a reply that could not be read", async (_name, body) => {
    const service = createFakeService()
    service.failNext("/api/info", jsonReply(body))
    const error = (await connectService({ runtime: fakeRuntime(service) }).catch((e: unknown) => e)) as ToolError
    expect(error).toBeInstanceOf(ToolError)
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service sent a reply that could not be read.")
  })

  test("a reply with a version is checked as before", async () => {
    const service = createFakeService()
    service.failNext("/api/info", jsonReply('{"version":"2.4.1"}'))
    const error = (await connectService({ runtime: fakeRuntime(service) }).catch((e: unknown) => e)) as ToolError
    expect(error.message).toBe("OpenCode 2.4.1 is running; these tools need 2.4.2 or later.")
  })
})
