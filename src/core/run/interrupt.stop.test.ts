import { describe, expect, test } from "bun:test"
import { serviceRefusal } from "../request/reply.testing"
import { fakeChild, fakeEnd, fakeJob, fakeReply, fakeSession, type FakeRuntime } from "../service/testing"
import { afterRequest, interruptRun, liveRun, RUN, unreadMessage, writesOf } from "./control.testing"
import { INTERRUPT_POLL_MS, NOTHING_ROLLED_BACK } from "./interrupt.stop"
import { requestsTo } from "./read.testing"

const INTERRUPT = /\/interrupt$/

/** How many times the service was asked for its active set. */
const activeReads = (service: { requests: { path: string }[] }) =>
  service.requests.filter((request) => request.path === "/api/session/active").length

/** The times, from now on the runtime's clock, at which the service answered each interrupt; filled as the call runs. */
function interruptTimes(runtime: FakeRuntime): number[] {
  const start = runtime.clock.now
  const times: number[] = []
  afterRequest(runtime, "POST", INTERRUPT, () => times.push(runtime.clock.now - start))
  return times
}

describe("an interrupt of a run with nothing active", () => {
  test("stops nothing, sends nothing, waits for nothing and returns the run's state", async () => {
    const { service, runtime, ctx } = liveRun()
    fakeReply(service, RUN, "Done.")
    fakeEnd(service, RUN, "succeeded")
    const start = runtime.clock.now
    const result = await interruptRun(ctx)
    expect(result).toMatchObject({
      service_started: false,
      session: RUN,
      stopped: { sessions: [], commands: 0 },
      withdrawn: 0,
      timed_out: false,
      message: NOTHING_ROLLED_BACK,
      run: { state: "completed", result: "Done." },
    })
    expect(result).not.toHaveProperty("background_unchecked")
    expect(result).not.toHaveProperty("run_error")
    expect(writesOf(service)).toEqual([])
    expect(runtime.clock.now).toBe(start)
    expect(activeReads(service)).toBe(2)
  })
})

describe("an interrupt of a running turn", () => {
  test("interrupts the run's session, and two quiet looks end it", async () => {
    const { service, runtime, ctx } = liveRun()
    const start = runtime.clock.now
    const result = await interruptRun(ctx)
    expect(result).toMatchObject({
      stopped: { sessions: [RUN], commands: 0 },
      timed_out: false,
      run: { state: "interrupted" },
    })
    expect(writesOf(service)).toEqual([`POST /api/session/${RUN}/interrupt`])
    expect(runtime.clock.now - start).toBe(2 * INTERRUPT_POLL_MS)
    expect(activeReads(service)).toBe(3 + 1)
  })

  test("asks for the running jobs of the run and of every session below it", async () => {
    const { service, ctx } = liveRun()
    await interruptRun(ctx)
    const [first] = requestsTo(service, "/experimental/job")
    expect(first!.query).toMatchObject({ sessionID: RUN, descendants: "true", status: "running" })
  })

  test("fails with the service's error when an interrupt fails, which can be called again", async () => {
    const { service, ctx } = liveRun()
    service.failNext(INTERRUPT, new Response(null, { status: 500 }))
    await expect(interruptRun(ctx)).rejects.toMatchObject({ code: "upstream_error" })
    expect((await interruptRun(ctx)).stopped.sessions).toEqual([RUN])
  })
})

