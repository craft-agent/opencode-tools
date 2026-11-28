import { describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { PROJECT } from "../../project"
import { ALL_TOOLS } from "../../tools"
import { liveRun, unownedSessions, writesOf } from "../run/control.testing"
import { NOTE_KEY } from "../run/note"
import { DIRECTORY } from "../run/read.testing"
import { SESSION_NOT_FOUND } from "../service/errors"
import { failure } from "../service/read.testing"
import { ANY_TARGET, writeTargets } from "../targets"
import { annotations, defineTool } from "../tool"
import { deleteOf, heldEntries, holdEntries, idleRun, keyOf, removeEntryOf, RUN } from "./instruction.testing"
import { opencodeInstructionRemove } from "./remove.tool"

const tool = opencodeInstructionRemove
const KEY = keyOf("goal")

describe("the spec", () => {
  test("is opencode_instruction_remove, an overwrite tool of the instruction toolset, with nothing to bound", () => {
    expect(tool.id).toBe("opencode_instruction_remove")
    expect(tool.toolset).toBe("instruction")
    expect(tool.class).toBe("overwrite")
    expect(tool.intent).toBe("About to remove an instruction entry")
    expect(annotations(tool)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    })
    expect(() => defineTool(tool)).not.toThrow()
    expect(ALL_TOOLS).toContain(tool)
    expect(PROJECT.toolsets).toContain(tool.toolset)
    expect(tool.bounds).toBeUndefined()
    expect(Object.keys(tool.input.shape).sort()).toEqual(["key", "session"])
  })

  test("describes what it removes, when the agent is told, the refusals and the results", () => {
    const { description } = tool
    for (const text of [
      "`opencode-tools.<name>`",
      "removes nothing and sends nothing",
      "`removed` is false",
      "the reason `key`",
      `\`${NOTE_KEY}\` is the operating note`,
      "`forbidden` with the reason `reserved`",
      "are not found",
      "`upstream_error`",
      "present only when `removed`",
      "`service_started`",
      "`wait_seconds`",
    ]) {
      expect(description).toContain(text)
    }
  })
})

describe("targets and gate", () => {
  test("target the run's directory, and cannot tell it for a session that is not the caller's", async () => {
    const { service, ctx } = idleRun()
    expect(await writeTargets(tool, { session: RUN, key: KEY }, ctx)).toEqual([DIRECTORY])
    expect(await writeTargets(tool, { session: "ses_none", key: KEY }, ctx)).toEqual([ANY_TARGET])
    expect(writesOf(service)).toEqual([])
  })

  test("refuse a key of another form and the operating note before the service is asked", async () => {
    const { service, ctx } = idleRun()
    const key = await failure(Promise.resolve(tool.gate!({ session: RUN, key: "note" }, ctx)))
    expect([key.code, key.details]).toEqual(["invalid_argument", { reason: "key" }])
    const reserved = await failure(Promise.resolve(tool.gate!({ session: RUN, key: NOTE_KEY }, ctx)))
    expect([reserved.code, reserved.details]).toEqual(["forbidden", { reason: "reserved" }])
    expect(service.requests).toEqual([])
  })

  test("refuse a session of another caller, a person's own, a subagent's and a missing one as not found", async () => {
    const { service, ctx } = liveRun()
    for (const session of unownedSessions(service)) {
      const error = await failure(Promise.resolve(tool.gate!({ session, key: KEY }, ctx)))
      expect([error.code, error.message]).toEqual(["not_found", SESSION_NOT_FOUND])
      expect((await failure(removeEntryOf(KEY, ctx, session))).code).toBe("not_found")
    }
    expect(writesOf(service)).toEqual([])
  })
})

describe("a remove of a key that is there", () => {
  test("removes the entry and is told at the next turn on an idle run", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { [KEY]: "Keep it small.", [keyOf("other")]: "stays" })
    expect(await removeEntryOf(KEY, ctx)).toEqual({
      service_started: false,
      session: RUN,
      key: KEY,
      removed: true,
      when: "next_turn",
    })
    expect(heldEntries(service)).toEqual({ [keyOf("other")]: "stays" })
    expect(writesOf(service)).toEqual([deleteOf(KEY)])
  })

  test("is told at the next step on a run in flight", async () => {
    const { service, ctx } = liveRun()
    holdEntries(service, { [KEY]: "x" })
    expect(await removeEntryOf(KEY, ctx)).toMatchObject({ removed: true, when: "next_step" })
  })

  test("removes an entry of the package whose name is longer than a caller may give", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { "opencode-tools.same": "x" })
    expect(await removeEntryOf("opencode-tools.same", ctx)).toMatchObject({ removed: true })
  })
})

describe("a remove of a key that is not there", () => {
  test("removes nothing, sends no request that changes anything, and says so", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { "person.x": "theirs" })
    expect(await removeEntryOf(KEY, ctx)).toEqual({ service_started: false, session: RUN, key: KEY, removed: false })
    expect(writesOf(service)).toEqual([])
    expect(heldEntries(service)).toEqual({ "person.x": "theirs" })
  })

  test("never touches the operating note, which is refused before any request", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { [NOTE_KEY]: "note" })
    const error = await failure(removeEntryOf(NOTE_KEY, ctx))
    expect([error.code, error.details]).toEqual(["forbidden", { reason: "reserved" }])
    expect(service.requests).toEqual([])
    expect(heldEntries(service)).toEqual({ [NOTE_KEY]: "note" })
  })

  test("by a service without the entry routes is upstream_error", async () => {
    const { ctx } = idleRun({ state: { entriesRefused: true } })
    expect((await failure(removeEntryOf(KEY, ctx))).code).toBe("upstream_error")
  })
})

describe("describe", () => {
  test("shows the key, with the value it removes as its text, and no text for a key that is not there", async () => {
    const { service, ctx } = idleRun()
    const call = { session: RUN, key: KEY }
    expect(await wholeCallDescription(tool, call, ctx)).toEqual({ facts: [{ label: "Key", value: KEY }] })
    holdEntries(service, { [KEY]: "Use\nthe other module." })
    expect(await wholeCallDescription(tool, call, ctx)).toEqual({
      facts: [{ label: "Key", value: KEY }],
      text: { label: "Value removed", body: "Use\nthe other module." },
    })
    holdEntries(service, { [KEY]: { n: 1 } })
    expect((await wholeCallDescription(tool, call, ctx))?.text).toEqual({ label: "Value removed", body: '{"n":1}' })
    expect(writesOf(service)).toEqual([])
  })
})
