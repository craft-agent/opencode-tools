import { describe, expect, test } from "bun:test"
import { fakeChild, fakeReply, fakeRetry } from "../service/testing"
import { RETRY_HANDBACK_ATTEMPT, handsBack, pickRetry } from "./read.retry"
import { RETRY_POLL_EVERY, WAIT_POLL_MS } from "./read.wait"
import { afterSleeps, boundRun, readRun, runSetup } from "./read.testing"

const ID = "ses_run"
const OTHER_ERROR = { type: "provider.overloaded", message: "busy" }

function begun(setup: ReturnType<typeof runSetup>) {
  boundRun(setup.service, ID, { busy: setup.service.clock.now, active: true })
  fakeReply(setup.service, ID, "step one")
}

const wait = (ctx: Parameters<typeof readRun>[1]) => readRun({ method: "wait", session: ID }, ctx)

describe("wait: a run that keeps retrying its provider", () => {
  test(`is handed back at attempt ${RETRY_HANDBACK_ATTEMPT}, as running with the retry and timed_out false`, async () => {
    const setup = runSetup()
    begun(setup)
    const start = setup.service.clock.now
    fakeRetry(setup.service, ID, { attempt: RETRY_HANDBACK_ATTEMPT, at: 77, error: OTHER_ERROR })
    const result = await wait(setup.ctx)
    expect(result).toMatchObject({
      state: "running",
      timed_out: false,
      retry: { attempt: RETRY_HANDBACK_ATTEMPT, at: 77, error: OTHER_ERROR },
    })
    expect(setup.service.clock.now).toBe(start)
  })

  test("is handed back at once on a limit or a refused login, at attempt 2", async () => {
    for (const type of ["provider.rate-limit", "provider.quota_exceeded", "provider.Auth", "provider.usage-limit"]) {
      const setup = runSetup()
      begun(setup)
      const start = setup.service.clock.now
      fakeRetry(setup.service, ID, { attempt: 2, at: 1, error: { type, message: "no" } })
      expect(await wait(setup.ctx)).toMatchObject({ state: "running", timed_out: false, retry: { attempt: 2 } })
      expect(setup.service.clock.now).toBe(start)
    }
  })

  test("is waited for at attempt 2 of another error, until the call's time ends", async () => {
    const setup = runSetup({ waitSeconds: 10 })
    begun(setup)
    fakeRetry(setup.service, ID, { attempt: 2, at: 1, error: OTHER_ERROR })
    expect(await wait(setup.ctx)).toMatchObject({ state: "running", timed_out: true, retry: { attempt: 2 } })
  })

  test("is not mistaken for a limit by an error that is not the provider's", async () => {
    const setup = runSetup({ waitSeconds: 10 })
    begun(setup)
    fakeRetry(setup.service, ID, { attempt: 1, at: 1, error: { type: "tool.rate-limit", message: "no" } })
    expect(await wait(setup.ctx)).toMatchObject({ timed_out: true })
  })

  test("is handed back when a subagent is the one retrying", async () => {
    const setup = runSetup()
    begun(setup)
    const sub = fakeChild(setup.service, ID)
    fakeReply(setup.service, sub.id, "sub step")
    fakeRetry(setup.service, sub.id, { attempt: 3, at: 5, error: OTHER_ERROR })
    expect(await wait(setup.ctx)).toMatchObject({ timed_out: false, retry: { attempt: 3 } })
  })

  test("is handed back at the next read of the retry, which is every RETRY_POLL_EVERY looks", async () => {
    const setup = runSetup()
    begun(setup)
    const start = setup.service.clock.now
    afterSleeps(setup.runtime, (sleeps) => {
      if (sleeps === 2) fakeRetry(setup.service, ID, { attempt: 3, at: 5, error: OTHER_ERROR })
    })
    expect(await wait(setup.ctx)).toMatchObject({ timed_out: false, retry: { attempt: 3 } })
    expect(setup.service.clock.now - start).toBe(RETRY_POLL_EVERY * WAIT_POLL_MS)
  })

  test("is not handed back by a retry that cleared before it was read again", async () => {
    const setup = runSetup({ waitSeconds: 10 })
    begun(setup)
    fakeRetry(setup.service, ID, { attempt: 1, at: 5, error: OTHER_ERROR })
    afterSleeps(setup.runtime, (sleeps) => {
      if (sleeps === 1) fakeReply(setup.service, ID, "recovered")
    })
    const result = await wait(setup.ctx)
    expect(result).toMatchObject({ state: "running", timed_out: true })
    expect(result).not.toHaveProperty("retry")
  })
})

describe("the retry a wait hands back", () => {
  const retry = (attempt: number, type = OTHER_ERROR.type, at = 0) => ({
    attempt,
    at,
    error: { type, message: "m" },
  })

  test("is one from the third attempt on, or a limit or a refused login of the provider", () => {
    expect(handsBack(retry(1))).toBe(false)
    expect(handsBack(retry(2))).toBe(false)
    expect(handsBack(retry(3))).toBe(true)
    expect(handsBack(retry(1, "provider.rate-limit"))).toBe(true)
    expect(handsBack(retry(1, "provider.auth"))).toBe(true)
    expect(handsBack(retry(1, "provider.quota"))).toBe(true)
    expect(handsBack(retry(1, "provider.limit-reached"))).toBe(true)
    expect(handsBack(retry(1, "network.rate"))).toBe(false)
    expect(handsBack(retry(1, "rate-limit"))).toBe(false)
  })

  test("is, of several, the one that is handed back, else the one whose time comes last", () => {
    expect(pickRetry([])).toBeUndefined()
    expect(pickRetry([retry(1, "x", 10), retry(2, "x", 30), retry(1, "x", 20)])).toEqual(retry(2, "x", 30))
    expect(pickRetry([retry(1, "x", 10), retry(4, "x", 5), retry(2, "x", 30)])).toEqual(retry(4, "x", 5))
  })
})
