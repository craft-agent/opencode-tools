import { describe, expect, test } from "bun:test"
import { afterSleeps } from "../run/read.testing"
import { WAIT_POLL_MS, WAIT_RESERVE_MS } from "../run/read.wait"
import { fakeAsk, fakeEnd, fakeReply, fakeSession, type FakeRuntime } from "../service/testing"
import { SETTLE_MS } from "./reply.settle"
import { approve, askShell, reject, replyRoute, replySetup, replyTo, serviceRefusal } from "./reply.testing"
import { RUN } from "./request.testing"

/** The reads of the active set before the first look: the gate's and the call's own. */
const READS = 2

/** How many times the active set was read after the call's own reads, which is how many looks the call took at the run. */
const looks = (service: { requests: { path: string }[] }) =>
  service.requests.filter((request) => request.path === "/api/session/active").length - READS

/** Makes the `nth` read of the active set, counting from 1, answer with `answer` instead of the service. */
function failActiveRead(runtime: FakeRuntime, nth: number, answer: () => Response): void {
  const send = runtime.fetch
  let reads = 0
  runtime.fetch = ((input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
    const active = url.pathname === "/api/session/active"
    if (active) reads += 1
    return active && reads === nth ? Promise.resolve(answer()) : send(input, init)
  }) as typeof runtime.fetch
}

/** The reads of the active set the call makes before its first look at the run: the gate's and its own. */
const FIRST_LOOK = READS + 1

describe("a run that cannot be read after the replies were sent", () => {
  const status500 = () => new Response(null, { status: 500 })

  test("keeps the outcomes and gives run_error for a 500 on the first look, with no run and no also_rejected", async () => {
    const { service, runtime, ctx } = replySetup()
    const step = fakeReply(service, RUN, "Working")
    const first = askShell(service, "echo one", { step })
    askShell(service, "echo two", { step })
    failActiveRead(runtime, FIRST_LOOK, status500)
    const result = await replyTo([reject(first.id)], ctx)
    expect(result.replies).toEqual([{ request: first.id, decision: "reject", outcome: "sent" }])
    expect(result.run_error).toEqual({
      code: "upstream_error",
      message: "The OpenCode service answered with status 500.",
    })
    expect(result).not.toHaveProperty("run")
    expect(result).not.toHaveProperty("also_rejected")
  })

  test("keeps the outcomes when the call's time ends during the wait", async () => {
    const { service, runtime, ctx } = replySetup({ waitSeconds: 5 })
    const asked = askShell(service, "echo hi")
    afterSleeps(runtime, () => {
      runtime.clock.now += 60_000
    })
    const result = await replyTo([approve(asked.id, "echo hi")], ctx)
    expect(result.replies).toEqual([{ request: asked.id, decision: "once", outcome: "sent" }])
    expect(result.run_error).toMatchObject({ code: "upstream_error" })
    expect(result.run_error!.message).toContain("The call's time of 5 seconds ended")
    expect(result).not.toHaveProperty("run")
  })

  test("keeps what the first look found for also_rejected when a later look fails", async () => {
    const { service, runtime, ctx } = replySetup()
    const step = fakeReply(service, RUN, "Working")
    const first = askShell(service, "echo one", { step })
    const second = askShell(service, "echo two", { step })
    failActiveRead(runtime, FIRST_LOOK + 1, status500)
    const result = await replyTo([reject(first.id)], ctx)
    expect(result.replies[0]!.outcome).toBe("sent")
    expect(result.run_error?.code).toBe("upstream_error")
    expect(result.also_rejected).toEqual([second.id])
  })

  test("rethrows a cancellation, whatever was sent", async () => {
    const controller = new AbortController()
    const { service, runtime, ctx } = replySetup({ signal: controller.signal })
    const asked = askShell(service, "echo hi")
    failActiveRead(runtime, FIRST_LOOK, () => {
      controller.abort()
      return status500()
    })
    const error = await replyTo([approve(asked.id, "echo hi")], ctx).then(
      () => undefined,
      (thrown: unknown) => thrown as Error,
    )
    expect(error?.name).toBe("AbortError")
    expect(fakeSession(service, RUN).answers).toHaveLength(1)
  })
})

