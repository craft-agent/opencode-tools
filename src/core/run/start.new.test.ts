import { afterEach, describe, expect, test } from "bun:test"
import { failure } from "../service/read.testing"
import { fakeSession } from "../service/testing"
import { BINDING_KEY } from "./binding"
import { cleanup } from "./git.testing"
import { NOTE_KEY, noteFor } from "./note"
import { UNCONFIRMED_ADMISSION } from "./start.prompt"
import {
  callsOf,
  expectedBinding,
  expectedRuleset,
  requestsTo,
  startReadOnly,
  startSetup,
  startWrite,
} from "./start.testing"

afterEach(cleanup)

const BRIEF = "Review the diff."
const JSON_HEADERS = { "content-type": "application/json" }

describe("a new read-only run", () => {
  test("sets the session up, reads it back and sends the brief, in that order", async () => {
    const { service, ctx, directory } = await startSetup()
    const result = await startReadOnly({ role: "plan", brief: BRIEF }, ctx)

    const id = result.session
    expect(id).toStartWith("ses_")
    expect(result).toEqual({
      session: id,
      new: true,
      role: "plan",
      agent: "plan",
      policy: "read-only",
      model: "acme/model-1",
      directory,
      branch: "main",
      state: "running",
      note: "entry",
      service_started: false,
    })
    expect(callsOf(service)).toEqual([
      "GET /api/info",
      "GET /api/agent",
      "GET /api/model",
      "GET /api/model/default",
      "POST /api/session",
      `GET /api/session/${id}`,
      "GET /api/session",
      `PUT /api/experimental/session/${id}/instructions/entries/${NOTE_KEY}`,
      `POST /api/session/${id}/prompt`,
    ])
  })

  test("sends the agent, the model, the ruleset and the marked binding in the creation", async () => {
    const setup = await startSetup()
    await startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx)
    const created = requestsTo(setup.service, "/api/session").find((request) => request.method === "POST")!
    const body = created.body as { metadata: Record<string, { starting: { at: number; token: string } }> }
    const { starting } = body.metadata[BINDING_KEY]!
    expect(starting.at).toBeGreaterThan(0)
    expect(starting.at).toBeLessThanOrEqual(setup.service.clock.now)
    expect(starting.token).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.body).toEqual({
      location: { directory: setup.directory },
      agent: "plan",
      model: { providerID: "acme", id: "model-1" },
      permissions: await expectedRuleset(setup, "read-only"),
      metadata: { [BINDING_KEY]: { ...expectedBinding(setup), starting } },
    })
  })

  test("looks at the directory's root sessions, then puts the note and sends the brief queued", async () => {
    const setup = await startSetup()
    const { session } = await startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx)
    const [list] = requestsTo(setup.service, "/api/session").filter((request) => request.method === "GET")
    expect(list!.query).toMatchObject({ directory: setup.directory, parentID: "null", limit: "100" })

    const [entry] = requestsTo(setup.service, NOTE_KEY)
    expect(entry!.body).toEqual({ value: noteFor("read-only", undefined, undefined) })
    const [prompt] = requestsTo(setup.service, "/prompt")
    expect(prompt!.body).toMatchObject({ text: BRIEF, delivery: "queue" })
    expect((prompt!.body as { id: string }).id).toMatch(/^msg_[0-9a-f]{32}$/)

    expect(setup.service.state.active).toEqual([session])
    expect(fakeSession(setup.service, session).prompts).toEqual([
      { id: (prompt!.body as { id: string }).id, text: BRIEF, delivery: "queue" },
    ])
  })

  test("sends a model's variant, and the agent's own model when the role names none", async () => {
    const setup = await startSetup({
      options: {
        roles: {
          deep: { agent: "plan", policy: "read-only", model: "acme/model-2#high" },
          plain: { agent: "plan", policy: "read-only" },
        },
      },
    })
    const deep = await startReadOnly({ role: "deep", brief: BRIEF }, setup.ctx)
    expect(deep.model).toBe("acme/model-2#high")
    const created = requestsTo(setup.service, "/api/session").find((request) => request.method === "POST")!
    expect(created.body).toMatchObject({ model: { providerID: "acme", id: "model-2", variant: "high" } })
    expect((await startReadOnly({ role: "plain", brief: BRIEF }, setup.ctx)).model).toBe("acme/model-1")
  })

  test("reports that it started the service", async () => {
    const setup = await startSetup({ runtime: { running: false } })
    expect((await startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx)).service_started).toBe(true)
  })

  test("works in a directory given, and gives the session the real path", async () => {
    const setup = await startSetup()
    const other = { ...setup.ctx, cwd: "/elsewhere" }
    const result = await startReadOnly({ role: "plan", brief: BRIEF, directory: setup.directory }, other)
    expect(result.directory).toBe(setup.directory)
  })
})

