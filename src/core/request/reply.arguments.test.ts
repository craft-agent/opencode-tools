import { describe, expect, test } from "bun:test"
import { failure } from "../service/read.testing"
import { fakeSession } from "../service/testing"
import { MAX_ID } from "../service/schemas"
import { invoke } from "../tool"
import { MAX_REASON, MAX_REPLIES } from "./reply.schemas"
import { askShell, reject, replySetup, replyTo } from "./reply.testing"
import { opencodeRequestReply } from "./reply.tool"
import { RUN } from "./request.testing"

const REPLY = { request: "req_1", decision: "reject", reason: "No." }

describe("the arguments", () => {
  const refused: [string, Record<string, unknown>][] = [
    ["no session", { replies: [REPLY] }],
    ["an empty session", { session: "", replies: [REPLY] }],
    ["a session over the id limit", { session: "s".repeat(MAX_ID + 1), replies: [REPLY] }],
    ["no replies", { session: RUN }],
    ["an empty list of replies", { session: RUN, replies: [] }],
    ["more replies than a call takes", { session: RUN, replies: Array.from({ length: MAX_REPLIES + 1 }, () => REPLY) }],
    ["an unknown argument", { session: RUN, replies: [REPLY], colour: "red" }],
    ["an unknown property of a reply", { session: RUN, replies: [{ ...REPLY, always: true }] }],
    ["a reply without a request", { session: RUN, replies: [{ decision: "reject", reason: "No." }] }],
    ["a reply without a decision", { session: RUN, replies: [{ request: "req_1" }] }],
    ["a decision that is none of the three", { session: RUN, replies: [{ ...REPLY, decision: "always" }] }],
    ["an empty request", { session: RUN, replies: [{ ...REPLY, request: "" }] }],
    ["a reason over the limit", { session: RUN, replies: [{ ...REPLY, reason: "r".repeat(MAX_REASON + 1) }] }],
    ["a text that is not text", { session: RUN, replies: [{ request: "req_1", decision: "once", text: 1 }] }],
    [
      "an answer whose value is an object",
      { session: RUN, replies: [{ request: "req_1", decision: "answer", answer: { a: { b: 1 } } }] },
    ],
    [
      "an answer whose list holds a number",
      { session: RUN, replies: [{ request: "req_1", decision: "answer", answer: { a: [1] } }] },
    ],
  ]

  test.each(refused)("%s: invalid_argument, before any service is contacted", async (_name, args) => {
    const { service, runtime, ctx } = replySetup({ runtime: { running: false } })
    const error = await failure(invoke(opencodeRequestReply, args, ctx))
    expect(error.code).toBe("invalid_argument")
    expect(service.requests).toEqual([])
    expect(runtime.started).toEqual([])
  })

  test("takes as many replies as the limit, and a reason of exactly its limit", async () => {
    const { service, ctx } = replySetup()
    const reason = "r".repeat(MAX_REASON)
    const asked = Array.from({ length: MAX_REPLIES }, (_, index) => askShell(service, `echo ${index}`))
    const result = await replyTo(
      asked.map((request) => reject(request.id, reason)),
      ctx,
    )
    expect(result.replies).toHaveLength(MAX_REPLIES)
    expect(fakeSession(service, RUN).answers[0]).toMatchObject({ message: reason })
  })

  test("names the argument that is wrong", async () => {
    const { ctx } = replySetup()
    const error = await failure(
      invoke(opencodeRequestReply, { session: RUN, replies: [{ ...REPLY, always: true }] }, ctx),
    )
    expect(error.message).toContain("replies.0")
    expect(error.message).toContain("unknown argument")
  })
})
