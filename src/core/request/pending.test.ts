import { describe, expect, test } from "bun:test"
import type { Rule } from "../run/rule"
import { failure } from "../service/read.testing"
import { SESSION_NOT_FOUND } from "../service/errors"
import { fakeAsk, fakeChild, fakeQuestion, fakeReply, fakeToolAsk } from "../service/testing"
import { RUN, SWITCH, messageReadsOf, pendingIn, requestSetup } from "./request.testing"

const sessionMissing = (id: string) =>
  new Response(JSON.stringify({ _tag: "SessionNotFoundError", sessionID: id, message: "gone" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  })

describe("pendingOf: what is asked, and by whom", () => {
  test("lists the run's own requests and questions first, then a subagent's, each in the service's order", async () => {
    const setup = requestSetup()
    const child = fakeChild(setup.service, RUN)
    fakeAsk(setup.service, child.id, { action: "edit", resources: ["c.ts"] })
    fakeQuestion(setup.service, RUN, "Which?")
    fakeAsk(setup.service, RUN, { action: "shell", resources: ["echo hi"] })
    fakeQuestion(setup.service, child.id, "And you?")
    const pending = await pendingIn(setup.ctx)
    expect(pending.map((request) => [request.kind, request.session, request.subagent])).toEqual([
      ["permission", RUN, false],
      ["question", RUN, false],
      ["permission", child.id, true],
      ["question", child.id, true],
    ])
  })

  test("asks the run's own session even when the service is running nothing of the run", async () => {
    const setup = requestSetup({}, { active: false })
    fakeAsk(setup.service, RUN, { action: "shell", resources: ["echo hi"] })
    expect(await pendingIn(setup.ctx)).toHaveLength(1)
    expect(await pendingIn(requestSetup({}, { active: false }).ctx)).toEqual([])
  })

  test("gives the agent of the session that asked", async () => {
    const setup = requestSetup()
    const child = fakeChild(setup.service, RUN)
    child.agent = "scout"
    fakeAsk(setup.service, RUN, { action: "shell", resources: ["echo hi"] })
    fakeQuestion(setup.service, child.id, "Which?")
    const [own, theirs] = await pendingIn(setup.ctx)
    expect(own).toMatchObject({ agent: "plan", subagent: false })
    expect(theirs).toMatchObject({ kind: "question", agent: "scout", subagent: true })
  })

  test("reads a subagent's session once, and the run's own once", async () => {
    const setup = requestSetup()
    const child = fakeChild(setup.service, RUN)
    fakeQuestion(setup.service, child.id, "Which?")
    await pendingIn(setup.ctx)
    const sessionReads = (id: string) =>
      setup.service.requests.filter((request) => request.method === "GET" && request.path === `/api/session/${id}`)
    expect(sessionReads(child.id)).toHaveLength(1)
    expect(sessionReads(RUN)).toHaveLength(1)
  })

  test("reads a subagent's call from the subagent's messages", async () => {
    const setup = requestSetup()
    const child = fakeChild(setup.service, RUN)
    const request = fakeToolAsk(setup.service, child.id, {
      tool: "shell",
      input: SWITCH,
      action: "shell",
      resources: ["git switch -c topic"],
    })
    const [pending] = await pendingIn(setup.ctx)
    expect(pending).toMatchObject({
      kind: "permission",
      id: request.id,
      session: child.id,
      action: "shell",
      resources: ["git switch -c topic"],
      tool: "shell",
      step: request.source!.messageID,
      text: "git switch -c topic",
    })
    expect(messageReadsOf(setup.service, child.id)).toEqual([request.source!.messageID])
    expect(messageReadsOf(setup.service, RUN)).toEqual([])
  })

  test("has the question's title and fields, and the permission's message and files", async () => {
    const setup = requestSetup()
    const form = fakeQuestion(setup.service, RUN, "Which branch?", [
      { key: "b", type: "string", options: [{ value: "main", label: "Main" }] },
    ])
    const files = [{ file: "a.ts", patch: "@@", status: "modified", additions: 1, deletions: 0 }]
    fakeAsk(setup.service, RUN, { action: "edit", resources: ["a.ts"], message: "Edit a.ts", metadata: { files } })
    const [permission, question] = await pendingIn(setup.ctx)
    expect(permission).toMatchObject({ message: "Edit a.ts", files, text: "a.ts" })
    expect(question).toEqual({
      kind: "question",
      id: form.id,
      session: RUN,
      subagent: false,
      agent: "plan",
      title: "Which branch?",
      fields: [{ key: "b", type: "string", options: [{ value: "main", label: "Main" }] }],
    })
  })
})

describe("pendingOf: the text of a request", () => {
  test("is the whole command of a shell call, and another call's arguments as JSON", async () => {
    const setup = requestSetup()
    const pipeline = "cd src && echo hi | npx cowsay hi"
    fakeToolAsk(setup.service, RUN, {
      tool: "shell",
      input: { command: pipeline },
      action: "shell",
      resources: ["cd src", "echo hi", "npx cowsay hi"],
    })
    fakeToolAsk(setup.service, RUN, {
      tool: "write",
      input: { file: "a.ts", content: "x" },
      action: "edit",
      resources: ["a.ts"],
    })
    const [shell, edit] = await pendingIn(setup.ctx)
    expect(shell).toMatchObject({ text: pipeline, resources: ["cd src", "echo hi", "npx cowsay hi"] })
    expect(edit).toMatchObject({ tool: "write", text: '{"file":"a.ts","content":"x"}' })
  })

  test("reads the message of two requests of one step once", async () => {
    const setup = requestSetup()
    const step = fakeReply(setup.service, RUN, "Working")
    const ask = { tool: "shell", action: "shell", step }
    fakeToolAsk(setup.service, RUN, { ...ask, input: { command: "echo hi" }, resources: ["echo hi"] })
    fakeToolAsk(setup.service, RUN, { ...ask, input: { command: "echo ho" }, resources: ["echo ho"] })
    const pending = await pendingIn(setup.ctx)
    expect(pending.map((request) => request.kind === "permission" && request.text)).toEqual(["echo hi", "echo ho"])
    expect(messageReadsOf(setup.service, RUN)).toEqual([step.id])
  })

  test("reads the messages of each session that asks, one for each message that holds a call", async () => {
    const setup = requestSetup()
    const child = fakeChild(setup.service, RUN)
    for (const id of [RUN, child.id]) {
      fakeToolAsk(setup.service, id, {
        tool: "shell",
        input: { command: "echo hi" },
        action: "shell",
        resources: ["echo hi"],
      })
      fakeToolAsk(setup.service, id, {
        tool: "shell",
        input: { command: "echo ho" },
        action: "shell",
        resources: ["echo ho"],
      })
    }
    await pendingIn(setup.ctx)
    expect(messageReadsOf(setup.service, RUN)).toHaveLength(2)
    expect(messageReadsOf(setup.service, child.id)).toHaveLength(2)
  })

  test("is the resources, one to a line, where the message is gone", async () => {
    const setup = requestSetup()
    fakeAsk(setup.service, RUN, {
      action: "shell",
      resources: ["echo hi", "echo ho"],
      source: { type: "tool", messageID: "msg_gone", id: "call_gone" },
    })
    const [pending] = await pendingIn(setup.ctx)
    expect(pending).toMatchObject({ text: "echo hi\necho ho", step: "msg_gone" })
    expect(pending).not.toHaveProperty("tool")
  })

  test("is the resources where the message no longer holds the call, and where the request names none", async () => {
    const setup = requestSetup()
    const step = fakeReply(setup.service, RUN, "Working")
    fakeAsk(setup.service, RUN, {
      action: "shell",
      resources: ["echo hi"],
      source: { type: "tool", messageID: step.id, id: "call_other" },
    })
    fakeAsk(setup.service, RUN, { action: "shell", resources: ["echo ho"] })
    const pending = await pendingIn(setup.ctx)
    expect(pending.map((request) => request.kind === "permission" && request.text)).toEqual(["echo hi", "echo ho"])
    expect(pending[1]).not.toHaveProperty("step")
  })

  test("does not hide a failure to read the message", async () => {
    const setup = requestSetup()
    const step = fakeReply(setup.service, RUN, "Working")
    fakeToolAsk(setup.service, RUN, {
      tool: "shell",
      input: { command: "echo hi" },
      action: "shell",
      resources: ["echo hi"],
      step,
    })
    setup.service.failNext(/\/message\/[^/]+$/, new Response("{}", { status: 500 }))
    expect((await failure(pendingIn(setup.ctx))).code).toBe("upstream_error")
  })
})

describe("pendingOf: what can only be rejected", () => {
  test("never_approve: the setting holds the action", async () => {
    const setup = requestSetup()
    fakeAsk(setup.service, RUN, { action: "edit", resources: ["a.ts"] })
    fakeAsk(setup.service, RUN, { action: "shell", resources: ["echo hi"] })
    const ctx = { ...setup.ctx, options: { never_approve: ["edit"] } }
    const [held, free] = await pendingIn(ctx)
    expect(held).toMatchObject({ rejectOnly: "never_approve" })
    expect(free).not.toHaveProperty("rejectOnly")
    expect((await pendingIn(setup.ctx))[0]).not.toHaveProperty("rejectOnly")
  })

  test("subagent_ask: the run's own rules ask what a subagent asked, and not what the run asked itself", async () => {
    const rules: Rule[] = [{ action: "shell", resource: "git switch *", effect: "ask" }]
    const setup = requestSetup({}, { permissions: rules })
    const child = fakeChild(setup.service, RUN)
    const ask = { tool: "shell", action: "shell", resources: ["git switch -c topic"], input: SWITCH }
    fakeToolAsk(setup.service, RUN, ask)
    fakeToolAsk(setup.service, child.id, ask)
    fakeToolAsk(setup.service, child.id, { ...ask, resources: ["echo hi"], input: { command: "echo hi" } })
    const [own, asked, allowed] = await pendingIn(setup.ctx)
    expect(own).not.toHaveProperty("rejectOnly")
    expect(asked).toMatchObject({ subagent: true, rejectOnly: "subagent_ask" })
    expect(allowed).not.toHaveProperty("rejectOnly")
  })

  test("unshowable and too_long: by the text the call gave, not by its resources", async () => {
    const setup = requestSetup()
    fakeToolAsk(setup.service, RUN, {
      tool: "shell",
      input: { command: "echo\u202ehi" },
      action: "shell",
      resources: ["echo hi"],
    })
    fakeToolAsk(setup.service, RUN, {
      tool: "shell",
      input: { command: `echo ${"a".repeat(2000)}` },
      action: "shell",
      resources: ["echo"],
    })
    const [unshowable, tooLong] = await pendingIn(setup.ctx)
    expect(unshowable).toMatchObject({ rejectOnly: "unshowable" })
    expect(tooLong).toMatchObject({ rejectOnly: "too_long" })
  })

  test("a question with a link, or a field of an unknown kind, can only be declined", async () => {
    const setup = requestSetup()
    fakeQuestion(setup.service, RUN, "Visit", [{ key: "l", type: "external", url: "https://example.test/go" }])
    fakeQuestion(setup.service, RUN, "Fine")
    const [link, fine] = await pendingIn(setup.ctx)
    expect(link).toMatchObject({ declineOnly: "It has a link to visit, which no tool has visited." })
    expect(fine).not.toHaveProperty("declineOnly")
  })

  test("takes the rules from the run's own session, as stored", async () => {
    const setup = requestSetup({}, { permissions: [{ action: "shell", resource: "*", effect: "ask" }] })
    const child = fakeChild(setup.service, RUN)
    child.permissions = []
    fakeAsk(setup.service, child.id, { action: "shell", resources: ["echo hi"] })
    expect((await pendingIn(setup.ctx))[0]).toMatchObject({ rejectOnly: "subagent_ask" })
  })
})

describe("pendingOf: a session that is gone", () => {
  test("a subagent that vanished while it was read contributes nothing", async () => {
    const setup = requestSetup()
    const child = fakeChild(setup.service, RUN)
    fakeAsk(setup.service, child.id, { action: "edit", resources: ["c.ts"] })
    fakeAsk(setup.service, RUN, { action: "shell", resources: ["echo hi"] })
    setup.service.failNext(`/api/session/${child.id}/permission`, sessionMissing(child.id))
    const pending = await pendingIn(setup.ctx)
    expect(pending.map((request) => request.session)).toEqual([RUN])
  })

  test("the run's own session that vanished is not_found, in the words of a session that does not exist", async () => {
    const setup = requestSetup()
    setup.service.failNext(`/api/session/${RUN}/form`, sessionMissing(RUN))
    const error = await failure(pendingIn(setup.ctx))
    expect([error.code, error.message]).toEqual(["not_found", SESSION_NOT_FOUND])
  })
})