describe("a new write run", () => {
  test("is started by the write tool with the write ruleset and a build role's policy", async () => {
    const setup = await startSetup()
    const result = await startWrite({ role: "build", brief: BRIEF }, setup.ctx)
    expect(result).toMatchObject({ role: "build", agent: "build", policy: "write", new: true, state: "running" })
    const created = requestsTo(setup.service, "/api/session").find((request) => request.method === "POST")!
    expect(created.body).toMatchObject({ permissions: await expectedRuleset(setup, "write"), agent: "build" })
    const text = requestsTo(setup.service, NOTE_KEY)[0]!.body
    expect(text).toEqual({ value: noteFor("write", undefined, undefined) })
  })
})

describe("the operating note", () => {
  test("is an instruction entry, with the setting's note and the role's after the package's", async () => {
    const setup = await startSetup({
      options: {
        note: "From the setting.",
        roles: { plan: { agent: "plan", policy: "read-only", note: "From the role." } },
      },
    })
    const { session, note } = await startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx)
    expect(note).toBe("entry")
    expect(fakeSession(setup.service, session).entries[NOTE_KEY]).toBe(
      noteFor("read-only", "From the setting.", "From the role."),
    )
    expect(fakeSession(setup.service, session).prompts[0]!.text).toBe(BRIEF)
  })

  test("heads the brief when the service refuses entries", async () => {
    const setup = await startSetup({ state: { entriesRefused: true } })
    const { session, note, state } = await startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx)
    expect(note).toBe("prompt")
    expect(state).toBe("running")
    const held = fakeSession(setup.service, session)
    expect(held.entries).toEqual({})
    expect(held.prompts[0]!.text).toBe(`${noteFor("read-only", undefined, undefined)}\n\n${BRIEF}`)
  })
})

describe("the brief's admission", () => {
  test("that fails in transit is unknown, and the brief is sent once", async () => {
    const setup = await startSetup()
    setup.service.failNext(/\/prompt$/, new TypeError("connection reset"))
    const result = await startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx)
    expect(result).toMatchObject({ state: "unknown", message: UNCONFIRMED_ADMISSION, new: true, note: "entry" })
    expect(requestsTo(setup.service, "/prompt")).toHaveLength(1)
    expect(setup.service.state.sessions).toHaveLength(1)
  })

  test("that the service answers with another status is unknown", async () => {
    const setup = await startSetup()
    setup.service.failNext(/\/prompt$/, new Response("{}", { status: 500, headers: JSON_HEADERS }))
    expect((await startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx)).state).toBe("unknown")
    expect(requestsTo(setup.service, "/prompt")).toHaveLength(1)
  })

  test("that the service refuses is an invalid argument, and the empty session is removed", async () => {
    const setup = await startSetup()
    const body = JSON.stringify({ _tag: "InvalidRequestError", message: "text is odd" })
    setup.service.failNext(/\/prompt$/, new Response(body, { status: 400, headers: JSON_HEADERS }))
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("text is odd")
    expect(requestsTo(setup.service, "/prompt")).toHaveLength(1)
    expect(setup.service.state.sessions).toEqual([])
  })
})
