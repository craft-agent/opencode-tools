import { describe, expect, test } from "bun:test"
import { OpenCode, type OpenCodeClient, type SessionInboxSynthetic } from "@opencode/client"
import {
  FAKE_ENDPOINT,
  createFakeService,
  fakeChild,
  fakeEnd,
  fakeQuestion,
  fakeReply,
  fakeSession,
  fakeStep,
  fakeToolAsk,
  type FakeService,
} from "./testing"

function clientOf(service: FakeService): OpenCodeClient {
  return OpenCode.make({ baseUrl: FAKE_ENDPOINT.url, headers: FAKE_ENDPOINT.headers, fetch: service.fetch })
}

async function started(client: OpenCodeClient) {
  const { id } = await client.session.create({ title: "Task" })
  await client.session.prompt({ sessionID: id, text: "go" })
  return id
}

function failure(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  )
}

async function messagesOf(client: OpenCodeClient, sessionID: string) {
  return (await client.message.list({ sessionID, order: "asc" })).data
}

function reportText(kind: "subagent" | "shell", sessionID: string, description: string) {
  return `<background-result kind="${kind}" sessionID="${sessionID}" state="cancelled" description="${description}">\n${
    kind === "shell" ? "Shell" : "Subagent"
  } cancelled\n</background-result>`
}

const CHILD_DESCRIPTION = "Subagent task"
const TOOL_ASK = { tool: "bash", input: { command: "sleep 60" }, action: "bash", resources: ["sleep 60"] }

describe("the fake service's unread input", () => {
  test("a steer to a running session waits for its next step, whatever its delivery or resume", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const steer = await client.session.prompt({ sessionID: id, text: "more" })
    const queued = await client.session.prompt({ sessionID: id, text: "later", delivery: "queue" })
    const unresumed = await client.session.prompt({ sessionID: id, text: "quiet", resume: false })
    expect(await client.session.inbox.list({ sessionID: id })).toEqual([steer, queued, unresumed])
    expect(await messagesOf(client, id)).toMatchObject([{ type: "user", text: "go" }])
    expect(fakeSession(service, id).prompts.map((prompt) => prompt.text)).toEqual(["go", "more", "later", "quiet"])
  })

  test("a step delivers the steers in order and leaves the queued", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const first = await client.session.prompt({ sessionID: id, text: "first" })
    await client.session.prompt({ sessionID: id, text: "later", delivery: "queue" })
    const report: SessionInboxSynthetic = {
      id: "msg_report",
      sessionID: id,
      time: { created: service.clock.now },
      type: "synthetic",
      payload: { text: "a report", description: "Report", metadata: {} },
      delivery: "steer",
    }
    fakeSession(service, id).inbox.push(report)
    const last = await client.session.prompt({ sessionID: id, text: "last" })
    service.clock.now += 9
    const added = fakeStep(service, id)
    expect(added).toEqual([
      { id: first.id, time: { created: service.clock.now }, type: "user", text: "first" },
      {
        id: "msg_report",
        time: { created: service.clock.now },
        type: "synthetic",
        text: "a report",
        description: "Report",
      },
      { id: last.id, time: { created: service.clock.now }, type: "user", text: "last" },
    ])
    expect((await messagesOf(client, id)).slice(1)).toEqual(added)
    expect((await client.session.inbox.list({ sessionID: id })).map((item) => item.payload)).toEqual([
      { text: "later" },
    ])
    expect(fakeStep(service, id)).toEqual([])
  })

  test("a prompt that starts a turn delivers the steers already waiting before its own message", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const { id } = await client.session.create()
    const waiting = await client.session.prompt({ sessionID: id, text: "waiting", resume: false })
    await client.session.prompt({ sessionID: id, text: "kept", resume: false, delivery: "queue" })
    service.clock.now += 4
    const now = await client.session.prompt({ sessionID: id, text: "now" })
    expect(await messagesOf(client, id)).toEqual([
      { id: waiting.id, time: { created: service.clock.now }, type: "user", text: "waiting" },
      { id: now.id, time: { created: service.clock.now }, type: "user", text: "now" },
    ])
    expect((await client.session.inbox.list({ sessionID: id })).map((item) => item.payload)).toEqual([{ text: "kept" }])
    expect(Object.keys(await client.session.active())).toEqual([id])
    expect(fakeSession(service, id).time.busy).toBe(service.clock.now)
  })
})

describe("the fake service's inbox cancel", () => {
  test("removes the item, and answers the same for one that is gone", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const one = await client.session.prompt({ sessionID: id, text: "one" })
    const two = await client.session.prompt({ sessionID: id, text: "two" })
    expect(await client.session.inbox.cancel({ sessionID: id, inboxID: one.id })).toBeUndefined()
    expect(await client.session.inbox.list({ sessionID: id })).toEqual([two])
    expect(await client.session.inbox.cancel({ sessionID: id, inboxID: one.id })).toBeUndefined()
    expect(await client.session.inbox.cancel({ sessionID: id, inboxID: "msg_none" })).toBeUndefined()
    expect(await client.session.inbox.list({ sessionID: id })).toEqual([two])
  })

  test("answers a session that does not exist with a SessionNotFoundError", async () => {
    const client = clientOf(createFakeService())
    const error = await failure(client.session.inbox.cancel({ sessionID: "ses_none", inboxID: "msg_none" }))
    expect(error).toHaveProperty("name", "SessionNotFoundError")
  })
})

