import { describe, expect, test } from "bun:test"
import { OpenCode, isConflictError, isSessionNotFoundError, type OpenCodeClient } from "@opencode/client"
import { FAKE_ENDPOINT, createFakeService, fakeChild, fakeRuntime, fakeSession, type FakeService } from "./testing"

function clientOf(service: FakeService): OpenCodeClient {
  return OpenCode.make({ baseUrl: FAKE_ENDPOINT.url, headers: FAKE_ENDPOINT.headers, fetch: service.fetch })
}

const DEFAULT_DIRECTORY = "/work/acme"
const OTHER_DIRECTORY = "/work/other"
const MODEL = { id: "model-1", providerID: "acme" }
const RULES = [{ action: "bash", resource: "*", effect: "deny" as const }]

describe("the fake service's sessions", () => {
  test("a created session reads back as it was given, with the variant default", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const created = await client.session.create({
      agent: "plan",
      model: MODEL,
      metadata: { run: "one" },
      permissions: RULES,
      title: "Task",
      parentID: null,
    })
    expect(created).toMatchObject({
      agent: "plan",
      model: { ...MODEL, variant: "default" },
      metadata: { run: "one" },
      permissions: RULES,
      title: "Task",
      location: { directory: DEFAULT_DIRECTORY },
      projectID: `project:${DEFAULT_DIRECTORY}`,
      cost: 0,
      time: { created: service.clock.now, updated: service.clock.now },
    })
    expect(created).not.toHaveProperty("parentID")
    expect(await client.session.get({ sessionID: created.id })).toEqual(created)
    expect(created).not.toHaveProperty("prompts")
  })

  test("nothing is checked: an unknown agent and model are accepted, a null field is left out", async () => {
    const client = clientOf(createFakeService())
    const created = await client.session.create({
      agent: "nobody",
      model: { id: "none", providerID: "elsewhere", variant: "high" },
      title: null,
      metadata: null,
      permissions: null,
      location: { directory: OTHER_DIRECTORY },
    })
    expect(created.agent).toBe("nobody")
    expect(created.model).toEqual({ id: "none", providerID: "elsewhere", variant: "high" })
    expect(created.location.directory).toBe(OTHER_DIRECTORY)
    for (const field of ["title", "metadata", "permissions"]) expect(created).not.toHaveProperty(field)
  })

  test("an id that exists returns the first session unchanged, and ids descend", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const first = await client.session.create({ id: "ses_given", title: "First" })
    expect(await client.session.create({ id: "ses_given", title: "Second" })).toEqual(first)
    expect(service.state.sessions).toHaveLength(1)
    const a = await client.session.create()
    const b = await client.session.create()
    expect(b.id < a.id).toBe(true)
    expect(a.id).toStartWith("ses_")
  })

  test("sessions list newest update first, by directory and by parent", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const parent = await client.session.create({ id: "ses_parent" })
    service.clock.now += 10
    const child = await client.session.create({ parentID: parent.id, location: { directory: OTHER_DIRECTORY } })
    service.clock.now += 10
    const root = await client.session.create()
    const ids = async (input?: Parameters<OpenCodeClient["session"]["list"]>[0]) =>
      (await client.session.list(input)).data.map((session) => session.id)
    expect(await ids()).toEqual([root.id, child.id, parent.id])
    expect(await ids({ directory: OTHER_DIRECTORY })).toEqual([child.id])
    expect(await ids({ parentID: null })).toEqual([root.id, parent.id])
    expect(await ids({ parentID: parent.id })).toEqual([child.id])
    expect(await ids({ limit: 1 })).toEqual([root.id])
    expect((await client.session.list()).cursor).toEqual({})
  })

  test("an update replaces the whole value it carries and leaves the others", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const { id } = await client.session.create({ metadata: { a: 1, b: 2 }, permissions: RULES, title: "Old" })
    service.clock.now += 5
    await client.session.update({ sessionID: id, metadata: { c: 3 } })
    expect(fakeSession(service, id)).toMatchObject({ metadata: { c: 3 }, permissions: RULES, title: "Old" })
    expect(fakeSession(service, id).time.updated).toBe(service.clock.now)
    await client.session.update({ sessionID: id, title: "New", permissions: [] })
    expect(fakeSession(service, id)).toMatchObject({ metadata: { c: 3 }, permissions: [], title: "New" })
  })

  test("the agent and the model can be switched, with nothing checked", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const { id } = await client.session.create({ agent: "plan", model: MODEL })
    await client.session.switchAgent({ sessionID: id, agent: "nobody" })
    await client.session.switchModel({ sessionID: id, model: { id: "other", providerID: "elsewhere" } })
    expect(await client.session.get({ sessionID: id })).toMatchObject({
      agent: "nobody",
      model: { id: "other", providerID: "elsewhere", variant: "default" },
    })
  })

  test("an unknown session is a SessionNotFoundError on every route", async () => {
    const client = clientOf(createFakeService())
    const sessionID = "ses_none"
    const calls = [
      () => client.session.get({ sessionID }),
      () => client.session.update({ sessionID, title: "x" }),
      () => client.session.remove({ sessionID }),
      () => client.session.switchAgent({ sessionID, agent: "plan" }),
      () => client.session.prompt({ sessionID, text: "hi" }),
      () => client.session.inbox.list({ sessionID }),
      () => client.experimental.session.instructions.entry.list({ sessionID }),
    ]
    for (const call of calls) {
      const error = await call().catch((e: unknown) => e)
      expect(error).toHaveProperty("name", "SessionNotFoundError")
      expect(isSessionNotFoundError(error)).toBe(true)
      expect((error as Error).message).toBe("Session not found: ses_none")
    }
  })

  test("a removed session is gone, and no longer active", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const { id } = await client.session.create()
    await client.session.prompt({ sessionID: id, text: "go" })
    await client.session.remove({ sessionID: id })
    expect(service.state.sessions).toEqual([])
    expect(await client.session.active()).toEqual({})
  })

  test("reportsBack changes what is read, not what is stored", async () => {
    const service = createFakeService({ reportsBack: (session) => ({ ...session, agent: "other" }) })
    const client = clientOf(service)
    const created = await client.session.create({ agent: "plan" })
    expect(created.agent).toBe("other")
    expect((await client.session.get({ sessionID: created.id })).agent).toBe("other")
    expect((await client.session.list()).data[0]!.agent).toBe("other")
    expect(fakeSession(service, created.id).agent).toBe("plan")
  })

  test("a request's body is recorded, and absent when there is none", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const { id } = await client.session.create({ title: "T" })
    await client.session.get({ sessionID: id })
    expect(service.requests[0]!.body).toMatchObject({ title: "T" })
    expect(service.requests[1]).not.toHaveProperty("body")
  })

  test("a request without credentials answers 401 on a session route", async () => {
    const service = createFakeService()
    const bare = OpenCode.make({ baseUrl: FAKE_ENDPOINT.url, fetch: service.fetch })
    const error = await bare.session.list().catch((e: unknown) => e)
    expect(error).toHaveProperty("name", "UnauthorizedError")
  })

  test("the runtime shares the service's clock", () => {
    const service = createFakeService()
    expect(fakeRuntime(service).clock).toBe(service.clock)
  })
})

