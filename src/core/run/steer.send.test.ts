import { describe, expect, test } from "bun:test"
import { serviceRefusal } from "../request/reply.testing"
import { failure } from "../service/read.testing"
import { fakeAsk, fakeChild, fakeEnd, fakeSession, fakeStep } from "../service/testing"
import { afterRequest, liveRun, RUN, steerTo, writesOf } from "./control.testing"
import { requestsTo } from "./read.testing"

const MESSAGE = "Use the other module."
const PROMPT = /\/prompt$/
const INBOX = /\/inbox$/
/** The write that sends the message to the run's session, as `writesOf` lists it. */
const SENT = `POST /api/session/${RUN}/prompt`

describe("a steer to a running turn", () => {
  test("is sent once as a steer that starts no turn, under an id made here, and is read at the next step", async () => {
    const { service, ctx } = liveRun()
    const result = await steerTo(MESSAGE, ctx)
    expect(result).toMatchObject({ service_started: false, session: RUN, when: "next_step" })
    expect(result.run).toMatchObject({ state: "running", role: "plan", directory: "/work/acme" })
    expect(Object.keys(result).sort()).toEqual(["run", "service_started", "session", "when"])
    expect(result.run).not.toHaveProperty("session")

    const prompts = requestsTo(service, "/prompt")
    expect(prompts).toHaveLength(1)
    expect(prompts[0]!.path).toBe(`/api/session/${RUN}/prompt`)
    expect(prompts[0]!.body).toMatchObject({ text: MESSAGE, delivery: "steer", resume: false })
    const { id } = prompts[0]!.body as { id: string }
    expect(id).toMatch(/^msg_[0-9a-f]{32}$/)

    const session = fakeSession(service, RUN)
    expect(session.messages).toEqual([])
    expect(session.inbox.map((item) => item.id)).toEqual([id])
    expect(fakeStep(service, RUN)).toMatchObject([{ id, type: "user", text: MESSAGE }])
    expect(writesOf(service)).toEqual([SENT])
  })

  test("is after_request when the run's own session is paused on a request, which the run lists", async () => {
    const { service, ctx } = liveRun()
    const asked = fakeAsk(service, RUN, { action: "shell", resources: ["echo hi"] })
    const result = await steerTo(MESSAGE, ctx)
    expect(result.when).toBe("after_request")
    expect(result.run).toMatchObject({ state: "waiting", waiting_on: [{ id: asked.id, session: RUN }] })
  })

  test("is next_step when only a subagent's session is paused on a request", async () => {
    const { service, ctx } = liveRun()
    const child = fakeChild(service, RUN)
    fakeAsk(service, child.id, { action: "shell", resources: ["echo hi"] })
    const result = await steerTo(MESSAGE, ctx)
    expect(result.when).toBe("next_step")
    expect(result.run!.state).toBe("waiting")
  })

  test("goes to the run's own session when only a subagent is active", async () => {
    const { service, ctx } = liveRun()
    const child = fakeChild(service, RUN)
    fakeEnd(service, RUN, "succeeded")
    const result = await steerTo(MESSAGE, ctx)
    expect(result).toMatchObject({ when: "next_step", run: { state: "running" } })
    expect(writesOf(service)).toEqual([SENT])
    expect(fakeSession(service, child.id).inbox).toEqual([])
  })
})

describe("a steer the run read before the call looked", () => {
  test("is read when the session took its step first", async () => {
    const { service, runtime, ctx } = liveRun()
    afterRequest(runtime, "POST", PROMPT, () => fakeStep(service, RUN))
    const result = await steerTo(MESSAGE, ctx)
    expect(result).toMatchObject({ when: "read", run: { state: "running" } })
    expect(writesOf(service)).toEqual([SENT])
  })

  test("is read when the run took it and the turn ended before the look, and nothing is withdrawn", async () => {
    const { service, runtime, ctx } = liveRun()
    afterRequest(runtime, "POST", PROMPT, () => {
      fakeStep(service, RUN)
      fakeEnd(service, RUN, "succeeded")
    })
    const result = await steerTo(MESSAGE, ctx)
    expect(result).toMatchObject({ when: "read", run: { state: "completed" } })
    expect(writesOf(service)).toEqual([SENT])
  })

  test("is read when the run took it between the look and the withdrawal", async () => {
    const { service, runtime, ctx } = liveRun()
    afterRequest(runtime, "GET", INBOX, () => {
      fakeStep(service, RUN)
      fakeEnd(service, RUN, "succeeded")
    })
    const result = await steerTo(MESSAGE, ctx)
    expect(result.when).toBe("read")
    expect(writesOf(service)).toHaveLength(2)
    expect(writesOf(service)[1]).toStartWith(`DELETE /api/session/${RUN}/inbox/msg_`)
  })
})

describe("a steer whose turn ended before the run read it", () => {
  test("is withdrawn and refused as a run that is not running, with no turn started", async () => {
    const { service, runtime, ctx } = liveRun()
    afterRequest(runtime, "POST", PROMPT, () => fakeEnd(service, RUN, "succeeded"))
    const error = await failure(steerTo(MESSAGE, ctx))
    expect([error.code, error.details]).toEqual(["invalid_argument", { reason: "not_running" }])
    expect(error.message).toBe(
      `Session ${RUN} ended its turn before it read the message, which was withdrawn; a steer needs a turn in flight.`,
    )

    const { id } = requestsTo(service, "/prompt")[0]!.body as { id: string }
    expect(writesOf(service)).toEqual([SENT, `DELETE /api/session/${RUN}/inbox/${id}`])
    const session = fakeSession(service, RUN)
    expect(session.inbox).toEqual([])
    expect(session.messages.map((message) => message.type)).toEqual(["idle"])
    expect(service.state.active).toEqual([])
  })
})

describe("a steer whose admission is open", () => {
  test("fails as upstream_error that says it could not be confirmed and to read the run first", async () => {
    const { service, ctx } = liveRun()
    service.failNext(PROMPT, new Response(null, { status: 500 }))
    const error = await failure(steerTo(MESSAGE, ctx))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(
      "The steer's admission could not be confirmed (The OpenCode service answered with status 500.). Read the run before sending the message again.",
    )
  })

  test("fails as it is when the service refuses the message", async () => {
    const { service, ctx } = liveRun()
    service.failNext(PROMPT, serviceRefusal(400, "InvalidRequestError", "bad text"))
    const error = await failure(steerTo(MESSAGE, ctx))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).not.toContain("could not be confirmed")
  })

  test("says that the steer was sent when the look that follows fails", async () => {
    const { service, ctx } = liveRun()
    service.failNext(INBOX, new Response(null, { status: 500 }))
    const error = await failure(steerTo(MESSAGE, ctx))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("The steer was sent, but whether the run read it could not be confirmed")
    expect(error.message).toContain("Read the run before sending the message again.")
    expect(requestsTo(service, "/prompt")).toHaveLength(1)
  })
})

describe("the run after the steer", () => {
  test("is run_error, with the rest of the result, when the run cannot be read", async () => {
    const { service, runtime, ctx } = liveRun()
    afterRequest(runtime, "POST", PROMPT, () => {
      fakeStep(service, RUN)
      service.failNext("/api/session/active", new Response(null, { status: 500 }))
    })
    const result = await steerTo(MESSAGE, ctx)
    expect(result).toMatchObject({
      session: RUN,
      when: "read",
      run_error: { code: "upstream_error", message: "The OpenCode service answered with status 500." },
    })
    expect(result).not.toHaveProperty("run")
  })
})