describe("an interrupt of a run with subagents", () => {
  test("stops a child first and the run's own session only at a later look, the report staying in the inbox", async () => {
    const { service, runtime, ctx } = liveRun()
    const child = fakeChild(service, RUN)
    const times = interruptTimes(runtime)
    const result = await interruptRun(ctx)
    expect(writesOf(service)).toEqual([`POST /api/session/${child.id}/interrupt`, `POST /api/session/${RUN}/interrupt`])
    expect(times).toEqual([0, INTERRUPT_POLL_MS])
    expect(result).toMatchObject({
      stopped: { sessions: [child.id, RUN], commands: 0 },
      withdrawn: 0,
      run: { state: "interrupted" },
    })
    expect(fakeSession(service, RUN).inbox).toMatchObject([{ type: "synthetic" }])
    expect(service.state.active).toEqual([])
  })

  test("stops the deepest session first", async () => {
    const { service, runtime, ctx } = liveRun()
    const child = fakeChild(service, RUN)
    const grandchild = fakeChild(service, child.id)
    const times = interruptTimes(runtime)
    const result = await interruptRun(ctx)
    expect(writesOf(service)).toEqual([
      `POST /api/session/${grandchild.id}/interrupt`,
      `POST /api/session/${child.id}/interrupt`,
      `POST /api/session/${RUN}/interrupt`,
    ])
    expect(times).toEqual([0, 0, INTERRUPT_POLL_MS])
    expect(result.stopped.sessions).toEqual([grandchild.id, child.id, RUN])
  })

  test("never cancels a job of kind subagent, which is stopped through its session", async () => {
    const { service, ctx } = liveRun()
    fakeChild(service, RUN)
    await interruptRun(ctx)
    expect(writesOf(service).filter((write) => write.includes("/cancel"))).toEqual([])
  })

  test("skips a child the service no longer has", async () => {
    const { service, ctx } = liveRun()
    const child = fakeChild(service, RUN)
    service.failNext(new RegExp(`/${child.id}/interrupt$`), () => {
      fakeEnd(service, child.id, "succeeded")
      return serviceRefusal(404, "SessionNotFoundError", "gone")
    })
    const result = await interruptRun(ctx)
    expect(result.stopped.sessions).toEqual([RUN])
    expect(result.run).toMatchObject({ state: "interrupted" })
  })
})

describe("an interrupt of a run with a command in the background", () => {
  test("cancels the command of an idle run, and interrupts the session its report woke", async () => {
    const { service, ctx } = liveRun()
    const job = fakeJob(service, RUN, "pnpm dev")
    fakeEnd(service, RUN, "succeeded")
    const result = await interruptRun(ctx)
    expect(writesOf(service)).toEqual([
      `POST /api/experimental/job/${job.id}/cancel`,
      `POST /api/session/${RUN}/interrupt`,
    ])
    expect(result).toMatchObject({ stopped: { sessions: [RUN], commands: 1 }, run: { state: "interrupted" } })
  })

  test("counts a command once, though it is listed at two looks", async () => {
    const { service, ctx } = liveRun()
    const job = fakeJob(service, RUN, "pnpm dev")
    const cancel = `POST /api/experimental/job/${job.id}/cancel`
    service.failNext(/\/experimental\/job\/.+\/cancel$/, () => new Response(null, { status: 204 }))
    const result = await interruptRun(ctx)
    expect(result.stopped.commands).toBe(1)
    expect(writesOf(service).filter((write) => write.endsWith("/cancel"))).toEqual([cancel, cancel])
  })
})

describe("an interrupt withdraws the caller's messages", () => {
  test("every unread one of the caller's, steered or queued, counted, and not what the service put there", async () => {
    const { service, ctx } = liveRun()
    const session = fakeSession(service, RUN)
    unreadMessage(service, RUN, "msg_steer")
    session.inbox.push({
      id: "msg_report",
      sessionID: RUN,
      time: { created: service.clock.now },
      type: "synthetic",
      payload: { text: "A report.", metadata: {} },
      delivery: "steer",
    })
    unreadMessage(service, RUN, "msg_queued", "queue")
    const result = await interruptRun(ctx)
    expect(result.withdrawn).toBe(2)
    expect(writesOf(service)).toEqual([
      `DELETE /api/session/${RUN}/inbox/msg_steer`,
      `DELETE /api/session/${RUN}/inbox/msg_queued`,
      `POST /api/session/${RUN}/interrupt`,
    ])
    expect(session.inbox.map((item) => item.id)).toEqual(["msg_report"])
  })

  test("and one sent during the stop, by the second pass", async () => {
    const { service, runtime, ctx } = liveRun()
    unreadMessage(service, RUN, "msg_early")
    afterRequest(runtime, "POST", INTERRUPT, () => unreadMessage(service, RUN, "msg_late"))
    const result = await interruptRun(ctx)
    expect(result.withdrawn).toBe(2)
    expect(writesOf(service)).toEqual([
      `DELETE /api/session/${RUN}/inbox/msg_early`,
      `POST /api/session/${RUN}/interrupt`,
      `DELETE /api/session/${RUN}/inbox/msg_late`,
    ])
    expect(fakeSession(service, RUN).inbox).toEqual([])
  })
})