describe("the fake service's prompts", () => {
  test("a prompt returns its inbox item and makes the session active and busy", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const { id } = await client.session.create()
    service.clock.now += 7
    const item = await client.session.prompt({ sessionID: id, text: "hello" })
    expect(item).toEqual({
      id: item.id,
      sessionID: id,
      time: { created: service.clock.now },
      type: "user",
      payload: { text: "hello" },
      delivery: "steer",
    })
    expect(item.id).toStartWith("msg_")
    expect(await client.session.active()).toEqual({ [id]: { type: "running" } })
    expect((await client.session.get({ sessionID: id })).time.busy).toBe(service.clock.now)
    expect(fakeSession(service, id).prompts).toEqual([{ id: item.id, text: "hello", delivery: "steer" }])
    expect(await client.session.inbox.list({ sessionID: id })).toEqual([])
  })

  test("resume false, or a service that does not run prompts, leaves the item in the inbox", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const { id } = await client.session.create()
    const item = await client.session.prompt({ sessionID: id, text: "wait", resume: false, delivery: "queue" })
    expect(item.delivery).toBe("queue")
    expect(await client.session.active()).toEqual({})
    expect(await client.session.inbox.list({ sessionID: id })).toEqual([item])
    expect(fakeSession(service, id).time).not.toHaveProperty("busy")
    service.state.runsPrompts = false
    await client.session.prompt({ sessionID: id, text: "still" })
    expect(await client.session.active()).toEqual({})
    expect(fakeSession(service, id).inbox).toHaveLength(2)
  })

  test("the same id twice adds nothing; in another session it is a ConflictError", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const one = await client.session.create()
    const two = await client.session.create()
    const first = await client.session.prompt({ sessionID: one.id, id: "msg_same", text: "a" })
    expect(await client.session.prompt({ sessionID: one.id, id: "msg_same", text: "b" })).toEqual(first)
    expect(fakeSession(service, one.id).prompts).toHaveLength(1)
    const error = await client.session.prompt({ sessionID: two.id, id: "msg_same", text: "c" }).catch((e: unknown) => e)
    expect(error).toHaveProperty("name", "ConflictError")
    expect(isConflictError(error)).toBe(true)
    expect(fakeSession(service, two.id).prompts).toEqual([])
  })
})

