import { describe, expect, test } from "bun:test"
import { failure } from "../service/read.testing"
import { fakeQuestion, fakeReply, fakeSession } from "../service/testing"
import { RUN } from "./request.testing"
import {
  answer,
  answeredOf,
  approve,
  askShell,
  reject,
  replyRoute,
  replySetup,
  replyTo,
  serviceRefusal,
} from "./reply.testing"

const STATUS_500 = () => new Response(null, { status: 500 })

describe("a request that is gone when its reply arrives", () => {
  test("is gone, not a failure, when someone answered it between the read and the send", async () => {
    const { service, ctx } = replySetup()
    const taken = askShell(service, "echo hi")
    const kept = askShell(service, "echo ho")
    service.failNext(replyRoute(taken.id), () => {
      fakeSession(service, RUN).pending = fakeSession(service, RUN).pending.filter((request) => request.id !== taken.id)
      return serviceRefusal(404, "PermissionNotFoundError", `Permission request not found: ${taken.id}`)
    })
    const result = await replyTo([approve(taken.id, "echo hi"), approve(kept.id, "echo ho")], ctx)
    expect(result.replies).toEqual([
      { request: taken.id, decision: "once", outcome: "gone" },
      { request: kept.id, decision: "once", outcome: "sent" },
    ])
  })

  test("is gone for a question that was settled or cancelled meanwhile, answered or declined", async () => {
    const { service, ctx } = replySetup()
    const settled = fakeQuestion(service, RUN, "Which?")
    const missing = fakeQuestion(service, RUN, "And?")
    const cancelled = fakeQuestion(service, RUN, "Or?")
    service.failNext(replyRoute(settled.id), () => serviceRefusal(409, "FormAlreadySettledError", "settled"))
    service.failNext(replyRoute(missing.id), () => serviceRefusal(404, "FormNotFoundError", "no form"))
    service.failNext(replyRoute(cancelled.id), () => serviceRefusal(409, "FormAlreadySettledError", "settled"))
    const result = await replyTo(
      [answer(settled.id, { answer: "x" }), answer(missing.id, { answer: "y" }), reject(cancelled.id, "No.")],
      ctx,
    )
    expect(result.replies.map((reply) => reply.outcome)).toEqual(["gone", "gone", "gone"])
  })

  test("is gone for a second rejection of one step, which the first took along", async () => {
    const { service, ctx } = replySetup()
    const step = fakeReply(service, RUN, "Working")
    const first = askShell(service, "echo one", { step })
    const second = askShell(service, "echo two", { step })
    const result = await replyTo([reject(first.id, "No."), reject(second.id, "No.")], ctx)
    expect(result.replies.map((reply) => reply.outcome)).toEqual(["sent", "gone"])
    expect(result.also_rejected).toBeUndefined()
    expect(answeredOf(service)).toHaveLength(2)
  })

  test("is no failure of the call: the sends after it go on", async () => {
    const { service, ctx } = replySetup()
    const [a, b, c] = ["echo a", "echo b", "echo c"].map((command) => askShell(service, command))
    service.failNext(replyRoute(a!.id), () => serviceRefusal(404, "PermissionNotFoundError", "gone"))
    const result = await replyTo([approve(a!.id, "echo a"), approve(b!.id, "echo b"), reject(c!.id)], ctx)
    expect(result.replies.map((reply) => reply.outcome)).toEqual(["gone", "sent", "sent"])
  })
})

