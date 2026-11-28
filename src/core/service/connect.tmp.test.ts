import { describe, expect, test } from "bun:test"
import { connectService } from "./connect"
import { createFakeService, fakeRuntime } from "./testing"

describe("connectService: the scratch directory", () => {
  test("is the one the service reports", async () => {
    const service = createFakeService({ info: { version: "9.9.9", pid: 1, urls: [], paths: { tmp: "/tmp/acme" } } })
    const connection = await connectService({ runtime: fakeRuntime(service) })
    expect(connection.tmp).toBe("/tmp/acme")
  })

  test("is absent, not undefined, when the service reports none", async () => {
    const service = createFakeService({ info: { version: "9.9.9", pid: 1, urls: [], paths: { tmp: "" } } })
    const connection = await connectService({ runtime: fakeRuntime(service) })
    expect(Object.keys(connection).sort()).toEqual(["client", "deadline", "started", "version"])
  })
})
