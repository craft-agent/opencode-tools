import { describe, expect, test } from "bun:test"
import { OpenCode, type OpenCodeClient } from "@opencode/client"
import {
  FAKE_ENDPOINT,
  createFakeService,
  fakeAsk,
  fakeChild,
  fakeQuestion,
  fakeQuestions,
  fakeReply,
  fakeSession,
  fakeToolAsk,
  type FakeService,
} from "./testing"

function clientOf(service: FakeService): OpenCodeClient {
  return OpenCode.make({ baseUrl: FAKE_ENDPOINT.url, headers: FAKE_ENDPOINT.headers, fetch: service.fetch })
}

async function started(client: OpenCodeClient) {
  const { id } = await client.session.create({ title: "Task" })
  await client.session.prompt({ sessionID: id, text: "go", id: "msg_brief" })
  return id
}

function failure(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  )
}

const REQUEST = { action: "bash", resources: ["git switch -c topic"] }
const SOURCE = { type: "tool" as const, messageID: "msg_step", id: "call_1" }
const OTHER_SOURCE = { type: "tool" as const, messageID: "msg_other", id: "call_2" }

async function pendingIds(client: OpenCodeClient, sessionID: string) {
  return (await client.permission.list({ sessionID })).map((request) => request.id)
}

describe("the fake service's permission replies", () => {
  test("once removes that one request, records it and leaves the session active", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const first = fakeAsk(service, id, REQUEST)
    const second = fakeAsk(service, id, REQUEST)
    await client.permission.reply({ sessionID: id, requestID: first.id, decision: "once" })
    expect(await pendingIds(client, id)).toEqual([second.id])
    expect(fakeSession(service, id).answers).toEqual([{ kind: "permission", id: first.id, decision: "once" }])
    expect(Object.keys(await client.session.active())).toEqual([id])
  })

  test("a second reply to an answered request is a PermissionNotFoundError with the service's words", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const request = fakeAsk(service, id, REQUEST)
    await client.permission.reply({ sessionID: id, requestID: request.id, decision: "once" })
    const error = await failure(client.permission.reply({ sessionID: id, requestID: request.id, decision: "once" }))
    expect(error).toMatchObject({
      _tag: "PermissionNotFoundError",
      requestID: request.id,
      message: `Permission request not found: ${request.id}`,
    })
    expect(fakeSession(service, id).answers).toHaveLength(1)
  })

  test("always is taken as once", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const first = fakeAsk(service, id, REQUEST)
    const second = fakeAsk(service, id, REQUEST)
    await client.permission.reply({ sessionID: id, requestID: first.id, decision: "always" })
    expect(await pendingIds(client, id)).toEqual([second.id])
    expect(fakeSession(service, id).answers).toEqual([{ kind: "permission", id: first.id, decision: "always" }])
  })

  test("a rejection with a message removes the request, records the message and leaves the session active", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const request = fakeAsk(service, id, REQUEST)
    await client.permission.reply({ sessionID: id, requestID: request.id, decision: "reject", message: "not now" })
    expect(await pendingIds(client, id)).toEqual([])
    expect(fakeSession(service, id).answers).toEqual([
      { kind: "permission", id: request.id, decision: "reject", message: "not now" },
    ])
    expect(Object.keys(await client.session.active())).toEqual([id])
  })

  test("a rejection without a message, or with an empty one, takes the session out of the active set and writes no idle message", async () => {
    for (const message of [undefined, ""]) {
      const service = createFakeService()
      const client = clientOf(service)
      const id = await started(client)
      const request = fakeAsk(service, id, REQUEST)
      const before = structuredClone(fakeSession(service, id).messages)
      await client.permission.reply({ sessionID: id, requestID: request.id, decision: "reject", message })
      expect(await client.session.active()).toEqual({})
      expect(fakeSession(service, id).messages).toEqual(before)
      expect(fakeSession(service, id).answers).toEqual([{ kind: "permission", id: request.id, decision: "reject" }])
    }
  })

  test("a rejection takes the other requests of its step with it, records them as along, and leaves another step's pending", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const one = fakeAsk(service, id, { ...REQUEST, source: SOURCE })
    const other = fakeAsk(service, id, { ...REQUEST, source: OTHER_SOURCE })
    const two = fakeAsk(service, id, { ...REQUEST, source: { ...SOURCE, id: "call_3" } })
    await client.permission.reply({ sessionID: id, requestID: one.id, decision: "reject", message: "no" })
    expect(await pendingIds(client, id)).toEqual([other.id])
    expect(fakeSession(service, id).answers).toEqual([
      { kind: "permission", id: one.id, decision: "reject", message: "no" },
      { kind: "permission", id: two.id, decision: "reject", message: "no", along: true },
    ])
    const error = await failure(client.permission.reply({ sessionID: id, requestID: two.id, decision: "once" }))
    expect(error).toHaveProperty("_tag", "PermissionNotFoundError")
  })

  test("a rejection takes the requests that have no source together, and not those that have one", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const one = fakeAsk(service, id, REQUEST)
    const sourced = fakeAsk(service, id, { ...REQUEST, source: SOURCE })
    const two = fakeAsk(service, id, REQUEST)
    await client.permission.reply({ sessionID: id, requestID: one.id, decision: "reject", message: "no" })
    expect(await pendingIds(client, id)).toEqual([sourced.id])
    expect(fakeSession(service, id).answers.map((answer) => answer.id)).toEqual([one.id, two.id])
  })

  test("a reply through another session's route is a PermissionNotFoundError and removes nothing", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const child = fakeChild(service, id)
    const request = fakeAsk(service, child.id, REQUEST)
    const error = await failure(client.permission.reply({ sessionID: id, requestID: request.id, decision: "reject" }))
    expect(error).toMatchObject({ _tag: "PermissionNotFoundError", requestID: request.id })
    expect(await pendingIds(client, child.id)).toEqual([request.id])
    expect(fakeSession(service, child.id).answers).toEqual([])
    expect(Object.keys(await client.session.active())).toEqual([id, child.id])
  })

  test("a reply for a session that does not exist is a SessionNotFoundError", async () => {
    const client = clientOf(createFakeService())
    const error = await failure(client.permission.reply({ sessionID: "ses_none", requestID: "x", decision: "once" }))
    expect(error).toHaveProperty("_tag", "SessionNotFoundError")
  })
})

