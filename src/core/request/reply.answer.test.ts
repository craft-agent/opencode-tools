import { describe, expect, test } from "bun:test"
import type { FieldEntry } from "../service/reply.request"
import { answerProblem } from "./reply.answer"

const FIELDS: FieldEntry[] = [
  { key: "name", type: "string", required: true },
  { key: "pick", type: "string", options: [{ value: "a" }, { value: "b" }] },
  { key: "free", type: "string", options: [{ value: "a" }], custom: true },
  { key: "many", type: "multiselect", options: [{ value: "a" }, { value: "b" }] },
  { key: "anything", type: "multiselect", options: [{ value: "a" }], custom: true },
  { key: "size", type: "number" },
  { key: "count", type: "integer" },
  { key: "flag", type: "boolean" },
]

describe("answerProblem", () => {
  test("is none for an answer that fits, a field without options taking any text", () => {
    expect(answerProblem(FIELDS, { name: "any text at all" })).toBeUndefined()
    expect(
      answerProblem(FIELDS, {
        name: "n",
        pick: "b",
        free: "my own",
        many: ["a", "b"],
        anything: ["mine"],
        size: 1.5,
        count: -2,
        flag: false,
      }),
    ).toBeUndefined()
    expect(answerProblem(FIELDS, { name: "n", many: [] })).toBeUndefined()
  })

  test("is a key no field has, and that comes before every other problem", () => {
    expect(answerProblem(FIELDS, { other: "x" })).toBe('it has no field "other"')
    expect(answerProblem(FIELDS, { name: 1, pick: "z", ghost: "x", also: "y" })).toBe('it has no field "ghost"')
  })

  test("is a value of another kind, worded by the field's type", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ name: 1 }, 'field "name" takes a text'],
      [{ name: "n", size: "big" }, 'field "size" takes a number'],
      [{ name: "n", count: "2" }, 'field "count" takes a whole number'],
      [{ name: "n", flag: "yes" }, 'field "flag" takes true or false'],
      [{ name: "n", many: "a" }, 'field "many" takes a list of texts'],
      [{ name: "n", many: [1] }, 'field "many" takes a list of texts'],
    ]
    for (const [answer, problem] of cases) expect(answerProblem(FIELDS, answer as never)).toBe(problem)
  })

  test("takes a number only when it is finite, and an integer only when it is whole", () => {
    for (const value of [Infinity, -Infinity, NaN]) {
      expect(answerProblem(FIELDS, { name: "n", size: value })).toBe('field "size" takes a number')
      expect(answerProblem(FIELDS, { name: "n", count: value })).toBe('field "count" takes a whole number')
    }
    expect(answerProblem(FIELDS, { name: "n", count: 1.5 })).toBe('field "count" takes a whole number')
    expect(answerProblem(FIELDS, { name: "n", count: 3 })).toBeUndefined()
  })

  test("is a value outside the options of a field that takes only its options", () => {
    expect(answerProblem(FIELDS, { name: "n", pick: "c" })).toBe('field "pick" takes one of its options')
    expect(answerProblem(FIELDS, { name: "n", many: ["a", "c"] })).toBe('field "many" takes one of its options')
  })

  test("takes a multiselect with no options of its own only as an empty list", () => {
    const fields: FieldEntry[] = [{ key: "m", type: "multiselect" }]
    expect(answerProblem(fields, { m: ["x"] })).toBe('field "m" takes one of its options')
    expect(answerProblem(fields, { m: [] })).toBeUndefined()
  })

  test("is a required field the answer lacks, after the fields before it, in the question's order", () => {
    const fields: FieldEntry[] = [
      { key: "first", type: "string", required: true },
      { key: "second", type: "integer" },
      { key: "third", type: "string", required: true },
    ]
    expect(answerProblem(fields, { second: 1 })).toBe('field "first" is required')
    expect(answerProblem(fields, { first: "a", second: 1 })).toBe('field "third" is required')
    expect(answerProblem(fields, { second: 1.5, first: "a" })).toBe('field "second" takes a whole number')
    expect(answerProblem(fields, { third: 1, second: 1 })).toBe('field "first" is required')
  })

  test("checks a field's kind before its options, and an earlier field before a later one", () => {
    expect(answerProblem(FIELDS, { name: "n", pick: 7 })).toBe('field "pick" takes a text')
    expect(answerProblem(FIELDS, { name: "n", many: ["c"], pick: "c" })).toBe('field "pick" takes one of its options')
  })

  test("leaves lengths, ranges, patterns and formats to the service", () => {
    const fields: FieldEntry[] = [
      { key: "t", type: "string", minLength: 5, maxLength: 6, pattern: "^x+$", format: "email" },
      { key: "n", type: "number", minimum: 10, maximum: 20 },
    ]
    expect(answerProblem(fields, { t: "a", n: 1000 })).toBeUndefined()
  })

  test("quotes a key it names, so that nothing in it moves a message", () => {
    expect(answerProblem(FIELDS, { "a\nb": "x" })).toBe('it has no field "a\\nb"')
  })
})
