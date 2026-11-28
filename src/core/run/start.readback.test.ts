import { afterEach, describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { failure } from "../service/read.testing"
import { fakeSession } from "../service/testing"
import { BINDING_KEY, bindingOf, withBinding } from "./binding"
import { cleanup } from "./git.testing"
import {
  expectedBinding,
  requestsTo,
  seedRun,
  seedSession,
  startReadOnly,
  startSetup,
  type SeededSession,
  type StartSetup,
} from "./start.testing"

afterEach(cleanup)

const BRIEF = "Look around."
const OTHER_CALLER = "someone-else"
const OTHER_DIRECTORY = "/work/elsewhere"
const MINUTE_MS = 60_000
const NOTE_PATH = "/entries/opencode-tools.note"

/** The session as a service that changed one binding field would report it. */
function withBindingField(session: SessionInfo, fields: Record<string, unknown>): SessionInfo {
  const binding = session.metadata![BINDING_KEY] as object
  return {
    ...session,
    metadata: { ...session.metadata, [BINDING_KEY]: { ...binding, ...fields } } as SessionInfo["metadata"],
  }
}

const CHANGES: [part: string, change: (session: SessionInfo) => SessionInfo][] = [
  ["agent", (session) => ({ ...session, agent: "build" })],
  ["model", (session) => ({ ...session, model: { ...session.model!, id: "model-2" } })],
  ["model", (session) => ({ ...session, model: { ...session.model!, variant: "high" } })],
  ["ruleset", (session) => ({ ...session, permissions: session.permissions!.slice(1) })],
  ["ruleset", (session) => ({ ...session, permissions: [...session.permissions!].reverse() })],
  [
    "ruleset",
    (session) => ({
      ...session,
      permissions: session.permissions!.map((rule, index) => (index === 0 ? { ...rule, effect: "allow" } : rule)),
    }),
  ],
  ["binding", (session) => withBindingField(session, { role: "other" })],
  ["binding", (session) => withBindingField(session, { branch: "side" })],
  ["directory", (session) => ({ ...session, location: { directory: "/somewhere/else" } })],
]

describe("the read-back of a new session", () => {
  test.each(CHANGES)(
    "a service that reports another %s sends no brief and removes the session",
    async (part, change) => {
      const setup = await startSetup({ state: { reportsBack: change } })
      const error = await failure(startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx))
      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe(
        `The OpenCode service did not report back the session as it was set up (${part}); no brief was sent.`,
      )
      expect(requestsTo(setup.service, "/prompt")).toEqual([])
      expect(requestsTo(setup.service, NOTE_PATH)).toEqual([])
      expect(setup.service.requests.filter((request) => request.method === "DELETE")).toHaveLength(1)
      expect(setup.service.state.sessions).toEqual([])
    },
  )

  test("names every part that differs, in the order of the checks", async () => {
    const setup = await startSetup({
      state: { reportsBack: (session) => ({ ...session, location: { directory: "/x" }, agent: "build" }) },
    })
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx))
    expect(error.message).toContain("(agent, directory)")
  })

  test("does not mind that a model sent without a variant is stored with the variant default", async () => {
    const roles = { plain: { agent: "plan", policy: "read-only", model: "acme/model-1#default" } }
    const setup = await startSetup({ options: { roles } })
    const result = await startReadOnly({ role: "plain", brief: BRIEF }, setup.ctx)
    expect(result).toMatchObject({ state: "running", model: "acme/model-1" })
    expect(fakeSession(setup.service, result.session).model).toEqual({
      providerID: "acme",
      id: "model-1",
      variant: "default",
    })
  })

  test("reports the difference even when the removal of the session fails", async () => {
    let reads = 0
    const holder: { setup?: StartSetup } = {}
    const reportsBack = (session: SessionInfo): SessionInfo => {
      reads += 1
      // The creation is the first report and the read-back the second: the request after it is the removal.
      if (reads === 2) {
        holder.setup!.service.failNext(/\/api\/session\/[^/]+$/, new Response("{}", { status: 500 }))
      }
      return { ...session, agent: "build" }
    }
    holder.setup = await startSetup({ state: { reportsBack } })
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF }, holder.setup.ctx))
    expect(error.message).toContain("(agent)")
    expect(holder.setup.service.state.sessions).toHaveLength(1)
  })
})