describe("the fake service's tool calls", () => {
  test("a request for a tool call names a running call that the session's message holds", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    service.clock.now += 4
    const request = fakeToolAsk(service, id, {
      tool: "shell",
      input: { command: "git switch -c topic", workdir: "/work/acme" },
      action: "bash",
      resources: ["git switch -c topic"],
      save: ["git switch *"],
    })
    const [, step] = fakeSession(service, id).messages
    expect(request).toEqual({
      id: `${id}:request1`,
      sessionID: id,
      action: "bash",
      resources: ["git switch -c topic"],
      save: ["git switch *"],
      source: { type: "tool", messageID: step!.id, id: `${step!.id}:call1` },
    })
    expect(request).not.toHaveProperty("metadata")
    const read = await client.session.message.get({ sessionID: id, messageID: step!.id })
    expect(read).toMatchObject({
      type: "assistant",
      time: { created: service.clock.now },
      content: [
        {
          type: "tool",
          id: `${step!.id}:call1`,
          name: "shell",
          state: { status: "running", input: { command: "git switch -c topic", workdir: "/work/acme" }, metadata: {} },
          time: { created: service.clock.now },
        },
      ],
    })
    expect(await client.permission.list({ sessionID: id })).toEqual([request])
  })

  test("a step given gets the call added, numbered after the calls it holds", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const step = fakeReply(service, id, "Working.")
    const ask = { tool: "shell", input: { command: "echo hi" }, action: "bash", resources: ["echo hi"], step }
    const first = fakeToolAsk(service, id, { ...ask, metadata: { note: "x" } })
    const second = fakeToolAsk(service, id, ask)
    expect(fakeSession(service, id).messages).toHaveLength(2)
    expect(first).toMatchObject({ metadata: { note: "x" }, source: { messageID: step.id, id: `${step.id}:call1` } })
    expect(second.source).toEqual({ type: "tool", messageID: step.id, id: `${step.id}:call2` })
    const read = await client.session.message.get({ sessionID: id, messageID: step.id })
    expect(read).toMatchObject({ content: [{ type: "text" }, { type: "tool" }, { type: "tool" }] })
  })

  test("a message the session lacks is a MessageNotFoundError with the service's words", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const error = await failure(client.session.message.get({ sessionID: id, messageID: "msg_none" }))
    expect(error).toMatchObject({
      _tag: "MessageNotFoundError",
      sessionID: id,
      messageID: "msg_none",
      message: "Message not found: msg_none",
    })
  })
})

