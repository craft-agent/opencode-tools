import { describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { measureOf } from "../grant/match"
import { PROJECT } from "../../project"
import { ALL_TOOLS } from "../../tools"
import { liveRun, unownedSessions, writesOf } from "../run/control.testing"
import { NOTE_KEY } from "../run/note"
import { DIRECTORY } from "../run/read.testing"
import { SESSION_NOT_FOUND } from "../service/errors"
import { failure } from "../service/read.testing"
import { ANY_TARGET, writeTargets } from "../targets"
import { annotations, defineTool } from "../tool"
import { heldEntries, holdEntries, idleRun, keyOf, manyEntries, RUN, setEntryOf } from "./instruction.testing"
import { MAX_ENTRIES, MAX_ENTRY_VALUE } from "./limits"
import { opencodeInstructionSet } from "./set.tool"

const tool = opencodeInstructionSet
const args = (key = keyOf("a"), value = "x") => ({ session: RUN, key, value })

describe("the spec", () => {
  test("is opencode_instruction_set, an overwrite tool of the instruction toolset, registered with the others", () => {
    expect(tool.id).toBe("opencode_instruction_set")
    expect(tool.toolset).toBe("instruction")
    expect(tool.class).toBe("overwrite")
    expect(tool.intent).toBe("About to set an instruction entry")
    expect(annotations(tool)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    })
    expect(() => defineTool(tool)).not.toThrow()
    expect(ALL_TOOLS).toContain(tool)
    expect(PROJECT.toolsets).toContain(tool.toolset)
  })

  test("takes the run's session, a key and a value of 1 to the limit", () => {
    expect(Object.keys(tool.input.shape).sort()).toEqual(["key", "session", "value"])
    expect(tool.input.safeParse(args(keyOf("a"), "x".repeat(MAX_ENTRY_VALUE))).success).toBe(true)
    expect(tool.input.safeParse(args(keyOf("a"), "")).success).toBe(false)
    expect(tool.input.safeParse(args(keyOf("a"), "x".repeat(MAX_ENTRY_VALUE + 1))).success).toBe(false)
  })

  test("describes what an entry is, when it is told, the key's form, each refusal, the limits and the results", () => {
    const { description } = tool
    for (const text of [
      "a text its agent is told",
      "`opencode-tools.<name>`",
      `1 to ${MAX_ENTRY_VALUE} characters, not blank`,
      "reads the key beside the value",
      "told to the run once",
      "kept for every later turn and for a fork",
      "a subagent is not told",
      "is replaced",
      "the agent is told nothing",
      `at most ${MAX_ENTRIES} entries`,
      "the operating note counted",
      "the reason `too_many`",
      "the reason `key`",
      `\`${NOTE_KEY}\` is the operating note`,
      "`forbidden` with the reason `reserved`",
      "are not found",
      "`upstream_error`",
      "`changed`",
      "`replaced`",
      "`when`",
      "`next_step` or `next_turn`",
      "`service_started`",
      "`wait_seconds`",
    ]) {
      expect(description).toContain(text)
    }
  })
})

describe("targets", () => {
  test("is the run's directory, and cannot be told for a session that is not the caller's", async () => {
    const { service, ctx } = idleRun()
    expect(await writeTargets(tool, args(), ctx)).toEqual([DIRECTORY])
    expect(await writeTargets(tool, { ...args(), session: "ses_none" }, ctx)).toEqual([ANY_TARGET])
    expect(writesOf(service)).toEqual([])
  })
})

describe("gate", () => {
  test("lets a call through that sets a new key, and one that replaces a key of a full session, sending nothing", async () => {
    const { service, ctx } = idleRun()
    await tool.gate!(args(), ctx)
    holdEntries(service, manyEntries(MAX_ENTRIES))
    await tool.gate!(args(keyOf("a0")), ctx)
    expect(writesOf(service)).toEqual([])
  })

  test("refuses a new key of a session that holds the most entries, the note counted, before anyone is asked", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { ...manyEntries(MAX_ENTRIES - 1), [NOTE_KEY]: "note" })
    await tool.gate!(args(keyOf("a0")), ctx)
    const error = await failure(Promise.resolve(tool.gate!(args(keyOf("new")), ctx)))
    expect([error.code, error.details]).toEqual(["invalid_argument", { reason: "too_many" }])
    expect(writesOf(service)).toEqual([])
  })

  test("does not count entries under other keys", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { ...manyEntries(MAX_ENTRIES - 1), "person.x": "1", "plugin.y": "2" })
    await tool.gate!(args(keyOf("new")), ctx)
  })

  test("refuses a key of another form, the operating note and a blank value before the service is asked", async () => {
    const { service, ctx } = idleRun()
    const key = await failure(Promise.resolve(tool.gate!(args("note"), ctx)))
    expect([key.code, key.details]).toEqual(["invalid_argument", { reason: "key" }])
    const reserved = await failure(Promise.resolve(tool.gate!(args(NOTE_KEY), ctx)))
    expect([reserved.code, reserved.details]).toEqual(["forbidden", { reason: "reserved" }])
    const blank = await failure(Promise.resolve(tool.gate!(args(keyOf("a"), " \n\t"), ctx)))
    expect([blank.code, blank.message]).toEqual(["invalid_argument", "value must not be blank."])
    expect(service.requests).toEqual([])
  })

  test("refuses a session of another caller, a person's own, a subagent's and a missing one as not found", async () => {
    const { service, ctx } = liveRun()
    for (const session of unownedSessions(service)) {
      const error = await failure(Promise.resolve(tool.gate!({ ...args(), session }, ctx)))
      expect([error.code, error.message]).toEqual(["not_found", SESSION_NOT_FOUND])
    }
  })
})

describe("describe", () => {
  test("shows whether the call replaces and the key, with the value as its text", async () => {
    const { service, ctx } = idleRun()
    const call = args(keyOf("a"), "Use\nthe other module.")
    expect(await wholeCallDescription(tool, call, ctx)).toEqual({
      facts: [
        { label: "Replaces", value: "no" },
        { label: "Key", value: keyOf("a") },
      ],
      text: { label: "Value", body: "Use\nthe other module." },
    })
    holdEntries(service, { [keyOf("a")]: "old" })
    expect((await wholeCallDescription(tool, call, ctx))?.facts[0]).toEqual({ label: "Replaces", value: "yes" })
    expect(writesOf(service)).toEqual([])
    expect(heldEntries(service)).toEqual({ [keyOf("a")]: "old" })
  })

  test("is the same for the same state", async () => {
    const { ctx } = idleRun()
    expect(await tool.describe!(args(), ctx)).toEqual(await tool.describe!(args(), ctx))
  })
})

describe("the bounds of a grant", () => {
  test("are the length of the value in characters", async () => {
    const { ctx } = idleRun()
    expect(tool.bounds).toEqual({
      value_length: { kind: "max", description: "The most characters of the value." },
    })
    const measure = await tool.measure!(args(keyOf("a"), "héllo😀"), ctx)
    expect(measure).toEqual({ value_length: 6 })
    expect(measureOf(tool.bounds!, measure)).toEqual(measure)
  })
})

describe("a service without the entry routes", () => {
  test("fails the gate and the call as upstream_error, never as a missing session", async () => {
    const { ctx } = idleRun({ state: { entriesRefused: true } })
    expect((await failure(Promise.resolve(tool.gate!(args(), ctx)))).code).toBe("upstream_error")
    expect((await failure(setEntryOf(keyOf("a"), "x", ctx))).code).toBe("upstream_error")
  })
})
