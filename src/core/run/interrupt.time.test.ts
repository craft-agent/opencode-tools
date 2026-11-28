import { describe, expect, test } from "bun:test"
import { fakeChild, fakeEnd } from "../service/testing"
import { afterRequest, interruptRun, liveRun, RUN, writesOf } from "./control.testing"
import { INTERRUPT_POLL_MS, INTERRUPT_SETTLE_MS } from "./interrupt.stop"
import { requestsTo } from "./read.testing"
import { WAIT_RESERVE_MS } from "./read.wait"

const MS_PER_SECOND = 1000
const INTERRUPT = /\/interrupt$/
const JOBS = "/api/experimental/job"
const ACTIVE = "/api/session/active"
const status500 = () => new Response(null, { status: 500 })

/** Makes the session active again each time it is interrupted: something the service cannot stop. */
function staysActive(setup: ReturnType<typeof liveRun>): void {
  afterRequest(setup.runtime, "POST", INTERRUPT, () => setup.service.state.active.push(RUN))
}

describe("an interrupt of something that stays active", () => {
  test("looks every INTERRUPT_POLL_MS for INTERRUPT_SETTLE_MS, then says timed_out with the run still running", async () => {
    const setup = liveRun()
    const { service, runtime, ctx } = setup
    staysActive(setup)
    const start = runtime.clock.now
    const result = await interruptRun(ctx)
    expect(result).toMatchObject({
      timed_out: true,
      stopped: { sessions: [RUN], commands: 0 },
      run: { state: "running" },
    })
    expect(runtime.clock.now - start).toBe(INTERRUPT_SETTLE_MS)
    expect(requestsTo(service, "/interrupt")).toHaveLength(INTERRUPT_SETTLE_MS / INTERRUPT_POLL_MS + 1)
  })

  test("stays within the call's own time, which keeps WAIT_RESERVE_MS for reading the result", async () => {
    const waitSeconds = 5
    const setup = liveRun({ waitSeconds })
    const { runtime, ctx } = setup
    staysActive(setup)
    const start = runtime.clock.now
    const result = await interruptRun(ctx)
    expect(result).toMatchObject({ timed_out: true, run: { state: "running" } })
    expect(runtime.clock.now - start).toBe(waitSeconds * MS_PER_SECOND - WAIT_RESERVE_MS)
  })

  test("looks once when the call has no more than the reserve left", async () => {
    const setup = liveRun({ waitSeconds: 3 })
    const { service, runtime, ctx } = setup
    staysActive(setup)
    const start = runtime.clock.now
    const result = await interruptRun(ctx)
    expect(result.timed_out).toBe(true)
    expect(runtime.clock.now).toBe(start)
    expect(requestsTo(service, "/interrupt")).toHaveLength(1)
  })

  test("is not timed out when the time ends at a look that finds nothing active", async () => {
    const { runtime, ctx } = liveRun({ waitSeconds: (WAIT_RESERVE_MS + INTERRUPT_POLL_MS) / MS_PER_SECOND })
    const start = runtime.clock.now
    const result = await interruptRun(ctx)
    expect(result).toMatchObject({ timed_out: false, run: { state: "interrupted" } })
    expect(runtime.clock.now - start).toBe(INTERRUPT_POLL_MS)
  })

  test("rethrows a cancellation", async () => {
    const controller = new AbortController()
    const { runtime, ctx } = liveRun({ signal: controller.signal })
    afterRequest(runtime, "POST", INTERRUPT, () => controller.abort())
    const error = await interruptRun(ctx).then(
      () => undefined,
      (thrown: unknown) => thrown as Error,
    )
    expect(error?.name).toBe("AbortError")
  })
})

describe("an interrupt of a service without the job routes", () => {
  test("stops the sessions all the same, says the background was not checked, and does not ask again", async () => {
    const { service, ctx } = liveRun({ state: { jobsRefused: true } })
    const child = fakeChild(service, RUN)
    const result = await interruptRun(ctx)
    expect(result).toMatchObject({
      background_unchecked: true,
      stopped: { sessions: [child.id, RUN], commands: 0 },
      run: { state: "interrupted" },
    })
    expect(requestsTo(service, "/experimental/job")).toHaveLength(1)
  })

  test("is the same for any upstream_error of the job list while the call has time", async () => {
    const { service, ctx } = liveRun()
    service.failNext(JOBS, status500())
    const result = await interruptRun(ctx)
    expect(result).toMatchObject({ background_unchecked: true, stopped: { sessions: [RUN] } })
  })

  test("is the call's failure when the call has no time left", async () => {
    const { service, runtime, ctx } = liveRun({ waitSeconds: 5 })
    service.failNext(JOBS, () => {
      runtime.clock.now += 60_000
      return status500()
    })
    await expect(interruptRun(ctx)).rejects.toMatchObject({ code: "upstream_error" })
    expect(writesOf(service)).toEqual([])
  })

  test("leaves background_unchecked out when the routes answer", async () => {
    const { ctx } = liveRun()
    expect(await interruptRun(ctx)).not.toHaveProperty("background_unchecked")
  })
})

describe("the run after the interrupt", () => {
  test("is run_error, with the rest of the result, when the run cannot be read", async () => {
    const { service, runtime, ctx } = liveRun()
    fakeEnd(service, RUN, "succeeded")
    afterRequest(runtime, "GET", /\/session\/active$/, (nth) => {
      if (nth === 1) service.failNext(ACTIVE, status500())
    })
    const result = await interruptRun(ctx)
    expect(result).toMatchObject({
      session: RUN,
      stopped: { sessions: [], commands: 0 },
      withdrawn: 0,
      timed_out: false,
      run_error: { code: "upstream_error", message: "The OpenCode service answered with status 500." },
    })
    expect(result).not.toHaveProperty("run")
  })
})