describe("the fake service's form replies", () => {
  test("an answer settles the form, which is recorded and no longer listed", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const form = fakeQuestion(service, id, "Which one?")
    await client.session.form.reply({ sessionID: id, formID: form.id, answer: { answer: "this" } })
    expect(await client.session.form.list({ sessionID: id })).toEqual([])
    expect(fakeSession(service, id)).toMatchObject({
      answers: [{ kind: "form", id: form.id, answer: { answer: "this" } }],
      settled: [form.id],
    })
    expect(Object.keys(await client.session.active())).toEqual([id])
  })

  test("an answer the form refuses is a FormInvalidAnswerError with the service's words and leaves the form pending", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const form = fakeQuestion(service, id, "Fill in", [
      { key: "name", type: "string", required: true },
      { key: "pick", type: "string", options: [{ value: "a", label: "A" }] },
      { key: "free", type: "string", options: [{ value: "a", label: "A" }], custom: true },
      { key: "many", type: "multiselect", options: [{ value: "a", label: "A" }] },
      { key: "size", type: "number" },
      { key: "count", type: "integer" },
      { key: "flag", type: "boolean" },
      { key: "link", type: "external", url: "https://example.test" },
    ])
    const refused = async (answer: Record<string, string | number | boolean | string[]>) =>
      failure(client.session.form.reply({ sessionID: id, formID: form.id, answer }))
    const cases: [Record<string, string | number | boolean | string[]>, string][] = [
      [{ name: "n", other: "x" }, "Unknown form field: other"],
      [{ name: 1 }, "Expected string for form field: name"],
      [{ name: "n", size: "big" }, "Expected number for form field: size"],
      [{ name: "n", count: 1.5 }, "Expected integer for form field: count"],
      [{ name: "n", flag: "yes" }, "Expected boolean for form field: flag"],
      [{ name: "n", many: "a" }, "Expected string array for form field: many"],
      [{ name: "n", many: [1] as unknown as string[] }, "Expected string array for form field: many"],
      [{ name: "n", link: false }, "External form field must be acknowledged: link"],
      [{ name: "n", pick: "b" }, "Invalid option for form field: pick"],
      [{ name: "n", many: ["a", "b"] }, "Invalid option for form field: many"],
      [{ pick: "a" }, "Missing required form field: name"],
      [{ other: "x", name: 1 }, "Unknown form field: other"],
      [{ pick: "b", name: 1 }, "Expected string for form field: name"],
    ]
    for (const [answer, message] of cases) {
      expect(await refused(answer)).toMatchObject({ _tag: "FormInvalidAnswerError", id: form.id, message })
    }
    expect(await client.session.form.list({ sessionID: id })).toEqual([form])
    expect(fakeSession(service, id)).toMatchObject({ answers: [], settled: [] })
    await client.session.form.reply({
      sessionID: id,
      formID: form.id,
      answer: { name: "n", pick: "a", free: "other", many: ["a"], size: 1.5, count: 2, flag: false, link: true },
    })
    expect(await client.session.form.list({ sessionID: id })).toEqual([])
  })

  test("a second answer to a settled form is a FormAlreadySettledError", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const form = fakeQuestion(service, id, "Which one?")
    await client.session.form.reply({ sessionID: id, formID: form.id, answer: { answer: "a" } })
    const error = await failure(client.session.form.reply({ sessionID: id, formID: form.id, answer: { answer: "b" } }))
    expect(error).toMatchObject({
      _tag: "FormAlreadySettledError",
      id: form.id,
      message: `Form already settled: ${form.id}`,
    })
    expect(fakeSession(service, id).answers).toHaveLength(1)
  })

  test("a form the session never had, or another session's, is a FormNotFoundError", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const child = fakeChild(service, id)
    const form = fakeQuestion(service, child.id, "Child asks")
    const unknown = await failure(client.session.form.reply({ sessionID: id, formID: "form_none", answer: {} }))
    expect(unknown).toMatchObject({ _tag: "FormNotFoundError", id: "form_none", message: "Form not found: form_none" })
    const other = await failure(client.session.form.reply({ sessionID: id, formID: form.id, answer: {} }))
    expect(other).toMatchObject({ _tag: "FormNotFoundError", id: form.id })
    const cancel = await failure(client.session.form.cancel({ sessionID: id, formID: form.id }))
    expect(cancel).toHaveProperty("_tag", "FormNotFoundError")
    expect(await client.session.form.list({ sessionID: child.id })).toEqual([form])
  })
})

