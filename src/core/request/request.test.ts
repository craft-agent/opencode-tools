import { afterEach, describe, expect, test } from "bun:test"
import type { SessionMessageAssistant } from "@opencode/client"
import { cleanup } from "../run/git.testing"
import { afterSleeps, readRun } from "../run/read.testing"
import { startSetup, startWrite } from "../run/start.testing"
import { fakeEnd, fakeQuestions, fakeReply, fakeSession, fakeToolAsk } from "../service/testing"
import { readRequests } from "./read.testing"
import { answer, askShell, reject, replyTo } from "./reply.testing"

afterEach(cleanup)

const COMMAND = "echo hi > note.txt && git switch -c topic"

async function pausedRun() {
  const setup = await startSetup()
  const started = await startWrite({ role: "build", brief: "Make the change." }, setup.ctx)
  return { ...setup, session: started.session }
}

describe("a run from its request to its answer", () => {
  test("a write run pauses on a request, which is read whole, approved once, and the run goes on", async () => {
    const { service, runtime, ctx, directory, session } = await pausedRun()
    const asked = fakeToolAsk(service, session, {
      tool: "shell",
      input: { command: COMMAND, workdir: directory },
      action: "shell",
      resources: ["echo hi > note.txt", "git switch -c topic"],
    })
    expect((await readRun({ method: "get", session }, ctx)).state).toBe("waiting")

    const listed = await readRequests({ method: "list", session }, ctx)
    expect(listed.requests).toMatchObject([
      { kind: "permission", id: asked.id, text: COMMAND, resources: ["echo hi > note.txt", "git switch -c topic"] },
    ])

    // The turn ends while the reply waits for the run's next state.
    afterSleeps(runtime, (sleeps) => {
      if (sleeps !== 1) return
      fakeReply(service, session, "Done.")
      fakeEnd(service, session, "succeeded")
    })
    const replied = await replyTo([{ request: asked.id, decision: "once", text: COMMAND }], ctx, session)
    expect(replied.replies).toMatchObject([{ request: asked.id, outcome: "sent" }])
    expect(replied.run).toMatchObject({ state: "completed", result: "Done." })

    const fake = fakeSession(service, session)
    expect(fake.answers).toEqual([{ kind: "permission", id: asked.id, decision: "once" }])
    expect(fake.pending).toEqual([])
  })

  test("a rejected request carries its reason to the run, and takes the other request of its step", async () => {
    const { service, ctx, session } = await pausedRun()
    const first = askShell(service, "git switch -c one", { session })
    const step = fakeSession(service, session).messages.find((message) => message.type === "assistant")
    const second = askShell(service, "git switch -c two", { session, step: step as SessionMessageAssistant })

    const replied = await replyTo([reject(first.id, "One branch is enough.")], ctx, session)
    expect(replied.replies).toMatchObject([{ request: first.id, decision: "reject", outcome: "sent" }])
    expect(replied.also_rejected).toEqual([second.id])

    const message = "One branch is enough."
    expect(fakeSession(service, session).answers).toEqual([
      { kind: "permission", id: first.id, decision: "reject", message },
      { kind: "permission", id: second.id, decision: "reject", message, along: true },
    ])
    expect(service.state.active).toContain(session)
  })

  test("a question is answered by field, and one declined carries its reason", async () => {
    const { service, ctx, session } = await pausedRun()
    const form = fakeQuestions(service, session, [
      { header: "Colour", question: "Which colour?", options: ["Red", "Blue"] },
    ])

    const listed = await readRequests({ method: "list", session }, ctx)
    expect(listed.requests).toMatchObject([
      {
        kind: "question",
        id: form.id,
        fields: [{ key: "q0", description: "Which colour?", options: [{ value: "Red" }, { value: "Blue" }] }],
      },
    ])

    const answered = await replyTo([answer(form.id, { q0: "Blue" })], ctx, session)
    expect(answered.replies).toMatchObject([{ request: form.id, outcome: "sent" }])

    const other = fakeQuestions(service, session, [{ header: "Size", question: "Which size?", options: ["S", "L"] }])
    const declined = await replyTo([reject(other.id, "Decide it yourself.")], ctx, session)
    expect(declined.replies).toMatchObject([{ request: other.id, outcome: "sent" }])

    expect(fakeSession(service, session).answers).toEqual([
      { kind: "form", id: form.id, answer: { q0: "Blue" } },
      { kind: "cancel", id: other.id, message: "Decide it yourself." },
    ])
  })
})
