import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { SESSION_NOT_FOUND } from "../service/errors"
import { fakeAsk, fakeChild, fakeEnd, fakeQuestion, fakeReply, fakeSession } from "../service/testing"
import { RETRY_POLL_EVERY, WAIT_POLL_MS, WAIT_RESERVE_MS } from "./read.wait"
import { afterSleeps, boundRun, readRun, requestsTo, runSetup } from "./read.testing"

const ID = "ses_run"
const SECOND = 1000

function begun(setup: ReturnType<typeof runSetup>) {
  return boundRun(setup.service, ID, { busy: setup.service.clock.now, active: true })
}

const wait = (ctx: Parameters<typeof readRun>[1]) => readRun({ method: "wait", session: ID }, ctx)

describe("wait: when the run is not running", () => {
  test("returns at once, as get does, with timed_out false and no sleep", async () => {
    const setup = runSetup()
    begun(setup)
    setup.service.clock.now += 3 * SECOND
    fakeReply(setup.service, ID, "Done.")
    fakeEnd(setup.service, ID, "succeeded")
    const before = setup.service.clock.now
    expect(await wait(setup.ctx)).toEqual({
      method: "wait",
      service_started: false,
      session: ID,
      role: "plan",
      agent: "plan",
      model: "acme/model-1",
      directory: "/work/acme",
      branch: "main",
      state: "completed",
      result: "Done.",
      timed_out: false,
    })
    expect(setup.service.clock.now).toBe(before)
  })

  test("returns at once for a run that is waiting on a request, of its own session or a subagent's", async () => {
    const own = runSetup()
    begun(own)
    fakeAsk(own.service, ID, { action: "bash", resources: ["make"] })
    const asked = await wait(own.ctx)
    expect(asked).toMatchObject({ state: "waiting", timed_out: false })
    expect(asked.waiting_on).toHaveLength(1)

    const child = runSetup()
    begun(child)
    const sub = fakeChild(child.service, ID)
    fakeQuestion(child.service, sub.id, "Which one?")
    expect(await wait(child.ctx)).toMatchObject({
      state: "waiting",
      timed_out: false,
      waiting_on: [{ kind: "question", session: sub.id, title: "Which one?" }],
    })
    expect(child.service.clock.now).toBe(own.service.clock.now)
  })

  test("returns at once for a run that stopped without its end and is past settling", async () => {
    const setup = runSetup()
    begun(setup)
    setup.service.state.active = []
    setup.service.clock.now += 40 * SECOND
    expect(await wait(setup.ctx)).toMatchObject({ state: "interrupted", resumes: true, timed_out: false })
  })
})

describe("wait: while the run is running", () => {
  test("returns when the turn ends between two looks, one second a look", async () => {
    const setup = runSetup()
    begun(setup)
    const start = setup.service.clock.now
    afterSleeps(setup.runtime, (sleeps) => {
      if (sleeps === 3) {
        fakeReply(setup.service, ID, "Finished.")
        fakeEnd(setup.service, ID, "succeeded")
      }
    })
    expect(await wait(setup.ctx)).toMatchObject({ state: "completed", result: "Finished.", timed_out: false })
    expect(setup.service.clock.now - start).toBe(3 * WAIT_POLL_MS)
  })

  test("returns waiting when a request appears, for the run's own session and for a subagent's", async () => {
    const own = runSetup()
    begun(own)
    afterSleeps(own.runtime, (sleeps) => {
      if (sleeps === 2) fakeAsk(own.service, ID, { action: "edit", resources: ["a.ts"] })
    })
    expect(await wait(own.ctx)).toMatchObject({ state: "waiting", timed_out: false })

    const sub = runSetup()
    begun(sub)
    afterSleeps(sub.runtime, (sleeps) => {
      if (sleeps === 2) fakeAsk(sub.service, fakeChild(sub.service, ID).id, { action: "edit", resources: ["a.ts"] })
    })
    const result = await wait(sub.ctx)
    expect(result).toMatchObject({ state: "waiting", timed_out: false })
    expect(result.waiting_on![0]!.session).not.toBe(ID)
  })

  test("keeps waiting while only a subagent runs, after the run's own turn ended", async () => {
    const setup = runSetup()
    begun(setup)
    fakeEnd(setup.service, ID, "succeeded")
    const sub = fakeChild(setup.service, ID)
    afterSleeps(setup.runtime, (sleeps) => {
      if (sleeps === 4) {
        fakeReply(setup.service, sub.id, "child done")
        fakeEnd(setup.service, sub.id, "succeeded")
      }
    })
    expect(await wait(setup.ctx)).toMatchObject({ state: "completed", timed_out: false })
    expect(setup.service.clock.now - sub.time.created).toBe(4 * WAIT_POLL_MS)
  })

  test("returns timed_out with the run still running once the call has WAIT_RESERVE_MS left", async () => {
    const setup = runSetup({ waitSeconds: 10 })
    begun(setup)
    const start = setup.service.clock.now
    const result = await wait(setup.ctx)
    expect(result).toMatchObject({ state: "running", timed_out: true })
    expect(setup.service.clock.now - start).toBe(10 * SECOND - WAIT_RESERVE_MS)
  })

  test("never runs past the call's time, whatever it is", async () => {
    for (const waitSeconds of [1, 2, 4, 10, 50]) {
      const setup = runSetup({ waitSeconds })
      begun(setup)
      const start = setup.service.clock.now
      expect((await wait(setup.ctx)).timed_out).toBe(true)
      const elapsed = setup.service.clock.now - start
      expect(elapsed).toBeLessThanOrEqual(Math.max(0, waitSeconds * SECOND - WAIT_RESERVE_MS))
    }
  })

  test("looks once even when the call has less than the reserve", async () => {
    const setup = runSetup({ waitSeconds: 1 })
    begun(setup)
    afterSleeps(setup.runtime, () => {
      throw new Error("a wait with nothing to spare must not sleep")
    })
    expect(await wait(setup.ctx)).toMatchObject({ state: "running", timed_out: true })
  })

  test("never fails for running out of time while it waits", async () => {
    const setup = runSetup({ waitSeconds: 4 })
    begun(setup)
    await expect(wait(setup.ctx)).resolves.toMatchObject({ timed_out: true })
  })
})

