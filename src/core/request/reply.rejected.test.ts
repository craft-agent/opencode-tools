import { describe, expect, test } from "bun:test"
import { fakeAsk, fakeChild, fakeQuestion, fakeReply, fakeSession } from "../service/testing"
import type { PendingPermission } from "./pending"
import { planReplies } from "./reply.plan"
import { alsoRejectedOf } from "./reply.rejected"
import type { ReplyInput, ReplyResult } from "./reply.schemas"
import {
  approve,
  askShell,
  permissionPending,
  questionPending,
  reject,
  replyRoute,
  replySetup,
  replyTo,
  serviceRefusal,
} from "./reply.testing"
import { RUN } from "./request.testing"

describe("also_rejected of a call", () => {
  test("lists an unnamed request of the step a sent rejection took along", async () => {
    const { service, ctx } = replySetup()
    const step = fakeReply(service, RUN, "Working")
    const first = askShell(service, "echo one", { step })
    const second = askShell(service, "echo two", { step })
    const result = await replyTo([reject(first.id)], ctx)
    expect(result.also_rejected).toEqual([second.id])
    expect(fakeSession(service, RUN).answers.map((entry) => entry.id)).toEqual([first.id, second.id])
  })

  test("leaves out a request of another step, which stays pending", async () => {
    const { service, ctx } = replySetup()
    const step = fakeReply(service, RUN, "Working")
    const first = askShell(service, "echo one", { step })
    const taken = askShell(service, "echo two", { step })
    const other = askShell(service, "echo three")
    const result = await replyTo([reject(first.id)], ctx)
    expect(result.also_rejected).toEqual([taken.id])
    expect(fakeSession(service, RUN).pending.map((request) => request.id)).toEqual([other.id])
    expect(result.run!.state).toBe("waiting")
  })

  test("leaves out a request the call approved first, and one it named", async () => {
    const { service, ctx } = replySetup()
    const step = fakeReply(service, RUN, "Working")
    const first = askShell(service, "echo one", { step })
    const approved = askShell(service, "echo two", { step })
    const named = askShell(service, "echo three", { step })
    const result = await replyTo([reject(first.id), approve(approved.id, "echo two"), reject(named.id)], ctx)
    expect(result.replies.map((reply) => reply.outcome)).toEqual(["sent", "sent", "gone"])
    expect(result).not.toHaveProperty("also_rejected")
  })

  test("counts requests that name no step, in one session, as one step", async () => {
    const { service, ctx } = replySetup()
    const first = fakeAsk(service, RUN, { action: "shell", resources: ["echo one"] })
    const second = fakeAsk(service, RUN, { action: "shell", resources: ["echo two"] })
    const child = fakeChild(service, RUN)
    const theirs = fakeAsk(service, child.id, { action: "shell", resources: ["echo three"] })
    const result = await replyTo([reject(first.id)], ctx)
    expect(result.also_rejected).toEqual([second.id])
    expect(fakeSession(service, child.id).pending.map((request) => request.id)).toEqual([theirs.id])
  })

  test("leaves out a step of another session, whatever its message is called", async () => {
    const { service, ctx } = replySetup()
    const child = fakeChild(service, RUN)
    const first = askShell(service, "echo one")
    const theirs = askShell(service, "echo two", { session: child.id })
    const result = await replyTo([reject(first.id)], ctx)
    expect(result).not.toHaveProperty("also_rejected")
    expect(fakeSession(service, child.id).pending.map((request) => request.id)).toEqual([theirs.id])
  })

  test("is left out when the rejection was not sent, since it took nothing", async () => {
    const { service, ctx } = replySetup()
    const step = fakeReply(service, RUN, "Working")
    const first = askShell(service, "echo one", { step })
    const second = askShell(service, "echo two", { step })
    service.failNext(replyRoute(first.id), () => serviceRefusal(404, "PermissionNotFoundError", "gone"))
    const result = await replyTo([reject(first.id)], ctx)
    expect(result.replies[0]!.outcome).toBe("gone")
    expect(result).not.toHaveProperty("also_rejected")
    expect(fakeSession(service, RUN).pending.map((request) => request.id)).toEqual([first.id, second.id])
  })

  test("is left out for a declined question, which has no step", async () => {
    const { service, ctx } = replySetup()
    const form = fakeQuestion(service, RUN, "Which?")
    askShell(service, "echo one")
    const result = await replyTo([reject(form.id)], ctx)
    expect(result).not.toHaveProperty("also_rejected")
  })
})

describe("alsoRejectedOf", () => {
  const asking = (id: string, step?: string, session?: string) =>
    permissionPending({ id, ...(step !== undefined && { step }), ...(session !== undefined && { session }), text: id })
  const sent: ReplyResult = { request: "a", decision: "reject", outcome: "sent" }
  const planOf = (pending: PendingPermission[], replies: ReplyInput[]) => planReplies(replies, pending)

  test("is the requests of the step that the first look no longer finds, in the order they were pending", () => {
    const before = [asking("a", "s1"), asking("b", "s1"), asking("c", "s2"), asking("d", "s1")]
    const plan = planOf(before, [reject("a")] as ReplyInput[])
    expect(alsoRejectedOf(plan, [sent], before, new Set(["c"]))).toEqual(["b", "d"])
    expect(alsoRejectedOf(plan, [sent], before, new Set(["c", "b", "d"]))).toEqual([])
  })

  test("counts only the rejections that were sent, of permission requests", () => {
    const before = [asking("a", "s1"), asking("b", "s1")]
    const plan = planOf(before, [reject("a")] as ReplyInput[])
    for (const outcome of ["gone", "failed", "not_sent"] as const) {
      expect(alsoRejectedOf(plan, [{ ...sent, outcome }], before, new Set())).toEqual([])
    }
    const question = questionPending({ id: "q" })
    const asked = planReplies([reject("q")] as ReplyInput[], [question, ...before])
    expect(alsoRejectedOf(asked, [{ ...sent, request: "q" }], [question, ...before], new Set())).toEqual([])
  })

  test("takes the steps of several rejections, and never a request the call named", () => {
    const before = [asking("a", "s1"), asking("b", "s2"), asking("c", "s1"), asking("d", "s2"), asking("e", "s3")]
    const plan = planOf(before, [reject("a"), approve("d", "d"), reject("b")] as ReplyInput[])
    const results: ReplyResult[] = [
      { request: "a", decision: "reject", outcome: "sent" },
      { request: "d", decision: "once", outcome: "sent" },
      { request: "b", decision: "reject", outcome: "sent" },
    ]
    expect(alsoRejectedOf(plan, results, before, new Set(["e"]))).toEqual(["c"])
  })

  test("shares a step between requests of one session with none, and not between sessions", () => {
    const before = [asking("a"), asking("b"), asking("c", undefined, "child"), asking("d", "s1")]
    const plan = planOf(before, [reject("a")] as ReplyInput[])
    expect(alsoRejectedOf(plan, [sent], before, new Set())).toEqual(["b"])
  })
})
