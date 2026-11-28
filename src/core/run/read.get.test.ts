import { describe, expect, test } from "bun:test"
import { fakeAsk, fakeChild, fakeEnd, fakeReply, fakeStop, type FakeService } from "../service/testing"
import { DIRECTORY, beginTurn, boundRun, callsOf, readRun, runSetup } from "./read.testing"
import { INTERRUPTED_MESSAGE, NO_TURN_MESSAGE, SETTLING_MS } from "./state"

const ID = "ses_run"
const SECOND = 1000

/** A run whose turn has just begun: busy, and in the active set. */
function begun(service: FakeService, overrides: Parameters<typeof boundRun>[2] = {}) {
  return boundRun(service, ID, { busy: service.clock.now, active: true, ...overrides })
}

const get = (ctx: Parameters<typeof readRun>[1]) => readRun({ method: "get", session: ID }, ctx)

describe("get: the state of a run", () => {
  test("is running while the session is active, with who it is and where", async () => {
    const { service, ctx } = runSetup()
    begun(service).title = "Review the diff"
    expect(await get(ctx)).toEqual({
      method: "get",
      service_started: false,
      session: ID,
      title: "Review the diff",
      role: "plan",
      agent: "plan",
      model: "acme/model-1",
      directory: DIRECTORY,
      branch: "main",
      state: "running",
    })
  })

  test("writes the model with its variant, and the branch of a detached head as null", async () => {
    const { service, ctx } = runSetup()
    begun(service, { branch: null, model: { providerID: "acme", id: "model-2", variant: "high" } })
    expect(await get(ctx)).toMatchObject({ model: "acme/model-2#high", branch: null })
  })

  test("is completed, failed or interrupted from the outcome of the turn that ended", async () => {
    for (const [outcome, state] of [
      ["succeeded", "completed"],
      ["failed", "failed"],
      ["interrupted", "interrupted"],
    ] as const) {
      const { service, ctx } = runSetup()
      begun(service)
      service.clock.now += 4 * SECOND
      fakeEnd(service, ID, outcome)
      const result = await get(ctx)
      expect(result.state).toBe(state)
      expect(result).not.toHaveProperty("resumes")
      expect(result).not.toHaveProperty("message")
    }
  })

  test("is running while a subagent is, after the run's own turn ended", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeEnd(service, ID, "succeeded")
    fakeChild(service, ID)
    expect((await get(ctx)).state).toBe("running")
  })

  test("is running, not completed, for the moment a session is still active after its end was written", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeEnd(service, ID, "succeeded")
    service.state.active.push(ID)
    expect((await get(ctx)).state).toBe("running")
  })

  test("is running for a turn that stopped without its end, until it has been SETTLING_MS", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeStop(service, ID)
    service.clock.now += SETTLING_MS - 1
    expect((await get(ctx)).state).toBe("running")
    service.clock.now += 1
    expect(await get(ctx)).toMatchObject({ state: "interrupted", resumes: true, message: INTERRUPTED_MESSAGE })
  })

  test("is running for a prompt the session has not taken up yet, from its inbox", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID).inbox.push({
      id: "msg_1",
      sessionID: ID,
      time: { created: service.clock.now },
      type: "user",
      payload: { text: "go" },
      delivery: "queue",
    })
    service.clock.now += SETTLING_MS - 1
    expect((await get(ctx)).state).toBe("running")
    service.clock.now += 1
    expect(await get(ctx)).toMatchObject({ state: "unknown", message: NO_TURN_MESSAGE })
  })

  test("is unknown for a session that holds no turn", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    expect(await get(ctx)).toMatchObject({ state: "unknown", message: NO_TURN_MESSAGE })
  })

  test("is waiting while the session, or a subagent, is paused on a request", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeAsk(service, ID, { action: "bash", resources: ["make"] })
    expect((await get(ctx)).state).toBe("waiting")

    const other = runSetup()
    boundRun(other.service, ID, { busy: other.service.clock.now, active: true })
    fakeEnd(other.service, ID, "succeeded")
    const child = fakeChild(other.service, ID)
    fakeAsk(other.service, child.id, { action: "edit", resources: ["a.ts"] })
    const result = await get(other.ctx)
    expect(result.state).toBe("waiting")
    expect(result.waiting_on).toEqual([
      { kind: "permission", id: expect.any(String), session: child.id, action: "edit", resources: ["a.ts"] },
    ])
  })
})