describe("wait: what a look asks of the service", () => {
  test("is the active set and the pending lists of the sessions that are active, nothing more", async () => {
    const setup = runSetup({ waitSeconds: 10 })
    begun(setup)
    await wait(setup.ctx)
    const looks = Math.floor((10 * SECOND - WAIT_RESERVE_MS) / WAIT_POLL_MS) + 1
    expect(requestsTo(setup.service, "/session/active")).toHaveLength(looks)
    expect(requestsTo(setup.service, `/session/${ID}/permission`)).toHaveLength(looks)
    expect(requestsTo(setup.service, `/session/${ID}/form`)).toHaveLength(looks)
    expect(requestsTo(setup.service, `/session/${ID}/inbox`)).toHaveLength(0)
  })

  test("reads the run's own session when the call starts and at its end, not at each look", async () => {
    const setup = runSetup({ waitSeconds: 10 })
    begun(setup)
    await wait(setup.ctx)
    expect(requestsTo(setup.service, `/api/session/${ID}`)).toHaveLength(2)
  })

  test("reads the retry only at every RETRY_POLL_EVERY look, and the reply once at the end", async () => {
    const setup = runSetup({ waitSeconds: 10 })
    begun(setup)
    await wait(setup.ctx)
    const looks = Math.floor((10 * SECOND - WAIT_RESERVE_MS) / WAIT_POLL_MS) + 1
    const reads = requestsTo(setup.service, `/session/${ID}/message`)
    const retries = reads.filter((request) => request.query.type === "assistant")
    expect(retries).toHaveLength(Math.ceil(looks / RETRY_POLL_EVERY) + 1)
    expect(reads.filter((request) => request.query.type === undefined)).toHaveLength(1)
  })

  test("reads a subagent's session once, however many looks there are", async () => {
    const setup = runSetup({ waitSeconds: 10 })
    begun(setup)
    const sub = fakeChild(setup.service, ID)
    await wait(setup.ctx)
    expect(requestsTo(setup.service, `/api/session/${sub.id}`)).toHaveLength(1)
    const looks = Math.floor((10 * SECOND - WAIT_RESERVE_MS) / WAIT_POLL_MS) + 1
    expect(requestsTo(setup.service, `/session/${sub.id}/permission`)).toHaveLength(looks)
  })

  test("reads the run's own session at each look while nothing of the run is active", async () => {
    const setup = runSetup({ waitSeconds: 10 })
    begun(setup)
    setup.service.state.active = []
    await wait(setup.ctx)
    const looks = Math.floor((10 * SECOND - WAIT_RESERVE_MS) / WAIT_POLL_MS) + 1
    expect(requestsTo(setup.service, `/api/session/${ID}`).length).toBeGreaterThanOrEqual(looks)
    expect(requestsTo(setup.service, `/session/${ID}/inbox`)).toHaveLength(looks)
  })
})

describe("wait: a session that goes", () => {
  test("is not_found when it is removed between two looks", async () => {
    const setup = runSetup()
    begun(setup)
    afterSleeps(setup.runtime, (sleeps) => {
      if (sleeps === 2) {
        setup.service.state.sessions.splice(setup.service.state.sessions.indexOf(fakeSession(setup.service, ID)), 1)
        setup.service.state.active = []
      }
    })
    const error = await wait(setup.ctx).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ToolError)
    expect(error).toMatchObject({ code: "not_found", message: SESSION_NOT_FOUND })
  })

  test("is not_found when it is removed while it is still in the active set", async () => {
    const setup = runSetup()
    begun(setup)
    afterSleeps(setup.runtime, (sleeps) => {
      if (sleeps === 1) {
        setup.service.state.sessions.splice(setup.service.state.sessions.indexOf(fakeSession(setup.service, ID)), 1)
      }
    })
    const error = await wait(setup.ctx).catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ code: "not_found" })
  })

  test("is left out of the wait when it is a subagent that was removed", async () => {
    const setup = runSetup({ waitSeconds: 10 })
    begun(setup)
    const sub = fakeChild(setup.service, ID)
    afterSleeps(setup.runtime, (sleeps) => {
      if (sleeps === 1) setup.service.state.sessions.splice(setup.service.state.sessions.indexOf(sub), 1)
    })
    expect(await wait(setup.ctx)).toMatchObject({ state: "running", timed_out: true })
  })
})

describe("wait: a call that is cancelled", () => {
  test("rejects with the abort, between two looks", async () => {
    const controller = new AbortController()
    const setup = runSetup({ signal: controller.signal })
    begun(setup)
    afterSleeps(setup.runtime, (sleeps) => {
      if (sleeps === 2) controller.abort()
    })
    const error = (await wait(setup.ctx).catch((thrown: unknown) => thrown)) as Error
    expect(error.name).toBe("AbortError")
    expect(error).not.toBeInstanceOf(ToolError)
  })

  test("rejects with the abort when the call was cancelled before it started", async () => {
    const setup = runSetup({ signal: AbortSignal.abort() })
    begun(setup)
    const error = (await wait(setup.ctx).catch((thrown: unknown) => thrown)) as Error
    expect(error.name).toBe("AbortError")
    expect(setup.service.requests).toEqual([])
  })
})