describe("the run after the replies", () => {
  test("is given at once as waiting when another request is pending", async () => {
    const { service, runtime, ctx } = replySetup()
    const start = runtime.clock.now
    const first = askShell(service, "echo one")
    const second = askShell(service, "echo two")
    const result = await replyTo([approve(first.id, "echo one")], ctx)
    expect(result.run).toMatchObject({
      state: "waiting",
      role: "plan",
      directory: "/work/acme",
      branch: "main",
      waiting_on: [{ kind: "permission", id: second.id, session: RUN, action: "shell", resources: ["echo two"] }],
    })
    expect(runtime.clock.now).toBe(start)
  })

  test("is the run as `get` reads it, without what the call says itself", async () => {
    const { service, ctx } = replySetup()
    const asked = askShell(service, "echo hi")
    askShell(service, "echo ho")
    const result = await replyTo([approve(asked.id, "echo hi")], ctx)
    expect(Object.keys(result).sort()).toEqual(["replies", "run", "service_started", "session"])
    expect(result).toMatchObject({ service_started: false, session: RUN })
    for (const key of ["method", "service_started", "session"]) expect(result.run).not.toHaveProperty(key)
  })

  test("waits while the run is running and returns when its turn ends", async () => {
    const { service, runtime, ctx } = replySetup()
    const start = runtime.clock.now
    const asked = askShell(service, "echo hi")
    afterSleeps(runtime, (sleeps) => {
      if (sleeps !== 3) return
      fakeReply(service, RUN, "All done.")
      fakeEnd(service, RUN, "succeeded")
    })
    const result = await replyTo([approve(asked.id, "echo hi")], ctx)
    expect(result.run).toMatchObject({ state: "completed", result: "All done." })
    expect(runtime.clock.now - start).toBe(3 * WAIT_POLL_MS)
  })

  test("returns when the run pauses on its next request, which it lists", async () => {
    const { service, runtime, ctx } = replySetup()
    const start = runtime.clock.now
    const asked = askShell(service, "echo hi")
    let next = ""
    afterSleeps(runtime, (sleeps) => {
      if (sleeps === 2) next = fakeAsk(service, RUN, { action: "edit", resources: ["a.ts"] }).id
    })
    const result = await replyTo([approve(asked.id, "echo hi")], ctx)
    expect(result.run!.state).toBe("waiting")
    expect(result.run!.waiting_on).toEqual([
      { kind: "permission", id: next, session: RUN, action: "edit", resources: ["a.ts"] },
    ])
    expect(runtime.clock.now - start).toBe(2 * WAIT_POLL_MS)
  })

  test("stops after SETTLE_MS with the run still running", async () => {
    const { service, runtime, ctx } = replySetup()
    const start = runtime.clock.now
    const asked = askShell(service, "echo hi")
    const result = await replyTo([approve(asked.id, "echo hi")], ctx)
    expect(result.run!.state).toBe("running")
    expect(runtime.clock.now - start).toBe(SETTLE_MS)
    expect(looks(service)).toBe(1 + SETTLE_MS / WAIT_POLL_MS)
  })

  test("never goes past the call's time, which keeps WAIT_RESERVE_MS for reading the result", async () => {
    const { service, runtime, ctx } = replySetup({ waitSeconds: 5 })
    const start = runtime.clock.now
    const asked = askShell(service, "echo hi")
    const result = await replyTo([approve(asked.id, "echo hi")], ctx)
    expect(result.run!.state).toBe("running")
    expect(runtime.clock.now - start).toBe(5000 - WAIT_RESERVE_MS)
  })

  test("looks once when the call has no more than the reserve left", async () => {
    const { service, runtime, ctx } = replySetup({ waitSeconds: 3 })
    const start = runtime.clock.now
    const asked = askShell(service, "echo hi")
    const result = await replyTo([approve(asked.id, "echo hi")], ctx)
    expect(result.run!.state).toBe("running")
    expect(runtime.clock.now).toBe(start)
    expect(looks(service)).toBe(1)
  })

  test("looks once when nothing was sent, though the run is running", async () => {
    const { service, runtime, ctx } = replySetup()
    const start = runtime.clock.now
    const asked = askShell(service, "echo hi")
    service.failNext(replyRoute(asked.id), () => {
      fakeSession(service, RUN).pending = []
      return serviceRefusal(404, "PermissionNotFoundError", "gone")
    })
    const result = await replyTo([approve(asked.id, "echo hi")], ctx)
    expect(result.replies[0]!.outcome).toBe("gone")
    expect(result.run!.state).toBe("running")
    expect(runtime.clock.now).toBe(start)
    expect(looks(service)).toBe(1)
  })
})