describe("get: the result", () => {
  test("is the text of the newest reply of the turn, with several text parts joined by a blank line", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeReply(service, ID, "first")
    const last = fakeReply(service, ID, "Part one.")
    last.content.push({ type: "text", text: "Part two." })
    fakeEnd(service, ID, "succeeded")
    expect((await get(ctx)).result).toBe("Part one.\n\nPart two.")
  })

  test("is given for a turn that is still running, from the replies it has so far", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeReply(service, ID, "Halfway.")
    expect(await get(ctx)).toMatchObject({ state: "running", result: "Halfway." })
  })

  test("is from the newest turn only: a reply of the turn before is not it", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeReply(service, ID, "old reply")
    fakeEnd(service, ID, "succeeded")
    service.clock.now += SECOND
    beginTurn(service, ID)
    fakeEnd(service, ID, "succeeded")
    expect(await get(ctx)).toMatchObject({ state: "completed" })
    expect(await get(ctx)).not.toHaveProperty("result")

    beginTurn(service, ID)
    fakeReply(service, ID, "new reply")
    fakeEnd(service, ID, "succeeded")
    expect((await get(ctx)).result).toBe("new reply")
  })

  test("is not the previous turn's while the next one has said nothing yet", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeReply(service, ID, "old reply")
    fakeEnd(service, ID, "succeeded")
    service.clock.now += SECOND
    beginTurn(service, ID)
    const running = await get(ctx)
    expect(running.state).toBe("running")
    expect(running).not.toHaveProperty("result")
  })

  test("skips a reply that has an error, and one that is not completed", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeReply(service, ID, "good")
    fakeReply(service, ID, "failed step").error = { type: "provider.error", message: "no" }
    delete fakeReply(service, ID, "unfinished").time.completed
    fakeEnd(service, ID, "failed", { type: "provider.error", message: "no" })
    expect((await get(ctx)).result).toBe("good")
  })

  test("is cut at 20,000 characters by code point, and says so", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeReply(service, ID, "😀".repeat(20_001))
    fakeEnd(service, ID, "succeeded")
    const result = await get(ctx)
    expect([...result.result!]).toHaveLength(20_000)
    expect(result.result_truncated).toBe(true)

    const exact = runSetup()
    begun(exact.service)
    fakeReply(exact.service, ID, "x".repeat(20_000))
    fakeEnd(exact.service, ID, "succeeded")
    const whole = await get(exact.ctx)
    expect(whole.result).toHaveLength(20_000)
    expect(whole).not.toHaveProperty("result_truncated")
  })

  test("is left out when the reply has no text", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeReply(service, ID, "x").content.length = 0
    fakeEnd(service, ID, "succeeded")
    expect(await get(ctx)).not.toHaveProperty("result")
  })

  test("is read with one page of 100 messages, newest first", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeEnd(service, ID, "succeeded")
    service.requests.length = 0
    await get(ctx)
    const page = service.requests.find((request) => request.path.endsWith("/message"))
    expect(page?.query).toEqual({ limit: "100", order: "desc" })
    expect(callsOf(service).filter((call) => call.endsWith("/message"))).toHaveLength(1)
  })
})

describe("get: the error of a failed turn", () => {
  test("is the idle message's, cleaned and cut", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeEnd(service, ID, "failed", { type: "provider.error\u0000", message: `bad\u202e\nthing ${"x".repeat(400)}` })
    const result = await get(ctx)
    expect(result.error?.type).toBe("provider.error")
    expect(result.error?.message).toStartWith("bad  thing xxx")
    expect([...result.error!.message]).toHaveLength(300)
  })

  test("is given for a failed turn only", async () => {
    const { service, ctx } = runSetup()
    begun(service)
    fakeEnd(service, ID, "interrupted", { type: "aborted", message: "stopped" })
    expect(await get(ctx)).not.toHaveProperty("error")
  })
})
