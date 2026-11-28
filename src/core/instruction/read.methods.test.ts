import { describe, expect, test } from "bun:test"
import { NOTE_KEY } from "../run/note"
import { failure } from "../service/read.testing"
import { holdEntries, idleRun, keyOf, manyEntries, readEntries, RUN } from "./instruction.testing"
import { MAX_ENTRIES_LISTED, MAX_ENTRY_READ, MAX_LISTED_VALUE } from "./limits"

describe("list", () => {
  test("gives the package's entries in the service's order and counts the others without showing them", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, {
      [keyOf("alpha")]: "First.",
      "person.secret": "never shown",
      [keyOf("beta")]: "Second.\nLine two.",
      "plugin.x": { hidden: true },
    })
    const result = await readEntries({ method: "list" }, ctx)
    expect(result).toEqual({
      method: "list",
      service_started: false,
      session: RUN,
      entries: [
        { key: keyOf("alpha"), value: "First." },
        { key: keyOf("beta"), value: "Second.\nLine two." },
      ],
      others: 2,
    })
    expect(JSON.stringify(result)).not.toContain("secret")
  })

  test("is empty for a session with no entries", async () => {
    const { ctx } = idleRun()
    expect(await readEntries({ method: "list" }, ctx)).toMatchObject({ entries: [], others: 0 })
  })

  test("marks the operating note read_only", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { [NOTE_KEY]: "You are driven.", [keyOf("a")]: "x" })
    const { entries } = await readEntries({ method: "list" }, ctx)
    expect(entries).toEqual([
      { key: NOTE_KEY, value: "You are driven.", read_only: true },
      { key: keyOf("a"), value: "x" },
    ])
  })

  test("cuts a long value, line breaks kept, and says so", async () => {
    const { service, ctx } = idleRun()
    const long = `line one\n${"x".repeat(MAX_LISTED_VALUE)}`
    holdEntries(service, { [keyOf("long")]: long, [keyOf("exact")]: "y".repeat(MAX_LISTED_VALUE) })
    const { entries } = await readEntries({ method: "list" }, ctx)
    expect(entries![0]).toEqual({
      key: keyOf("long"),
      value: long.slice(0, MAX_LISTED_VALUE),
      value_truncated: true,
    })
    expect(entries![0]!.value).toStartWith("line one\n")
    expect(entries![1]).toEqual({ key: keyOf("exact"), value: "y".repeat(MAX_LISTED_VALUE) })
  })

  test("shows a value that is not a text as its JSON text, with json", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { [keyOf("data")]: { n: 1, list: ["a"] }, [keyOf("number")]: 3 })
    const { entries } = await readEntries({ method: "list" }, ctx)
    expect(entries).toEqual([
      { key: keyOf("data"), value: '{"n":1,"list":["a"]}', json: true },
      { key: keyOf("number"), value: "3", json: true },
    ])
  })

  test("lists an entry whose name is longer than a caller may give, since it starts with the prefix", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { [keyOf(`Long.${"x".repeat(60)}`)]: "put by someone else" })
    expect((await readEntries({ method: "list" }, ctx)).entries).toHaveLength(1)
  })

  test("lists at most MAX_ENTRIES_LISTED entries, with the total and truncated when there are more", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, manyEntries(MAX_ENTRIES_LISTED))
    const whole = await readEntries({ method: "list" }, ctx)
    expect(whole.entries).toHaveLength(MAX_ENTRIES_LISTED)
    expect(whole).not.toHaveProperty("total")
    expect(whole).not.toHaveProperty("truncated")

    holdEntries(service, { [keyOf("extra1")]: "x", [keyOf("extra2")]: "x" })
    const cut = await readEntries({ method: "list" }, ctx)
    expect(cut.entries).toHaveLength(MAX_ENTRIES_LISTED)
    expect(cut).toMatchObject({ total: MAX_ENTRIES_LISTED + 2, truncated: true })
  })
})

describe("get", () => {
  test("gives the one entry whole", async () => {
    const { service, ctx } = idleRun()
    const long = "z".repeat(MAX_LISTED_VALUE + 500)
    holdEntries(service, { [keyOf("a")]: long, [keyOf("b")]: "other" })
    expect(await readEntries({ method: "get", key: keyOf("a") }, ctx)).toEqual({
      method: "get",
      service_started: false,
      session: RUN,
      entry: { key: keyOf("a"), value: long },
    })
  })

  test("cuts a value only at MAX_ENTRY_READ", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { [keyOf("a")]: "z".repeat(MAX_ENTRY_READ + 1) })
    const { entry } = await readEntries({ method: "get", key: keyOf("a") }, ctx)
    expect(entry!.value).toHaveLength(MAX_ENTRY_READ)
    expect(entry!.value_truncated).toBe(true)
  })

  test("reads the operating note, marked read_only, and a value that is JSON", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { [NOTE_KEY]: "You are driven.", [keyOf("data")]: [1, 2] })
    expect((await readEntries({ method: "get", key: NOTE_KEY }, ctx)).entry).toEqual({
      key: NOTE_KEY,
      value: "You are driven.",
      read_only: true,
    })
    expect((await readEntries({ method: "get", key: keyOf("data") }, ctx)).entry).toEqual({
      key: keyOf("data"),
      value: "[1,2]",
      json: true,
    })
  })

  test("fails as not_found, naming the key, for a key that is not there", async () => {
    const { service, ctx } = idleRun()
    holdEntries(service, { "person.x": "hidden" })
    const error = await failure(readEntries({ method: "get", key: keyOf("gone") }, ctx))
    expect([error.code, error.message]).toEqual(["not_found", `The session holds no entry ${keyOf("gone")}.`])
  })
})
