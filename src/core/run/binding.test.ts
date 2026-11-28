import { describe, expect, test } from "bun:test"
import {
  BINDING_KEY,
  STARTING_MS,
  bindingOf,
  isStarting,
  sameBinding,
  unmarked,
  withBinding,
  type Binding,
} from "./binding"

const binding: Binding = { v: 1, caller: "c1", role: "plan", repository: "/repo/.git", branch: "main" }
const marked: Binding = { ...binding, starting: { at: 1000, token: "t1" } }

describe("withBinding and bindingOf", () => {
  test("round trip, with and without a mark and on a detached HEAD", () => {
    for (const each of [binding, marked, { ...binding, branch: null }, { ...marked, branch: null }]) {
      expect(bindingOf(withBinding(undefined, each))).toEqual(each)
    }
  })

  test("writes `starting` only when there is one, and a detached branch as null", () => {
    expect(withBinding(undefined, binding)[BINDING_KEY]).toEqual(binding)
    expect(Object.keys(withBinding(undefined, binding)[BINDING_KEY] as object)).not.toContain("starting")
    expect((withBinding(undefined, { ...binding, branch: null })[BINDING_KEY] as { branch: unknown }).branch).toBeNull()
  })

  test("keeps the other keys and replaces an earlier binding", () => {
    const other = { theme: { dark: true }, list: [1, "a"] }
    const written = withBinding({ ...other, [BINDING_KEY]: { old: true } }, binding)
    expect(written).toEqual({ ...other, [BINDING_KEY]: binding })
    expect(withBinding(other, marked)).toMatchObject(other)
  })

  test("does not change the metadata it is given", () => {
    const metadata = { a: 1 }
    withBinding(metadata, binding)
    expect(metadata).toEqual({ a: 1 })
  })
})

describe("bindingOf", () => {
  const stored = (value: unknown) => ({ [BINDING_KEY]: value })

  test("is undefined without metadata or without the key", () => {
    for (const metadata of [undefined, null, "x", 5, [], {}, { other: binding }]) {
      expect(bindingOf(metadata)).toBeUndefined()
    }
  })

  test("is undefined for another version or shape", () => {
    const bad: unknown[] = [
      null,
      "x",
      [],
      { ...binding, v: 2 },
      { ...binding, v: undefined },
      { ...binding, caller: "" },
      { ...binding, role: 5 },
      { ...binding, repository: "" },
      { ...binding, branch: undefined },
      { ...binding, branch: 5 },
      { ...binding, starting: { at: 1 } },
      { ...binding, starting: { at: "1", token: "t" } },
      { ...binding, starting: { at: Infinity, token: "t" } },
      { ...binding, starting: { at: 1, token: "" } },
      { ...binding, starting: "now" },
    ]
    for (const value of bad) expect(bindingOf(stored(value))).toBeUndefined()
  })

  test("drops keys it does not know", () => {
    expect(bindingOf(stored({ ...marked, extra: 1 }))).toEqual(marked)
  })
})

describe("sameBinding", () => {
  test("is true for equal bindings, the mark included", () => {
    expect(sameBinding(binding, { ...binding })).toBe(true)
    expect(sameBinding(marked, { ...marked, starting: { ...marked.starting! } })).toBe(true)
    expect(sameBinding(undefined, undefined)).toBe(true)
  })

  test("is false when any field or the mark differs", () => {
    for (const other of [
      { ...binding, caller: "c2" },
      { ...binding, role: "build" },
      { ...binding, repository: "/other" },
      { ...binding, branch: null },
      marked,
      { ...marked, starting: { at: 1001, token: "t1" } },
      { ...marked, starting: { at: 1000, token: "t2" } },
    ]) {
      expect(sameBinding(binding, other)).toBe(false)
    }
    expect(sameBinding(binding, undefined)).toBe(false)
    expect(sameBinding(undefined, binding)).toBe(false)
  })
})

describe("unmarked", () => {
  test("takes the mark off and leaves the rest", () => {
    expect(unmarked(marked)).toEqual(binding)
    expect(Object.keys(unmarked(marked))).not.toContain("starting")
    expect(unmarked(binding)).toEqual(binding)
  })
})

describe("isStarting", () => {
  const at = marked.starting!.at

  test("is false without a binding or a mark", () => {
    expect(isStarting(undefined, {}, at)).toBe(false)
    expect(isStarting(binding, {}, at)).toBe(false)
  })

  test("is true for less than STARTING_MS after the mark, and false from then on", () => {
    expect(isStarting(marked, {}, at)).toBe(true)
    expect(isStarting(marked, {}, at + STARTING_MS - 1)).toBe(true)
    expect(isStarting(marked, {}, at + STARTING_MS)).toBe(false)
  })

  test("is false for a mark further in the future than STARTING_MS", () => {
    expect(isStarting(marked, {}, at - STARTING_MS + 1)).toBe(true)
    expect(isStarting(marked, {}, at - STARTING_MS)).toBe(false)
  })

  test("is false once the session has been busy since the mark", () => {
    expect(isStarting(marked, { busy: at - 1 }, at + 1)).toBe(true)
    expect(isStarting(marked, { busy: at }, at + 1)).toBe(false)
    expect(isStarting(marked, { busy: at + 5 }, at + 10)).toBe(false)
  })
})
