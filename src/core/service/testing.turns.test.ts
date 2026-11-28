import { describe, expect, test } from "bun:test"
import { OpenCode, type OpenCodeClient } from "@opencode/client"
import {
  FAKE_ENDPOINT,
  createFakeService,
  fakeAsk,
  fakeChild,
  fakeEnd,
  fakeQuestion,
  fakeReply,
  fakeRetry,
  fakeSession,
  fakeStop,
  type FakeService,
} from "./testing"

function clientOf(service: FakeService): OpenCodeClient {
  return OpenCode.make({ baseUrl: FAKE_ENDPOINT.url, headers: FAKE_ENDPOINT.headers, fetch: service.fetch })
}

async function started(client: OpenCodeClient, text = "go") {
  const { id } = await client.session.create({ title: "Task", metadata: { owner: "me" }, permissions: [] })
  await client.session.prompt({ sessionID: id, text, id: "msg_brief" })
  return id
}

describe("the fake service's messages", () => {
  test("a prompt that runs appends a user message with its id and text; one that does not run appends none", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client, "do it")
    service.clock.now += 5
    await client.session.prompt({ sessionID: id, text: "later", resume: false })
    const { data } = await client.message.list({ sessionID: id })
    expect(data).toEqual([{ id: "msg_brief", time: { created: service.clock.now - 5 }, type: "user", text: "do it" }])
  })

  test("are listed newest first, oldest first on request, and by type, up to the limit", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    fakeReply(service, id, "one")
    fakeReply(service, id, "two")
    fakeEnd(service, id, "succeeded")
    const types = async (input: Omit<Parameters<OpenCodeClient["message"]["list"]>[0], "sessionID">) =>
      (await client.message.list({ sessionID: id, ...input })).data.map((message) => message.type)
    expect(await types({})).toEqual(["idle", "assistant", "assistant", "user"])
    expect(await types({ order: "desc" })).toEqual(["idle", "assistant", "assistant", "user"])
    expect(await types({ order: "asc" })).toEqual(["user", "assistant", "assistant", "idle"])
    expect(await types({ order: "desc", limit: 2 })).toEqual(["idle", "assistant"])
    expect(await types({ type: "assistant", limit: 1 })).toEqual(["assistant"])
    expect((await client.message.list({ sessionID: id })).cursor).toEqual({})
  })

  test("one message is read by its id, and a message the session lacks is a MessageNotFoundError", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const reply = fakeReply(service, id, "one")
    expect(await client.session.message.get({ sessionID: id, messageID: reply.id })).toEqual(reply)
    expect(await client.session.message.get({ sessionID: id, messageID: "msg_brief" })).toMatchObject({ type: "user" })
    const error = await client.session.message.get({ sessionID: id, messageID: "msg_none" }).catch((e: unknown) => e)
    expect(error).toHaveProperty("name", "MessageNotFoundError")
    const missing = await client.session.message
      .get({ sessionID: "ses_none", messageID: reply.id })
      .catch((e: unknown) => e)
    expect(missing).toHaveProperty("name", "SessionNotFoundError")
  })

  test("answer a session that does not exist with a SessionNotFoundError on every route", async () => {
    const client = clientOf(createFakeService())
    const sessionID = "ses_none"
    const calls = [
      () => client.message.list({ sessionID }),
      () => client.permission.list({ sessionID }),
      () => client.session.form.list({ sessionID }),
      () => client.session.diff({ sessionID }),
    ]
    for (const call of calls) {
      expect(await call().catch((error: unknown) => error)).toHaveProperty("name", "SessionNotFoundError")
    }
  })
})

describe("the fake service's pending requests and diff", () => {
  test("a permission request and a question are listed under the session that asked", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const child = fakeChild(service, id)
    const request = fakeAsk(service, child.id, { action: "bash", resources: ["ls"] })
    const form = fakeQuestion(service, id, "Which one?")
    expect(await client.permission.list({ sessionID: child.id })).toEqual([request])
    expect(await client.permission.list({ sessionID: id })).toEqual([])
    expect(request).toMatchObject({ sessionID: child.id, action: "bash", resources: ["ls"] })
    expect(await client.session.form.list({ sessionID: id })).toEqual([form])
    expect(form).toMatchObject({ sessionID: id, title: "Which one?" })
    expect(await client.session.form.list({ sessionID: child.id })).toEqual([])
  })

  test("the diff is what the session holds, and the context asked for is recorded in the request", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const file = { file: "a.ts", patch: "@@\n+x", additions: 1, deletions: 0, status: "added" as const }
    fakeSession(service, id).diff.push(file)
    expect(await client.session.diff({ sessionID: id, context: 3 })).toEqual([file])
    expect(await client.session.diff({ sessionID: id, context: 0 })).toEqual([file])
    const queries = service.requests.filter((request) => request.path.endsWith("/diff")).map((r) => r.query)
    expect(queries).toEqual([{ context: "3" }, { context: "0" }])
  })
})

