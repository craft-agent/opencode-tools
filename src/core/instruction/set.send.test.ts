import { describe, expect, test } from "bun:test"
import { liveRun, unownedSessions, writesOf } from "../run/control.testing"
import { NOTE_KEY } from "../run/note"
import { SESSION_NOT_FOUND } from "../service/errors"
import { requestsTo } from "../run/read.testing"
import { failure } from "../service/read.testing"
import { fakeChild, fakeEnd } from "../service/testing"
import { heldEntries, holdEntries, idleRun, keyOf, manyEntries, putOf, RUN, setEntryOf } from "./instruction.testing"
import { MAX_ENTRIES, MAX_ENTRY_VALUE } from "./limits"

const KEY = keyOf("goal")

describe("a set of a new key", () => {
  test("puts the text under the key, once, and is told at the next turn on an idle run", async () => {
    const { service, ctx } = idleRun()
    const result = await setEntryOf(KEY, "Keep the diff small.", ctx)
    expect(result).toEqual({
      service_started: false,
      session: RUN,
      key: KEY,
      changed: true,
      replaced: false,
      when: "next_turn",
    })
    const puts = requestsTo(service, `/instructions/entries/${KEY}`).filter((request) => request.method === "PUT")
    expect(puts).toHaveLength(1)
    expect(puts[0]!.body).toEqual({ value: "Keep the diff small." })
    expect(writesOf(service)).toEqual([putOf(KEY)])
    expect(heldEntries(service)).toEqual({ [KEY]: "Keep the diff small." })
  })

  test("is told at the next step on a run in flight", async () => {
    const { service, ctx } = liveRun()
    expect(await setEntryOf(KEY, "Keep the diff small.", ctx)).toMatchObject({ changed: true, when: "next_step" })
    expect(writesOf(service)).toEqual([putOf(KEY)])
  })

  test("is told at the next turn when only a subagent of the run is active", async () => {
    const { service, ctx } = liveRun()
    fakeChild(service, RUN)
    fakeEnd(service, RUN, "succeeded")
    expect(await setEntryOf(KEY, "x", ctx)).toMatchObject({ when: "next_turn" })
  })

  test("leaves the entries under other keys as they were", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { "person.x": "theirs", [NOTE_KEY]: "note" })
    await setEntryOf(KEY, "x", ctx)
    expect(heldEntries(service)).toEqual({ "person.x": "theirs", [NOTE_KEY]: "note", [KEY]: "x" })
  })
})

describe("a set of a key that is there", () => {
  test("replaces another value and says so", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { [KEY]: "old" })
    expect(await setEntryOf(KEY, "new", ctx)).toMatchObject({ changed: true, replaced: true, when: "next_turn" })
    expect(heldEntries(service)).toEqual({ [KEY]: "new" })
    expect(writesOf(service)).toEqual([putOf(KEY)])
  })

  test("replaces a value that is not a text", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { [KEY]: { n: 1 } })
    expect(await setEntryOf(KEY, '{"n":1}', ctx)).toMatchObject({ changed: true, replaced: true })
  })

  test("with the same text sends nothing, and says nothing changed", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { [KEY]: "same" })
    const result = await setEntryOf(KEY, "same", ctx)
    expect(result).toEqual({ service_started: false, session: RUN, key: KEY, changed: false, replaced: false })
    expect(writesOf(service)).toEqual([])
  })
})

describe("a set that is refused", () => {
  test("for a key of another form or the operating note sends no request at all", async () => {
    const { service, ctx } = idleRun()
    for (const key of ["note", "other.note", "opencode-tools.Upper", NOTE_KEY]) {
      await failure(setEntryOf(key, "x", ctx))
    }
    expect(service.requests).toEqual([])
  })

  test("for a blank value or one over the limit sends no request at all", async () => {
    const { service, ctx } = idleRun()
    const blank = await failure(setEntryOf(KEY, "  \n", ctx))
    expect([blank.code, blank.message]).toEqual(["invalid_argument", "value must not be blank."])
    expect((await failure(setEntryOf(KEY, "x".repeat(MAX_ENTRY_VALUE + 1), ctx))).code).toBe("invalid_argument")
    expect(service.requests).toEqual([])
  })

  test("for a 21st key is invalid_argument with the reason too_many, while a replacement of one of 20 goes through", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, manyEntries(MAX_ENTRIES))
    const error = await failure(setEntryOf(KEY, "x", ctx))
    expect([error.code, error.details]).toEqual(["invalid_argument", { reason: "too_many" }])
    expect(writesOf(service)).toEqual([])
    expect(await setEntryOf(keyOf("a3"), "replaced", ctx)).toMatchObject({ changed: true, replaced: true })
    expect(writesOf(service)).toEqual([putOf(keyOf("a3"))])
  })

  test("for a session that is not the caller's is not found, with nothing sent", async () => {
    const { service, ctx } = liveRun()
    for (const session of unownedSessions(service)) {
      const error = await failure(setEntryOf(KEY, "x", ctx, session))
      expect([error.code, error.message]).toEqual(["not_found", SESSION_NOT_FOUND])
    }
    expect(writesOf(service)).toEqual([])
  })

  test("by a service without the entry routes is upstream_error", async () => {
    const { ctx } = idleRun({ state: { entriesRefused: true } })
    expect((await failure(setEntryOf(KEY, "x", ctx))).code).toBe("upstream_error")
  })
})
