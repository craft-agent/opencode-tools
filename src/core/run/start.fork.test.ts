import { afterEach, describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { failure } from "../service/read.testing"
import { fakeSession, type FakeSession } from "../service/testing"
import { bindingOf, withBinding } from "./binding"
import { afterRequest, writesOf } from "./control.testing"
import { MARK, SOURCE, heldIds, seedSource } from "./fork.testing"
import { cleanup } from "./git.testing"
import { NOTE_KEY, noteFor } from "./note"
import {
  callsOf,
  expectedBinding,
  expectedRuleset,
  requestsTo,
  seedSession,
  startReadOnly,
  startSetup,
  startWrite,
  type StartSetup,
} from "./start.testing"

afterEach(cleanup)

const BRIEF = "Now build it."
const JSON_HEADERS = { "content-type": "application/json" }

/** The writes of a call that touch the source: all of them but the fork request. */
function writesToSource(setup: StartSetup): string[] {
  return writesOf(setup.service).filter((write) => write.includes(`/${SOURCE}`) && !write.endsWith("/fork"))
}

describe("fork without a session", () => {
  test("is refused before any request, whatever the tool", async () => {
    const setup = await startSetup()
    for (const call of [startReadOnly, startWrite]) {
      const role = call === startWrite ? "build" : "plan"
      const error = await failure(call({ role, brief: BRIEF, fork: true }, setup.ctx))
      expect([error.code, error.message]).toEqual(["invalid_argument", "fork needs session, the session to copy."])
    }
    expect(setup.service.requests).toEqual([])
  })

  test("false, with or without a session, changes nothing", async () => {
    const setup = await startSetup()
    await seedSource(setup)
    expect((await startReadOnly({ role: "plan", brief: BRIEF, fork: false }, setup.ctx)).new).toBe(true)
    const result = await startReadOnly({ role: "plan", brief: BRIEF, session: SOURCE, fork: false }, setup.ctx)
    expect(result).toMatchObject({ session: SOURCE, new: false })
    expect(result).not.toHaveProperty("forked_from")
    expect(requestsTo(setup.service, "/fork")).toEqual([])
  })
})

describe("a start on a fork", () => {
  test("copies a plan session and sets the copy up under a write role, then sends the brief to the copy", async () => {
    const setup = await startSetup()
    const source = await seedSource(setup, { metadata: withBinding(undefined, expectedBinding(setup)) })
    const before = structuredClone(source)
    const result = await startWrite({ role: "build", brief: BRIEF, session: SOURCE, fork: true }, setup.ctx)

    const id = result.session
    expect(id).not.toBe(SOURCE)
    expect(result).toEqual({
      session: id,
      new: true,
      forked_from: SOURCE,
      role: "build",
      agent: "build",
      policy: "write",
      model: "acme/model-1",
      directory: setup.directory,
      branch: "main",
      state: "running",
      note: "entry",
      service_started: false,
    })
    expect(callsOf(setup.service)).toEqual([
      "GET /api/info",
      `GET /api/session/${SOURCE}`,
      "GET /api/agent",
      "GET /api/model",
      "GET /api/model/default",
      "GET /api/session/active",
      `POST /api/session/${SOURCE}/fork`,
      `POST /api/session/${id}/agent`,
      `PATCH /api/session/${id}`,
      `GET /api/session/${id}`,
      "GET /api/session",
      `PUT /api/experimental/session/${id}/instructions/entries/${NOTE_KEY}`,
      `POST /api/session/${id}/prompt`,
    ])

    const copy = fakeSession(setup.service, id)
    expect(copy.fork?.sessionID).toBe(SOURCE)
    expect(copy.agent).toBe("build")
    expect(copy.permissions).toEqual(await expectedRuleset(setup, "write"))
    expect(bindingOf(copy.metadata)).toMatchObject({ ...expectedBinding(setup, "build"), starting: expect.anything() })
    expect(copy.entries[NOTE_KEY]).toBe(noteFor("write", undefined, undefined))
    expect(copy.prompts.map((prompt) => prompt.text)).toEqual([BRIEF])

    expect(writesToSource(setup)).toEqual([])
    expect(fakeSession(setup.service, SOURCE)).toEqual(before)
  })

  test("keeps the source's model where the role names none, and the other keys of its metadata", async () => {
    const moved = { providerID: "acme", id: "model-2", variant: "high" }
    const setup = await startSetup()
    await seedSource(setup, {
      model: moved,
      metadata: {
        other: { kept: true },
        ...withBinding(undefined, expectedBinding(setup, "plan", { starting: MARK })),
      },
    })
    const result = await startReadOnly({ role: "plan", brief: BRIEF, session: SOURCE, fork: true }, setup.ctx)
    expect(result.model).toBe("acme/model-2#high")
    const copy = fakeSession(setup.service, result.session)
    expect(copy.model).toEqual(moved)
    expect(copy.metadata!.other).toEqual({ kept: true })
    expect(requestsTo(setup.service, "/model").filter((request) => request.method === "POST")).toEqual([])
    expect(bindingOf(fakeSession(setup.service, SOURCE).metadata)?.starting).toEqual(MARK)
  })

  test("can be made again from the same source, each copy its own run", async () => {
    const setup = await startSetup()
    await seedSource(setup)
    const args = { role: "plan", brief: BRIEF, session: SOURCE, fork: true }
    const first = await startReadOnly(args, setup.ctx)
    setup.service.state.active = []
    const second = await startReadOnly(args, setup.ctx)
    expect(new Set([SOURCE, first.session, second.session]).size).toBe(3)
    expect(fakeSession(setup.service, SOURCE).prompts).toEqual([])
  })
})

describe("a start on a fork that is refused before the copy", () => {
  test("is refused while the source is running, or a subagent of it, with no fork request", async () => {
    const setup = await startSetup()
    await seedSource(setup, { active: true })
    const args = { role: "plan", brief: BRIEF, session: SOURCE, fork: true }
    const running = await failure(startReadOnly(args, setup.ctx))
    expect([running.message, running.details]).toEqual([
      `Session ${SOURCE} is running; a start needs it idle.`,
      { reason: "running" },
    ])
    setup.service.state.active = []
    seedSession(setup.service, { id: "ses_child", directory: setup.directory, parentID: SOURCE, active: true })
    expect((await failure(startReadOnly(args, setup.ctx))).details).toEqual({ reason: "running" })
    expect(writesOf(setup.service)).toEqual([])
  })

  test("is refused for a write run while another session runs in the worktree", async () => {
    const setup = await startSetup()
    await seedSource(setup)
    seedSession(setup.service, { id: "ses_other", directory: setup.directory, active: true })
    const error = await failure(startWrite({ role: "build", brief: BRIEF, session: SOURCE, fork: true }, setup.ctx))
    expect(error.details).toEqual({ reason: "worktree_busy" })
    expect(writesOf(setup.service)).toEqual([])
  })

  test("is refused for a session that is not the caller's", async () => {
    const setup = await startSetup()
    seedSession(setup.service, { id: SOURCE, directory: setup.directory })
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF, session: SOURCE, fork: true }, setup.ctx))
    expect(error.code).toBe("not_found")
    expect(writesOf(setup.service)).toEqual([])
  })
})

