import { afterEach, describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { SESSION_NOT_FOUND } from "../service/errors"
import { failure } from "../service/read.testing"
import { fakeSession } from "../service/testing"
import { BINDING_KEY, bindingOf, withBinding } from "./binding"
import { afterRequest, writesOf } from "./control.testing"
import { MARK, RUNNING, SOURCE, TITLE, forkOf, heldIds, seedSource, unownedSessions } from "./fork.testing"
import { cleanup, git } from "./git.testing"
import { expectedBinding, requestsTo, seedSession, startSetup, type StartSetup } from "./start.testing"

afterEach(cleanup)

describe("a fork", () => {
  test("is a new session bound as its source is, with its title, and says what it was copied from", async () => {
    const setup = await startSetup()
    await seedSource(setup)
    const result = await forkOf(SOURCE, setup.ctx)
    expect(result).toEqual({
      service_started: false,
      session: result.session,
      forked_from: SOURCE,
      role: "plan",
      title: `${TITLE} (fork #1)`,
      directory: setup.directory,
      branch: "main",
    })
    expect(result.session).not.toBe(SOURCE)
    const copy = fakeSession(setup.service, result.session)
    expect(copy.fork?.sessionID).toBe(SOURCE)
    expect(copy.parentID).toBeUndefined()
    expect(bindingOf(copy.metadata)).toEqual(expectedBinding(setup))
  })

  test("is bound without the mark its source still had, and keeps every other key of the metadata", async () => {
    const setup = await startSetup()
    const binding = expectedBinding(setup, "plan", { starting: MARK })
    await seedSource(setup, { metadata: { other: { kept: [1] }, ...withBinding(undefined, binding) } })
    const { session } = await forkOf(SOURCE, setup.ctx)
    const copy = fakeSession(setup.service, session)
    expect(copy.metadata).toEqual({ other: { kept: [1] }, ...withBinding(undefined, expectedBinding(setup)) })
    expect(bindingOf(fakeSession(setup.service, SOURCE).metadata)).toEqual(binding)
  })

  test("has the role of its source, whichever it is", async () => {
    const setup = await startSetup()
    await seedSource(setup, {}, "build")
    const { session, role } = await forkOf(SOURCE, setup.ctx)
    expect(role).toBe("build")
    expect(bindingOf(fakeSession(setup.service, session).metadata)?.role).toBe("build")
  })

  test("leaves the source as it was: it is read, never written to or sent a prompt", async () => {
    const setup = await startSetup()
    const source = await seedSource(setup)
    const before = structuredClone(source)
    const { session } = await forkOf(SOURCE, setup.ctx)
    expect(writesOf(setup.service)).toEqual([`POST /api/session/${SOURCE}/fork`, `PATCH /api/session/${session}`])
    expect(fakeSession(setup.service, SOURCE)).toEqual(before)
  })

  test("has no title when its source has none", async () => {
    const setup = await startSetup()
    const source = await seedSource(setup)
    delete source.title
    expect(await forkOf(SOURCE, setup.ctx)).not.toHaveProperty("title")
  })

  test("cuts a long title of the copy as a read does", async () => {
    const setup = await startSetup()
    const source = await seedSource(setup)
    source.title = `${"t".repeat(150)}\nsecond line`
    const { title } = await forkOf(SOURCE, setup.ctx)
    expect([...title!]).toHaveLength(100)
    expect(title).toEndWith("…")
  })

  test("is a second copy of the same source, never the first", async () => {
    const setup = await startSetup()
    await seedSource(setup)
    const first = await forkOf(SOURCE, setup.ctx)
    const second = await forkOf(SOURCE, setup.ctx)
    expect(second.session).not.toBe(first.session)
    expect(heldIds(setup)).toHaveLength(3)
  })
})

describe("a source that is running", () => {
  test("is refused as running with no fork request, when its own session is active", async () => {
    const setup = await startSetup()
    await seedSource(setup, { active: true })
    const error = await failure(forkOf(SOURCE, setup.ctx))
    expect([error.code, error.message, error.details]).toEqual(["invalid_argument", RUNNING, { reason: "running" }])
    expect(requestsTo(setup.service, "/fork")).toEqual([])
    expect(writesOf(setup.service)).toEqual([])
  })

  test("is refused while only a subagent of it, or a subagent's subagent, is active", async () => {
    const setup = await startSetup()
    await seedSource(setup)
    seedSession(setup.service, { id: "ses_child", directory: setup.directory, parentID: SOURCE })
    seedSession(setup.service, {
      id: "ses_grandchild",
      directory: setup.directory,
      parentID: "ses_child",
      active: true,
    })
    const error = await failure(forkOf(SOURCE, setup.ctx))
    expect([error.message, error.details]).toEqual([RUNNING, { reason: "running" }])
    setup.service.state.active = ["ses_child"]
    expect((await failure(forkOf(SOURCE, setup.ctx))).details).toEqual({ reason: "running" })
    expect(requestsTo(setup.service, "/fork")).toEqual([])
  })

  test("is not refused for another session that is active", async () => {
    const setup = await startSetup()
    await seedSource(setup)
    seedSession(setup.service, { id: "ses_other", directory: setup.directory, active: true })
    expect((await forkOf(SOURCE, setup.ctx)).forked_from).toBe(SOURCE)
  })
})

describe("a source that cannot be forked", () => {
  test("is not found when it is another caller's, a person's, a subagent's or missing", async () => {
    const setup = await startSetup()
    await seedSource(setup)
    for (const session of await unownedSessions(setup)) {
      const error = await failure(forkOf(session, setup.ctx))
      expect([error.code, error.message]).toEqual(["not_found", SESSION_NOT_FOUND])
    }
    expect(requestsTo(setup.service, "/fork")).toEqual([])
  })

  test("is stale when it left its branch, with the start's message and nothing sent", async () => {
    const setup = await startSetup()
    await seedSource(setup)
    git(setup.directory, "checkout", "-b", "side")
    const error = await failure(forkOf(SOURCE, setup.ctx))
    expect([error.code, error.message]).toEqual([
      "stale",
      `Session ${SOURCE} has left the worktree it was bound to (branch was "main", is "side"); start a new session.`,
    ])
    expect(writesOf(setup.service)).toEqual([])
  })

  test("is an invalid argument when it holds no messages, and nothing is left behind", async () => {
    const setup = await startSetup()
    const source = await seedSource(setup)
    source.messages.length = 0
    const error = await failure(forkOf(SOURCE, setup.ctx))
    expect(error.code).toBe("invalid_argument")
    expect(heldIds(setup)).toEqual([SOURCE])
    expect(writesOf(setup.service)).toEqual([`POST /api/session/${SOURCE}/fork`])
  })
})

describe("a copy that cannot be bound", () => {
  test("is removed when the binding cannot be written, and the call fails as the service did", async () => {
    const setup = await startSetup()
    await seedSource(setup)
    afterRequest(setup.runtime, "POST", /\/fork$/, () =>
      setup.service.failNext(/\/api\/session\/[^/]+$/, new Response("{}", { status: 500 })),
    )
    const error = await failure(forkOf(SOURCE, setup.ctx))
    expect(error.code).toBe("upstream_error")
    expect(heldIds(setup)).toEqual([SOURCE])
    expect(writesOf(setup.service).filter((write) => write.startsWith("DELETE"))).toHaveLength(1)
  })

  test("is removed when the service cannot read it back, and the call fails as that", async () => {
    const setup = await startSetup()
    await seedSource(setup)
    afterRequest(setup.runtime, "PATCH", /\/api\/session\/[^/]+$/, () =>
      setup.service.failNext(/\/api\/session\/[^/]+$/, new Response("{}", { status: 500 })),
    )
    const error = await failure(forkOf(SOURCE, setup.ctx))
    expect(error.code).toBe("upstream_error")
    expect(heldIds(setup)).toEqual([SOURCE])
  })

  const CHANGES: [part: string, change: (session: SessionInfo) => SessionInfo][] = [
    [
      "binding",
      (session) => ({
        ...session,
        metadata: { ...session.metadata, [BINDING_KEY]: { ...(session.metadata![BINDING_KEY] as object), role: "x" } },
      }),
    ],
    ["directory", (session) => ({ ...session, location: { directory: "/somewhere/else" } })],
    ["parent", (session) => ({ ...session, parentID: "ses_parent" })],
  ]

  test.each(CHANGES)(
    "is removed when the service reports another %s, which the failure names",
    async (part, change) => {
      const reportsBack = (session: SessionInfo) => (session.id === SOURCE ? session : change(session))
      const setup = await startSetup({ state: { reportsBack } })
      await seedSource(setup)
      const error = await failure(forkOf(SOURCE, setup.ctx))
      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe(
        `The OpenCode service did not report back the fork as it was bound (${part}); the copy was removed.`,
      )
      expect(heldIds(setup)).toEqual([SOURCE])
      expect(writesOf(setup.service).filter((write) => write.startsWith("DELETE"))).toHaveLength(1)
    },
  )

  test("names every part that differs, in order, and fails with the difference when the removal fails too", async () => {
    const holder: { setup?: StartSetup } = {}
    let reads = 0
    const reportsBack = (session: SessionInfo): SessionInfo => {
      if (session.id === SOURCE) return session
      reads += 1
      // The fork's reply is the first report and the read-back the second: the request after it is the removal.
      if (reads === 2) holder.setup!.service.failNext(/\/api\/session\/[^/]+$/, new Response("{}", { status: 500 }))
      return { ...session, location: { directory: "/x" }, parentID: "ses_parent" }
    }
    holder.setup = await startSetup({ state: { reportsBack } })
    await seedSource(holder.setup)
    const error = await failure(forkOf(SOURCE, holder.setup.ctx))
    expect(error.message).toContain("(directory, parent)")
    expect(heldIds(holder.setup)).toHaveLength(2)
  })
})
