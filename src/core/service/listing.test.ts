import { describe, expect, test } from "bun:test"
import { idFits, listed } from "./listing"
import { MAX_ID, MAX_LISTED, MAX_LIST_CHARS } from "./schemas"

describe("listed", () => {
  test("keeps every entry of a short list", () => {
    expect(listed([1, 2, 3])).toEqual({ kept: [1, 2, 3], truncated: false })
    expect(listed([])).toEqual({ kept: [], truncated: false })
  })

  test("keeps at most MAX_LISTED entries", () => {
    const entries = Array.from({ length: MAX_LISTED + 1 }, (_, index) => index)
    const { kept, truncated } = listed(entries)
    expect(kept).toEqual(entries.slice(0, MAX_LISTED))
    expect(truncated).toBe(true)
    expect(listed(entries.slice(0, MAX_LISTED)).truncated).toBe(false)
  })

  test("keeps entries while their JSON stays within the budget, in order, and stops at the first that does not fit", () => {
    const entry = (length: number) => "x".repeat(length - 2)
    const fits = [entry(MAX_LIST_CHARS / 2), entry(MAX_LIST_CHARS / 2)]
    expect(listed(fits)).toEqual({ kept: fits, truncated: false })
    const { kept, truncated } = listed([...fits, "a", entry(10), "b"])
    expect(kept).toEqual(fits)
    expect(truncated).toBe(true)
    const stops = listed([entry(MAX_LIST_CHARS - 10), entry(20), "small"])
    expect(stops.kept).toHaveLength(1)
    expect(stops.truncated).toBe(true)
  })

  test("keeps nothing of a list whose first entry is over the budget, and says so", () => {
    expect(listed(["x".repeat(MAX_LIST_CHARS)])).toEqual({ kept: [], truncated: true })
  })
})

describe("idFits", () => {
  test("counts code points", () => {
    expect(idFits("a".repeat(MAX_ID))).toBe(true)
    expect(idFits("a".repeat(MAX_ID + 1))).toBe(false)
    expect(idFits("😀".repeat(MAX_ID))).toBe(true)
    expect(idFits("😀".repeat(MAX_ID + 1))).toBe(false)
    expect(idFits("")).toBe(true)
  })
})
