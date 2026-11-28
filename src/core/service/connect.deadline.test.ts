import { describe, expect, test } from "bun:test"
import { WAIT_SECONDS_OPTION, startDeadline } from "../deadline"
import { ToolError } from "../errors"
import type { ToolOptions } from "../tool"
import { START_POLL_MS, START_TIMEOUT_MS, connectService } from "./connect"
import { createFakeService, fakeRuntime } from "./testing"

const MS_PER_SECOND = 1000

function waiting(seconds: number): ToolOptions {
  return { [WAIT_SECONDS_OPTION]: seconds }
}

async function rejection(pending: Promise<unknown>): Promise<ToolError> {
  const error = await pending.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  if (!(error instanceof ToolError)) throw new Error(`Expected a ToolError, got ${String(error)}`)
  return error
}

describe("connectService: the call's time while it starts a service", () => {
  test("a service that registers late fails at the call's limit when that is under the start limit", async () => {
    const seconds = 5
    const runtime = fakeRuntime(createFakeService(), { running: false, startsAfterPolls: 1000 })
    const before = runtime.now()
    const error = await rejection(connectService({ runtime, options: waiting(seconds) }))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The call's time of 5 seconds ended while it waited for the OpenCode service to start.")
    expect(runtime.started).toHaveLength(1)
    expect(runtime.now() - before).toBeGreaterThanOrEqual(seconds * MS_PER_SECOND)
    expect(runtime.now() - before).toBeLessThan(seconds * MS_PER_SECOND + START_POLL_MS)
  })

  test("a call whose time is the start limit's keeps the start message", async () => {
    const runtime = fakeRuntime(createFakeService(), { running: false, startsAfterPolls: Infinity })
    const error = await rejection(connectService({ runtime, options: waiting(START_TIMEOUT_MS / MS_PER_SECOND) }))
    expect(error.message).toBe("The OpenCode service did not start within 30 seconds.")
  })

  test("a call whose time was used before it started the service has less to wait with", async () => {
    const runtime = fakeRuntime(createFakeService(), { running: false, startsAfterPolls: Infinity })
    const deadline = startDeadline({ runtime, options: waiting(40) })
    runtime.clock.now += 35 * MS_PER_SECOND
    const error = await rejection(connectService({ runtime }, { deadline }))
    expect(error.message).toBe("The call's time of 40 seconds ended while it waited for the OpenCode service to start.")
    expect(runtime.started).toHaveLength(1)
  })

  test("a service that registers within the call's time is found", async () => {
    const runtime = fakeRuntime(createFakeService(), { running: false, startsAfterPolls: 3 })
    const connection = await connectService({ runtime, options: waiting(5) })
    expect(connection.started).toBe(true)
    expect(connection.deadline.seconds).toBe(5)
  })
})

describe("connectService: the call's time and its requests", () => {
  test("a request made when nothing is left is not sent", async () => {
    const service = createFakeService()
    const runtime = fakeRuntime(service, {
      beforeDiscover: () => {
        runtime.clock.now += 2 * MS_PER_SECOND
      },
    })
    const error = await rejection(connectService({ runtime, options: waiting(1) }))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The call's time of 1 second ended while it waited for the OpenCode service to answer.")
    expect(service.requests).toEqual([])
  })

  test("a request that times out with a moment of the call's time left says the call ran out", async () => {
    const service = createFakeService()
    const runtime = fakeRuntime(service)
    const connection = await connectService({ runtime, options: waiting(5) }, { requestTimeoutMs: 20 })
    service.failNext("/api/agent", () => {
      runtime.clock.now += 4950
      return new Promise<Response>(() => {})
    })
    const error = await rejection(connection.client.agent.list())
    expect(error.message).toBe("The call's time of 5 seconds ended while it waited for the OpenCode service to answer.")
  })

  test("a request that times out with plenty of the call's time left keeps its own message", async () => {
    const service = createFakeService()
    const runtime = fakeRuntime(service)
    const connection = await connectService({ runtime, options: waiting(5) }, { requestTimeoutMs: 20 })
    service.failNext("/api/agent", () => new Promise<Response>(() => {}))
    const error = await rejection(connection.client.agent.list())
    expect(error.message).toBe("The OpenCode service did not answer within 0.02 seconds.")
  })

  test("a request is limited to what the call has left when that is less than its own limit", async () => {
    const service = createFakeService()
    const runtime = fakeRuntime(service)
    const connection = await connectService({ runtime, options: waiting(5) })
    runtime.clock.now += 4950
    service.failNext("/api/agent", () => new Promise<Response>(() => {}))
    const before = Date.now()
    const error = await rejection(connection.client.agent.list())
    expect(error.message).toBe("The call's time of 5 seconds ended while it waited for the OpenCode service to answer.")
    expect(Date.now() - before).toBeLessThan(2000)
  })

  test("the connection carries the deadline it was given", async () => {
    const runtime = fakeRuntime(createFakeService())
    const deadline = startDeadline({ runtime, options: waiting(7) })
    expect((await connectService({ runtime }, { deadline })).deadline).toBe(deadline)
  })
})