describe("a send that fails", () => {
  test("is failed with its code and message, and no later reply is sent", async () => {
    const { service, ctx } = replySetup()
    const [a, b, c, d] = ["echo a", "echo b", "echo c", "echo d"].map((command) => askShell(service, command))
    service.failNext(replyRoute(b!.id), STATUS_500)
    const result = await replyTo(
      [approve(a!.id, "echo a"), approve(b!.id, "echo b"), approve(c!.id, "echo c"), reject(d!.id)],
      ctx,
    )
    expect(result.replies).toEqual([
      { request: a!.id, decision: "once", outcome: "sent" },
      {
        request: b!.id,
        decision: "once",
        outcome: "failed",
        error: { code: "upstream_error", message: "The OpenCode service answered with status 500." },
      },
      { request: c!.id, decision: "once", outcome: "not_sent" },
      { request: d!.id, decision: "reject", outcome: "not_sent" },
    ])
    expect(answeredOf(service).map((write) => write.id)).toEqual([a!.id, b!.id])
    expect(fakeSession(service, RUN).pending.map((request) => request.id)).toEqual([b!.id, c!.id, d!.id])
  })

  test("is failed, with the service's words, for an answer a form refuses", async () => {
    const { service, ctx } = replySetup()
    const [a, b] = ["echo a", "echo b"].map((command) => askShell(service, command))
    const form = fakeQuestion(service, RUN, "Which?")
    service.failNext(replyRoute(form.id), () =>
      serviceRefusal(400, "FormInvalidAnswerError", "Invalid pattern: answer"),
    )
    const result = await replyTo([approve(a!.id, "echo a"), answer(form.id, { answer: "x" }), reject(b!.id)], ctx)
    expect(result.replies.map((reply) => reply.outcome)).toEqual(["sent", "failed", "not_sent"])
    expect(result.replies[1]!.error).toEqual({
      code: "invalid_argument",
      message: "The OpenCode service refused the request: Invalid pattern: answer",
    })
  })

  test("is the call's own error when it is the first send attempted", async () => {
    const { service, ctx } = replySetup()
    const [a, b] = ["echo a", "echo b"].map((command) => askShell(service, command))
    service.failNext(replyRoute(a!.id), STATUS_500)
    const error = await failure(replyTo([approve(a!.id, "echo a"), approve(b!.id, "echo b")], ctx))
    expect([error.code, error.message]).toEqual(["upstream_error", "The OpenCode service answered with status 500."])
    expect(answeredOf(service).map((write) => write.id)).toEqual([a!.id])
    expect(fakeSession(service, RUN).answers).toEqual([])
  })

  test("is a result, not the call's error, when an earlier send found its request gone", async () => {
    const { service, ctx } = replySetup()
    const [a, b, c] = ["echo a", "echo b", "echo c"].map((command) => askShell(service, command))
    service.failNext(replyRoute(a!.id), () => serviceRefusal(404, "PermissionNotFoundError", "gone"))
    service.failNext(replyRoute(b!.id), STATUS_500)
    const result = await replyTo([approve(a!.id, "echo a"), approve(b!.id, "echo b"), approve(c!.id, "echo c")], ctx)
    expect(result.replies.map((reply) => reply.outcome)).toEqual(["gone", "failed", "not_sent"])
  })
})

describe("a call that is cancelled", () => {
  test("rethrows the cancellation from the first send, as no outcome", async () => {
    const controller = new AbortController()
    const { service, ctx } = replySetup({ signal: controller.signal })
    const a = askShell(service, "echo a")
    service.failNext(replyRoute(a.id), () => {
      controller.abort()
      return new Response(null, { status: 204 })
    })
    const error = await replyTo([approve(a.id, "echo a")], ctx).then(
      () => undefined,
      (thrown: unknown) => thrown as Error,
    )
    expect(error?.name).toBe("AbortError")
  })

  test("rethrows it from a later send too, whatever was sent before", async () => {
    const controller = new AbortController()
    const { service, ctx } = replySetup({ signal: controller.signal })
    const [a, b, c] = ["echo a", "echo b", "echo c"].map((command) => askShell(service, command))
    service.failNext(replyRoute(b!.id), () => {
      controller.abort()
      return STATUS_500()
    })
    const error = await replyTo(
      [approve(a!.id, "echo a"), approve(b!.id, "echo b"), approve(c!.id, "echo c")],
      ctx,
    ).then(
      () => undefined,
      (thrown: unknown) => thrown as Error,
    )
    expect(error?.name).toBe("AbortError")
    expect(fakeSession(service, RUN).answers.map((entry) => entry.id)).toEqual([a!.id])
  })
})