describe("the fake service's interrupt", () => {
  test("a session that is not running answers false and is left as it was", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const { id } = await client.session.create()
    await client.session.prompt({ sessionID: id, text: "wait", resume: false })
    const before = structuredClone(fakeSession(service, id))
    expect(await client.session.interrupt({ sessionID: id })).toEqual({ interrupted: false })
    expect(fakeSession(service, id)).toEqual(before)
    expect(await client.session.active()).toEqual({})
  })

  test("a session that does not exist is a SessionNotFoundError", async () => {
    const client = clientOf(createFakeService())
    expect(await failure(client.session.interrupt({ sessionID: "ses_none" }))).toHaveProperty(
      "name",
      "SessionNotFoundError",
    )
  })

  test("an interrupt settles a running session: its step aborted, an idle message, no request or form left", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const earlier = fakeReply(service, id, "earlier")
    const repliedAt = earlier.time.completed
    service.clock.now += 5
    fakeToolAsk(service, id, TOOL_ASK)
    fakeQuestion(service, id, "Which one?")
    const waiting = await client.session.prompt({ sessionID: id, text: "more" })
    service.clock.now += 5
    expect(await client.session.interrupt({ sessionID: id })).toEqual({ interrupted: true })
    const session = fakeSession(service, id)
    const now = service.clock.now
    expect(session.messages).toMatchObject([
      { type: "user" },
      { type: "assistant", time: { completed: repliedAt } },
      {
        type: "assistant",
        time: { completed: now },
        finish: "error",
        error: { type: "aborted", message: "Step interrupted" },
        content: [
          {
            type: "tool",
            state: {
              status: "error",
              input: TOOL_ASK.input,
              error: { type: "aborted", message: "Tool execution interrupted" },
            },
          },
        ],
      },
      { type: "idle", outcome: "interrupted", time: { created: now } },
    ])
    expect(session.messages[3]).not.toHaveProperty("error")
    expect(session).toMatchObject({ outcome: "interrupted", time: { idle: now, updated: now } })
    expect(await client.session.active()).toEqual({})
    expect(await client.permission.list({ sessionID: id })).toEqual([])
    expect(await client.session.form.list({ sessionID: id })).toEqual([])
    expect(session.answers).toEqual([])
    expect(await client.session.inbox.list({ sessionID: id })).toEqual([waiting])
  })

  test("an interrupt stops one session and leaves its child running", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const child = fakeChild(service, id)
    expect(await client.session.interrupt({ sessionID: id })).toEqual({ interrupted: true })
    expect(Object.keys(await client.session.active())).toEqual([child.id])
    expect(fakeSession(service, child.id).messages).toEqual([])
    expect((await client.experimental.job.list({ sessionID: id })).map((job) => job.id)).toEqual([child.id])
  })
})

describe("the fake service's reports of stopped work", () => {
  test("the report of an interrupted child waits in a parent that is running", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const child = fakeChild(service, id)
    service.clock.now += 3
    await client.session.interrupt({ sessionID: child.id })
    expect(await client.session.inbox.list({ sessionID: id })).toEqual([
      {
        id: expect.stringMatching(/^msg_/),
        sessionID: id,
        time: { created: service.clock.now },
        type: "synthetic",
        payload: {
          text: reportText("subagent", child.id, CHILD_DESCRIPTION),
          description: CHILD_DESCRIPTION,
          metadata: {},
        },
        delivery: "steer",
      },
    ])
    expect(await messagesOf(client, id)).toHaveLength(1)
    expect(fakeSession(service, child.id)).toMatchObject({ outcome: "interrupted" })
    expect(await client.session.interrupt({ sessionID: child.id })).toEqual({ interrupted: false })
    expect(fakeSession(service, id).inbox).toHaveLength(1)
  })

  test("the report of an interrupted child wakes a parent that had stopped", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const child = fakeChild(service, id)
    fakeEnd(service, id, "succeeded")
    const waiting = await client.session.prompt({ sessionID: id, text: "waiting", resume: false })
    const queued = await client.session.prompt({ sessionID: id, text: "later", resume: false, delivery: "queue" })
    service.clock.now += 6
    await client.session.interrupt({ sessionID: child.id })
    expect(Object.keys(await client.session.active())).toEqual([id])
    expect(fakeSession(service, id).time.busy).toBe(service.clock.now)
    const [report] = (await client.message.list({ sessionID: id })).data
    expect(report).toEqual({
      id: expect.stringMatching(/^msg_/),
      time: { created: service.clock.now },
      type: "synthetic",
      text: reportText("subagent", child.id, CHILD_DESCRIPTION),
      description: CHILD_DESCRIPTION,
    })
    expect((await messagesOf(client, id)).slice(-2).map((message) => message.id)).toEqual([waiting.id, report!.id])
    expect(await client.session.inbox.list({ sessionID: id })).toEqual([queued])
  })

  test("a woken session stays running until something ends it", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const child = fakeChild(service, id)
    fakeEnd(service, id, "succeeded")
    await client.session.interrupt({ sessionID: child.id })
    service.clock.now += 100
    expect(Object.keys(await client.session.active())).toEqual([id])
    expect(await client.session.interrupt({ sessionID: id })).toEqual({ interrupted: true })
    expect(await client.session.active()).toEqual({})
  })
})
