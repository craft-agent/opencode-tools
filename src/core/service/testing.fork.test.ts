import { describe, expect, test } from "bun:test"
import { OpenCode, type OpenCodeClient } from "@opencode/client"
import {
  FAKE_ENDPOINT,
  createFakeService,
  fakeChild,
  fakeEnd,
  fakeReply,
  fakeSession,
  fakeToolAsk,
  type FakeService,
} from "./testing"

function clientOf(service: FakeService): OpenCodeClient {
  return OpenCode.make({ baseUrl: FAKE_ENDPOINT.url, headers: FAKE_ENDPOINT.headers, fetch: service.fetch })
}

function failure(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  )
}

const OTHER_DIRECTORY = "/work/other"
const MODEL = { id: "model-1", providerID: "acme", variant: "high" }
const RULES = [{ action: "bash", resource: "*", effect: "deny" as const }]
const ZERO_TOKENS = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

/** A session with settings, entries and one finished turn. */
async function source(client: OpenCodeClient, service: FakeService, title?: string) {
  const { id } = await client.session.create({
    agent: "plan",
    model: MODEL,
    metadata: { run: { id: 1 }, tags: ["a"] },
    permissions: RULES,
    location: { directory: OTHER_DIRECTORY },
    ...(title !== undefined && { title }),
  })
  await client.experimental.session.instructions.entry.put({ sessionID: id, key: "note", value: { n: 1 } })
  await client.session.prompt({ sessionID: id, text: "go" })
  fakeReply(service, id, "done")
  service.clock.now += 1
  fakeEnd(service, id, "succeeded")
  return id
}

describe("the fake service's fork", () => {
  test("is a new session with the source's settings, no parent and nothing of its use", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await source(client, service, "Task")
    const newest = fakeSession(service, id).messages.at(-1)!
    service.clock.now += 10
    const fork = await client.session.fork({ sessionID: id })
    expect(fork).toEqual({
      id: fork.id,
      projectID: fakeSession(service, id).projectID,
      fork: { sessionID: id, boundary: { type: "through", messageID: newest.id } },
      agent: "plan",
      model: MODEL,
      cost: 0,
      tokens: ZERO_TOKENS,
      time: { created: service.clock.now, updated: service.clock.now },
      title: "Task (fork #1)",
      metadata: { run: { id: 1 }, tags: ["a"] },
      permissions: RULES,
      location: { directory: OTHER_DIRECTORY },
    })
    expect(fork.id).not.toBe(id)
    expect(fork.id).toStartWith("ses_")
    expect(await client.session.get({ sessionID: fork.id })).toEqual(fork)
    expect(service.requests.filter((request) => request.path.endsWith("/fork")).at(-1)?.body).toEqual({})
    expect(fakeSession(service, fork.id)).toMatchObject({
      entries: { note: { n: 1 } },
      prompts: [],
      inbox: [],
      pending: [],
      forms: [],
      answers: [],
      settled: [],
      diff: [],
    })
    expect(await client.session.active()).toEqual({})
  })

  test("numbers its title after the one it ends in, and has none when the source has none", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await source(client, service, "Task")
    const first = await client.session.fork({ sessionID: id })
    const second = await client.session.fork({ sessionID: first.id })
    const third = await client.session.fork({ sessionID: second.id })
    expect([first.title, second.title, third.title]).toEqual(["Task (fork #1)", "Task (fork #2)", "Task (fork #3)"])
    expect((await client.session.fork({ sessionID: id })).title).toBe("Task (fork #1)")
    const untitled = await source(client, service)
    expect(await client.session.fork({ sessionID: untitled })).not.toHaveProperty("title")
  })

  test("copies the metadata, permissions and entries, which are independent of the source afterwards", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await source(client, service)
    const fork = await client.session.fork({ sessionID: id })
    const original = fakeSession(service, id)
    const copy = fakeSession(service, fork.id)
    ;(original.metadata!.run as { id: number }).id = 2
    ;(original.metadata!.tags as string[]).push("b")
    original.permissions!.push({ action: "edit", resource: "*", effect: "deny" })
    original.entries.note = "changed"
    await client.experimental.session.instructions.entry.put({ sessionID: id, key: "other", value: 1 })
    expect(copy.metadata).toEqual({ run: { id: 1 }, tags: ["a"] })
    expect(copy.permissions).toEqual(RULES)
    expect(copy.entries).toEqual({ note: { n: 1 } })
    ;(copy.metadata!.run as { id: number }).id = 3
    await client.experimental.session.instructions.entry.remove({ sessionID: fork.id, key: "note" })
    expect(original.metadata).toMatchObject({ run: { id: 2 } })
    expect(original.entries.note).toBe("changed")
  })

  test("copies the messages under new ids and leaves out a turn still in flight", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const { id } = await client.session.create()
    await client.session.prompt({ sessionID: id, text: "go" })
    fakeReply(service, id, "done")
    fakeToolAsk(service, id, { tool: "bash", input: { command: "sleep 60" }, action: "bash", resources: ["ls"] })
    const held = fakeSession(service, id).messages
    const fork = await client.session.fork({ sessionID: id })
    const copied = fakeSession(service, fork.id).messages
    expect(copied).toEqual([
      { ...held[0], id: `${fork.id}:message1` },
      { ...held[1], id: `${fork.id}:message2` },
    ])
    expect(copied[1]).not.toBe(held[1])
    expect(fork.fork?.boundary).toEqual({ type: "through", messageID: held[2]!.id })
    expect(held).toHaveLength(3)
    expect((await client.message.list({ sessionID: fork.id, order: "asc" })).data).toEqual(copied)
  })

  test("a session with no messages is an InvalidRequestError, and one that does not exist a SessionNotFoundError", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const { id } = await client.session.create()
    expect(await failure(client.session.fork({ sessionID: id }))).toMatchObject({
      _tag: "InvalidRequestError",
      message: `Cannot fork empty session: ${id}`,
      kind: "empty_session",
    })
    expect(service.state.sessions).toHaveLength(1)
    expect(await failure(client.session.fork({ sessionID: "ses_none" }))).toHaveProperty("name", "SessionNotFoundError")
  })

  test("a running session is forked all the same, and the fork is not its child", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const { id } = await client.session.create()
    await client.session.prompt({ sessionID: id, text: "go" })
    const child = fakeChild(service, id)
    const fork = await client.session.fork({ sessionID: id })
    expect(Object.keys(await client.session.active())).toEqual([id, child.id])
    expect(fork).not.toHaveProperty("parentID")
    expect(fork.time).not.toHaveProperty("busy")
    expect((await client.session.list({ parentID: id })).data.map((session) => session.id)).toEqual([child.id])
    expect((await client.session.list({ parentID: null })).data.map((session) => session.id)).toContain(fork.id)
  })
})