describe("the fake service's paging", () => {
  test("a list that has more sessions than its limit gives a cursor, which the next request follows", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    for (let index = 0; index < 5; index += 1) {
      service.clock.now += 1
      await client.session.create({ id: `ses_${index}` })
    }
    const first = await client.session.list({ limit: 2 })
    expect(first.data.map((session) => session.id)).toEqual(["ses_4", "ses_3"])
    expect(first.cursor.next).toBeString()
    const second = await client.session.list({ limit: 2, cursor: first.cursor.next! })
    expect(second.data.map((session) => session.id)).toEqual(["ses_2", "ses_1"])
    const third = await client.session.list({ limit: 2, cursor: second.cursor.next! })
    expect(third.data.map((session) => session.id)).toEqual(["ses_0"])
    expect(third.cursor).toEqual({})
    expect((await client.session.list({ limit: 5 })).cursor).toEqual({})
  })
})

describe("the helpers that play a turn", () => {
  test("fakeReply adds a completed assistant message with one text part, at the clock", async () => {
    const service = createFakeService()
    const id = await started(clientOf(service))
    service.clock.now += 9
    const reply = fakeReply(service, id, "Done.")
    expect(reply).toMatchObject({
      type: "assistant",
      time: { created: service.clock.now, completed: service.clock.now },
      content: [{ type: "text", text: "Done." }],
    })
    expect(fakeSession(service, id).messages.at(-1)).toBe(reply)
  })

  test("fakeEnd writes the idle message and the session's outcome and idle time, and takes it out of the active set", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    service.clock.now += 20
    fakeEnd(service, id, "failed", { type: "provider.rate-limit", message: "slow down" })
    const session = await client.session.get({ sessionID: id })
    expect(session).toMatchObject({ outcome: "failed", time: { idle: service.clock.now, updated: service.clock.now } })
    expect(await client.session.active()).toEqual({})
    expect(fakeSession(service, id).messages.at(-1)).toMatchObject({
      type: "idle",
      outcome: "failed",
      error: { type: "provider.rate-limit", message: "slow down" },
    })
    fakeEnd(service, id, "succeeded")
    expect(fakeSession(service, id).messages.at(-1)).not.toHaveProperty("error")
  })

  test("fakeStop takes the session out of the active set and writes nothing else", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const before = structuredClone(fakeSession(service, id).messages)
    fakeStop(service, id)
    expect(await client.session.active()).toEqual({})
    expect(fakeSession(service, id).messages).toEqual(before)
    expect(await client.session.get({ sessionID: id })).not.toHaveProperty("outcome")
  })

  test("fakeRetry marks the newest assistant message, and adds an unfinished one when there is none", async () => {
    const service = createFakeService()
    const id = await started(clientOf(service))
    const retry = { attempt: 2, at: 99, error: { type: "provider.overloaded", message: "busy" } }
    fakeRetry(service, id, retry)
    const [, added] = fakeSession(service, id).messages
    expect(added).toMatchObject({ type: "assistant", retry })
    expect(added).not.toHaveProperty("time.completed")
    fakeReply(service, id, "next")
    fakeRetry(service, id, { ...retry, attempt: 3 })
    const messages = fakeSession(service, id).messages
    expect(messages).toHaveLength(3)
    expect(messages[1]).toMatchObject({ retry })
    expect(messages[2]).toMatchObject({ retry: { attempt: 3 } })
  })

  test("fakeChild adds an active subagent session with its parent's metadata and permissions copied", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    fakeStop(service, id)
    service.clock.now += 3
    const child = fakeChild(service, id)
    const read = await client.session.get({ sessionID: child.id })
    expect(read).toMatchObject({
      parentID: id,
      metadata: { owner: "me" },
      permissions: [],
      location: fakeSession(service, id).location,
      time: { busy: service.clock.now },
    })
    expect(Object.keys(await client.session.active())).toEqual([child.id])
    expect(fakeChild(service, id).id).not.toBe(child.id)
  })
})