describe("the fake service's instruction entries", () => {
  test("entries are put, listed and removed", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const entries = client.experimental.session.instructions.entry
    const { id } = await client.session.create()
    await entries.put({ sessionID: id, key: "note", value: "one" })
    await entries.put({ sessionID: id, key: "a.b-c_d", value: { n: 1 } })
    expect(await entries.list({ sessionID: id })).toEqual([
      { key: "note", value: "one" },
      { key: "a.b-c_d", value: { n: 1 } },
    ])
    await entries.remove({ sessionID: id, key: "note" })
    expect(fakeSession(service, id).entries).toEqual({ "a.b-c_d": { n: 1 } })
  })

  test("a key outside the pattern is an InvalidRequestError on put and on remove", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const entries = client.experimental.session.instructions.entry
    const { id } = await client.session.create()
    for (const key of ["Note", "a/b", "-dash", ".dot", "a b"]) {
      const expected = {
        _tag: "InvalidRequestError",
        message: 'Expected a string matching the RegExp ^[a-z0-9][a-z0-9._-]*$\n  at ["key"]',
        kind: "Params",
      }
      const put = await entries.put({ sessionID: id, key, value: 1 }).catch((e: unknown) => e)
      const remove = await entries.remove({ sessionID: id, key }).catch((e: unknown) => e)
      expect(put).toMatchObject(expected)
      expect(remove).toMatchObject(expected)
    }
    expect(fakeSession(service, id).entries).toEqual({})
  })

  test("a subagent's session has no entries, whatever its parent holds", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const entries = client.experimental.session.instructions.entry
    const { id } = await client.session.create()
    await entries.put({ sessionID: id, key: "note", value: "one" })
    const child = fakeChild(service, id)
    expect(await entries.list({ sessionID: child.id })).toEqual([])
    expect(fakeSession(service, child.id).entries).toEqual({})
  })

  test("a service that refuses them answers 404", async () => {
    const service = createFakeService({ entriesRefused: true })
    const client = clientOf(service)
    const { id } = await client.session.create()
    const error = await client.experimental.session.instructions.entry
      .put({ sessionID: id, key: "k", value: 1 })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toHaveProperty("_tag")
    expect(fakeSession(service, id).entries).toEqual({})
  })
})