describe("a start on a fork that gives up after the copy", () => {
  /** The source as it was, and no session but it: the copy is gone. */
  function expectOnlyTheSource(setup: StartSetup, before: FakeSession): void {
    expect(heldIds(setup)).toEqual([SOURCE])
    expect(fakeSession(setup.service, SOURCE)).toEqual(before)
    expect(writesToSource(setup)).toEqual([])
  }

  test("removes the copy when the read-back differs, and sends no brief", async () => {
    const reportsBack = (session: SessionInfo) => (session.id === SOURCE ? session : { ...session, agent: "other" })
    const setup = await startSetup({ state: { reportsBack } })
    const source = await seedSource(setup)
    const before = structuredClone(source)
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF, session: SOURCE, fork: true }, setup.ctx))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("(agent)")
    expect(requestsTo(setup.service, "/prompt")).toEqual([])
    expectOnlyTheSource(setup, before)
  })

  test("removes the copy when it cannot be set up", async () => {
    const setup = await startSetup()
    const source = await seedSource(setup)
    const before = structuredClone(source)
    // The first request after the fork is the update of the copy.
    afterRequest(setup.runtime, "POST", /\/fork$/, () =>
      setup.service.failNext(/\/api\/session\/[^/]+$/, new Response("{}", { status: 500, headers: JSON_HEADERS })),
    )
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF, session: SOURCE, fork: true }, setup.ctx))
    expect(error.code).toBe("upstream_error")
    expect(requestsTo(setup.service, "/prompt")).toEqual([])
    expectOnlyTheSource(setup, before)
  })

  test("removes the copy when another start's mark is found", async () => {
    const setup = await startSetup()
    const source = await seedSource(setup)
    const before = structuredClone(source)
    const rival = {
      ...expectedBinding(setup, "plan", { caller: "someone-else" }),
      starting: { at: setup.service.clock.now, token: "rival" },
    }
    seedSession(setup.service, { id: "ses_rival", directory: setup.directory, metadata: withBinding(undefined, rival) })
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF, session: SOURCE, fork: true }, setup.ctx))
    expect(error.code).toBe("stale")
    expect(heldIds(setup)).toEqual([SOURCE, "ses_rival"])
    expect(fakeSession(setup.service, SOURCE)).toEqual(before)
    expect(writesToSource(setup)).toEqual([])
  })

  test("removes the copy when the service refuses the brief", async () => {
    const setup = await startSetup()
    const source = await seedSource(setup)
    const before = structuredClone(source)
    const body = JSON.stringify({ _tag: "InvalidRequestError", message: "text is odd" })
    setup.service.failNext(/\/prompt$/, new Response(body, { status: 400, headers: JSON_HEADERS }))
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF, session: SOURCE, fork: true }, setup.ctx))
    expect(error.code).toBe("invalid_argument")
    expect(requestsTo(setup.service, "/prompt")).toHaveLength(1)
    expectOnlyTheSource(setup, before)
  })

  test("keeps the copy once the brief is sent, even when its admission is not confirmed", async () => {
    const setup = await startSetup()
    await seedSource(setup)
    setup.service.failNext(/\/prompt$/, new TypeError("connection reset"))
    const result = await startReadOnly({ role: "plan", brief: BRIEF, session: SOURCE, fork: true }, setup.ctx)
    expect(result).toMatchObject({ state: "unknown", new: true, forked_from: SOURCE })
    expect(heldIds(setup)).toEqual([SOURCE, result.session])
  })
})