/** A session of another caller in `setup`'s checkout that marked its start at `at`, unless `init` says otherwise. */
function rivalOf(setup: StartSetup, at: number, init: Partial<SeededSession> = {}): SeededSession {
  const binding = { ...expectedBinding(setup, "plan", { caller: OTHER_CALLER }), starting: { at, token: "rival" } }
  return { id: "ses_rival", directory: setup.directory, metadata: withBinding(undefined, binding), ...init }
}

describe("another start in the same directory", () => {
  test("marked a moment ago, whoever's it is, makes the start stale and removes the new session", async () => {
    const setup = await startSetup()
    seedSession(setup.service, rivalOf(setup, setup.service.clock.now))
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx))
    expect(error.code).toBe("stale")
    expect(error.message).toBe(`Another call is starting a run in "${setup.directory}"; try again in a moment.`)
    expect(setup.service.state.sessions.map((session) => session.id)).toEqual(["ses_rival"])
    expect(requestsTo(setup.service, "/prompt")).toEqual([])
    expect(requestsTo(setup.service, NOTE_PATH)).toEqual([])
  })

  const NOT_RIVALS: [string, (setup: StartSetup) => SeededSession][] = [
    ["a mark older than a minute", (s) => rivalOf(s, s.service.clock.now - 2 * MINUTE_MS)],
    ["a mark that far in the future", (s) => rivalOf(s, s.service.clock.now + 2 * MINUTE_MS)],
    ["a rival that has run since its mark", (s) => rivalOf(s, s.service.clock.now - 10, { busy: s.service.clock.now })],
    ["a rival in another directory", (s) => rivalOf(s, s.service.clock.now, { directory: OTHER_DIRECTORY })],
    ["a subagent's session", (s) => rivalOf(s, s.service.clock.now, { parentID: "ses_parent" })],
    ["a session with no binding", (s) => ({ id: "ses_person", directory: s.directory })],
  ]

  test.each(NOT_RIVALS)("does not count %s", async (_name, rival) => {
    const setup = await startSetup()
    seedSession(setup.service, rival(setup))
    expect((await startReadOnly({ role: "plan", brief: BRIEF }, setup.ctx)).state).toBe("running")
  })

  test("takes back the mark of a continued session, which stays", async () => {
    const setup = await startSetup()
    await seedRun(setup, "ses_mine", "plan", {
      metadata: { other: "kept", ...withBinding(undefined, expectedBinding(setup)) },
    })
    seedSession(setup.service, rivalOf(setup, setup.service.clock.now))
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx))
    expect(error.code).toBe("stale")
    const kept = fakeSession(setup.service, "ses_mine")
    expect(bindingOf(kept.metadata)).toEqual(expectedBinding(setup))
    expect(kept.metadata!.other).toBe("kept")
    expect(kept.prompts).toEqual([])
    expect(setup.service.state.sessions).toHaveLength(2)
  })
})

describe("the read-back of a continued session", () => {
  test("that carries another call's mark is stale, and the mark is taken back", async () => {
    const reportsBack = (session: SessionInfo) =>
      session.id === "ses_mine" ? withBindingField(session, { starting: { at: 1, token: "rival" } }) : session
    const setup = await startSetup({ state: { reportsBack } })
    await seedRun(setup, "ses_mine")
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx))
    expect(error.code).toBe("stale")
    expect(error.message).toBe("Another call is continuing session ses_mine; try again in a moment.")
    expect(bindingOf(fakeSession(setup.service, "ses_mine").metadata)).toEqual(expectedBinding(setup))
    expect(requestsTo(setup.service, "/prompt")).toEqual([])
  })

  test("that differs in another way is an upstream error, and the session is kept unmarked", async () => {
    const reportsBack = (session: SessionInfo) => (session.id === "ses_mine" ? { ...session, agent: "build" } : session)
    const setup = await startSetup({ state: { reportsBack } })
    await seedRun(setup, "ses_mine")
    const error = await failure(startReadOnly({ role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("(agent)")
    expect(bindingOf(fakeSession(setup.service, "ses_mine").metadata)?.starting).toBeUndefined()
    expect(setup.service.state.sessions.map((session) => session.id)).toEqual(["ses_mine"])
  })
})
