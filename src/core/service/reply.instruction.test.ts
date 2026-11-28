import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { UNREADABLE_REPLY } from "./errors"
import { entriesOf } from "./reply.instruction"

function unreadable(reply: unknown): void {
  const error = (() => {
    try {
      entriesOf(reply)
    } catch (thrown) {
      return thrown
    }
  })()
  expect(error).toBeInstanceOf(ToolError)
  expect(error).toMatchObject({ code: "upstream_error", message: UNREADABLE_REPLY })
}

describe("entriesOf", () => {
  test("reads the key and the value of each entry, in the order given, whatever JSON the value is", () => {
    const rows = [
      { key: "a.text", value: "one" },
      { key: "b.object", value: { n: 1, list: [true, null] } },
      { key: "c.null", value: null },
      { key: "d.number", value: 3 },
    ]
    expect(entriesOf(rows)).toEqual(rows)
    expect(entriesOf([])).toEqual([])
  })

  test("refuses an entry without a key or a value, a key that is empty, and a reply that is not a list", () => {
    for (const reply of [
      [{ value: "one" }],
      [{ key: "", value: "one" }],
      [{ key: 1, value: "one" }],
      [{ key: "a" }],
      { data: [] },
      null,
    ]) {
      unreadable(reply)
    }
  })
})
