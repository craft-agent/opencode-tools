import { describe, expect, test } from "bun:test"
import { fakeChild, fakeQuestion, fakeQuestions, fakeReply, fakeSession, fakeToolAsk } from "../service/testing"
import { answer, answeredOf, approve, askShell, reject, replySetup, replyTo } from "./reply.testing"
import { RUN, SWITCH } from "./request.testing"

describe("what is sent", () => {
  test("an approval is answered once, with no message", async () => {
    const { service, ctx } = replySetup()
    const asked = fakeToolAsk(service, RUN, {
      tool: "shell",
      input: SWITCH,
      action: "shell",
      resources: ["git switch -c topic"],
    })
    const result = await replyTo([approve(asked.id, "git switch -c topic")], ctx)
    expect(result.replies).toEqual([{ request: asked.id, decision: "once", outcome: "sent" }])
    expect(fakeSession(service, RUN).answers).toEqual([{ kind: "permission", id: asked.id, decision: "once" }])
    expect(fakeSession(service, RUN).pending).toEqual([])
  })

  test("a rejection is answered with its reason, trimmed, as the message", async () => {
    const { service, ctx } = replySetup()
    const asked = askShell(service, "echo hi")
    await replyTo([reject(asked.id, "  Run the tests first.\n")], ctx)
    expect(fakeSession(service, RUN).answers).toEqual([
      { kind: "permission", id: asked.id, decision: "reject", message: "Run the tests first." },
    ])
  })

  test("an answer is sent to the question, by field", async () => {
    const { service, ctx } = replySetup()
    const form = fakeQuestions(service, RUN, [
      { header: "Branch", question: "Which?", options: ["main", "dev"] },
      { header: "Checks", question: "Which?", options: ["unit", "lint"], multiple: true },
    ])
    const result = await replyTo([answer(form.id, { q0: "dev", q1: ["unit", "mine"] })], ctx)
    expect(result.replies).toEqual([{ request: form.id, decision: "answer", outcome: "sent" }])
    expect(fakeSession(service, RUN).answers).toEqual([
      { kind: "form", id: form.id, answer: { q0: "dev", q1: ["unit", "mine"] } },
    ])
  })

  test("a declined question is cancelled with its reason, and the run goes on", async () => {
    const { service, ctx } = replySetup()
    const form = fakeQuestion(service, RUN, "Which branch?")
    const result = await replyTo([reject(form.id, "I cannot choose for you.")], ctx)
    expect(result.replies).toEqual([{ request: form.id, decision: "reject", outcome: "sent" }])
    expect(fakeSession(service, RUN).answers).toEqual([
      { kind: "cancel", id: form.id, message: "I cannot choose for you." },
    ])
    expect(service.state.active).toContain(RUN)
    expect(result.run!.state).toBe("running")
  })

  test("each reply goes to the session that asked, a subagent's through its own route", async () => {
    const { service, ctx } = replySetup()
    const child = fakeChild(service, RUN)
    const own = askShell(service, "echo hi")
    const theirs = askShell(service, "npx cowsay hi", { session: child.id })
    const form = fakeQuestion(service, child.id, "Which?")
    const result = await replyTo(
      [approve(theirs.id, "npx cowsay hi"), approve(own.id, "echo hi"), answer(form.id, { answer: "this" })],
      ctx,
    )
    expect(result.replies.map((reply) => reply.outcome)).toEqual(["sent", "sent", "sent"])
    expect(answeredOf(service)).toEqual([
      { session: child.id, id: theirs.id },
      { session: RUN, id: own.id },
      { session: child.id, id: form.id },
    ])
    expect(fakeSession(service, child.id).answers.map((entry) => entry.id)).toEqual([theirs.id, form.id])
    expect(fakeSession(service, RUN).answers.map((entry) => entry.id)).toEqual([own.id])
  })
})

describe("the order", () => {
  test("is every approval and answer, then every rejection, each as given; the result is as given", async () => {
    const { service, ctx } = replySetup()
    const [a, b, d] = ["echo a", "echo b", "echo d"].map((command) => askShell(service, command))
    const form = fakeQuestion(service, RUN, "Which?")
    const c = askShell(service, "echo c")
    const result = await replyTo(
      [
        reject(a!.id),
        approve(b!.id, "echo b"),
        reject(c.id),
        answer(form.id, { answer: "x" }),
        approve(d!.id, "echo d"),
      ],
      ctx,
    )
    expect(answeredOf(service).map((write) => write.id)).toEqual([b!.id, form.id, d!.id, a!.id, c.id])
    expect(result.replies.map((reply) => [reply.request, reply.decision])).toEqual([
      [a!.id, "reject"],
      [b!.id, "once"],
      [c.id, "reject"],
      [form.id, "answer"],
      [d!.id, "once"],
    ])
  })

  test("lets an approval be sent before a rejection that takes its step along", async () => {
    const { service, ctx } = replySetup()
    const step = fakeReply(service, RUN, "Working")
    const first = askShell(service, "echo one", { step })
    const second = askShell(service, "echo two", { step })
    const result = await replyTo([reject(first.id), approve(second.id, "echo two")], ctx)
    expect(result.replies.map((reply) => reply.outcome)).toEqual(["sent", "sent"])
    expect(fakeSession(service, RUN).answers).toEqual([
      { kind: "permission", id: second.id, decision: "once" },
      { kind: "permission", id: first.id, decision: "reject", message: "Not now." },
    ])
  })
})