describe("the fake service's form cancels", () => {
  test("a cancel with a message settles the form, records the message and leaves the session active", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const form = fakeQuestion(service, id, "Which one?")
    await client.session.form.cancel({ sessionID: id, formID: form.id, message: "skip it" })
    expect(await client.session.form.list({ sessionID: id })).toEqual([])
    expect(fakeSession(service, id)).toMatchObject({
      answers: [{ kind: "cancel", id: form.id, message: "skip it" }],
      settled: [form.id],
    })
    expect(Object.keys(await client.session.active())).toEqual([id])
  })

  test("a cancel without a message, or with an empty one, takes the session out of the active set", async () => {
    for (const message of [undefined, ""]) {
      const service = createFakeService()
      const client = clientOf(service)
      const id = await started(client)
      const form = fakeQuestion(service, id, "Which one?")
      await client.session.form.cancel({ sessionID: id, formID: form.id, message })
      expect(await client.session.active()).toEqual({})
      expect(fakeSession(service, id).answers).toEqual([{ kind: "cancel", id: form.id }])
    }
  })

  test("a cancel of a settled form is a FormAlreadySettledError", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const form = fakeQuestion(service, id, "Which one?")
    await client.session.form.cancel({ sessionID: id, formID: form.id, message: "no" })
    const error = await failure(client.session.form.cancel({ sessionID: id, formID: form.id }))
    expect(error).toHaveProperty("_tag", "FormAlreadySettledError")
    expect(Object.keys(await client.session.active())).toEqual([id])
  })
})

describe("the fake service's ids", () => {
  test("a request or a form asked after an answer gets a new id", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const request = fakeAsk(service, id, REQUEST)
    await client.permission.reply({ sessionID: id, requestID: request.id, decision: "once" })
    const again = fakeAsk(service, id, REQUEST)
    expect(again.id).not.toBe(request.id)
    const form = fakeQuestion(service, id, "Which one?")
    await client.session.form.reply({ sessionID: id, formID: form.id, answer: { answer: "a" } })
    expect(fakeQuestion(service, id, "Again?").id).not.toBe(form.id)
  })

  test("the first request and the first form of a session are numbered 1", async () => {
    const service = createFakeService()
    const requested = await started(clientOf(service))
    expect(fakeAsk(service, requested, REQUEST).id).toBe(`${requested}:request1`)
    const questioned = (await clientOf(service).session.create()).id
    expect(fakeQuestion(service, questioned, "Which one?").id).toBe(`${questioned}:form1`)
  })
})

describe("fakeQuestions", () => {
  test("builds the form of the agent's question tool: one field per question, a choice or a multiselect", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const form = fakeQuestions(service, id, [
      { header: "Branch", question: "Which branch?", options: ["main", "dev"] },
      { header: "Checks", question: "Which checks?", options: ["lint"], multiple: true },
    ])
    expect(form).toEqual({
      id: `${id}:form1`,
      sessionID: id,
      title: "Questions",
      metadata: { kind: "question" },
      fields: [
        {
          key: "q0",
          title: "Branch",
          description: "Which branch?",
          type: "string",
          options: [
            { value: "main", label: "main", description: "Choose main" },
            { value: "dev", label: "dev", description: "Choose dev" },
          ],
          custom: true,
        },
        {
          key: "q1",
          title: "Checks",
          description: "Which checks?",
          type: "multiselect",
          options: [{ value: "lint", label: "lint", description: "Choose lint" }],
          custom: true,
        },
      ],
    })
    expect(await client.session.form.list({ sessionID: id })).toEqual([form])
    await client.session.form.reply({ sessionID: id, formID: form.id, answer: { q0: "other", q1: ["lint", "x"] } })
    expect(await client.session.form.list({ sessionID: id })).toEqual([])
  })

  test("refuses a form with no question", () => {
    const service = createFakeService({ sessions: [] })
    expect(() => fakeQuestions(service, "ses_none", [])).toThrow()
  })
})
