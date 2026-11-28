import { describe, expect, test } from "bun:test"
import { isToolError } from "./errors"
import { methodArguments } from "./methods"

type Input = { method: "list" | "view" | "count"; id?: string; page?: number; filter?: string }

const rules = methodArguments<Input>({
  names: ["method", "id", "page", "filter"],
  shared: ["method", "filter"],
  methods: { list: ["page"], view: ["id"], count: [] },
})

function refusal(run: () => unknown): { code: string; message: string } {
  try {
    run()
  } catch (error) {
    if (isToolError(error)) return { code: error.code, message: error.message }
    throw error
  }
  throw new Error("expected the call to be refused")
}

describe("refuseForeignArguments", () => {
  test("lets a method take the shared arguments and its own", () => {
    expect(() => rules.refuseForeignArguments({ method: "list", page: 2, filter: "x" })).not.toThrow()
    expect(() => rules.refuseForeignArguments({ method: "view", id: "a", filter: "x" })).not.toThrow()
    expect(() => rules.refuseForeignArguments({ method: "count" })).not.toThrow()
  })

  test("refuses an argument of another method, naming it and not its value", () => {
    expect(refusal(() => rules.refuseForeignArguments({ method: "list", id: "secret-value" }))).toEqual({
      code: "invalid_argument",
      message: "id is not an argument of list.",
    })
    expect(refusal(() => rules.refuseForeignArguments({ method: "count", page: 1 })).message).toBe(
      "page is not an argument of count.",
    )
  })

  test("names the first foreign argument in the order of `names`", () => {
    expect(
      refusal(() => rules.refuseForeignArguments({ method: "count", filter: "x", page: 1, id: "a" })).message,
    ).toBe("id is not an argument of count.")
  })

  test("an argument that is left out, or undefined, is not carried", () => {
    expect(() => rules.refuseForeignArguments({ method: "count", id: undefined })).not.toThrow()
  })
})

describe("requireArgument", () => {
  test("gives the value", () => {
    expect(rules.requireArgument({ method: "view", id: "a" }, "id")).toBe("a")
    expect(rules.requireArgument({ method: "list", page: 0 }, "page")).toBe(0)
  })

  test("refuses a missing one, naming it and its method", () => {
    expect(refusal(() => rules.requireArgument({ method: "view" }, "id"))).toEqual({
      code: "invalid_argument",
      message: "id is required by view.",
    })
  })
})
