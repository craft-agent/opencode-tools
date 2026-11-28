import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { serviceError } from "./errors"

const REFUSED = "The OpenCode service refused the request"
const SECRET = "s3cretpw"

function mapped(error: unknown, redact: string[] = []): ToolError {
  const result = serviceError(error, { redact })
  expect(result).toBeInstanceOf(ToolError)
  return result as ToolError
}

describe("serviceError: an error the client built from a malformed body", () => {
  test.each([
    ["a number", 5],
    ["an object", { deep: "name" }],
    ["null", null],
    ["a list", ["Error"]],
  ])("whose own name is %s is the service's refusal, not a throw", (_name, name) => {
    const error = mapped(Object.assign(new Error("no such route"), { name }))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`${REFUSED}: no such route`)
  })

  test("with a name that is not text and no message is the bare refusal", () => {
    expect(mapped(Object.assign(new Error(""), { name: 5 })).message).toBe(`${REFUSED}.`)
  })

  test("with a name that is not text and a _tag the body made up is not taken for a declared error", () => {
    const error = mapped(Object.assign(new Error("odd"), { name: 7, _tag: "ConflictError" }))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`${REFUSED}: odd`)
  })

  test("with a message that is not text either is the bare refusal", () => {
    const error = mapped(Object.assign(new Error(), { name: {}, message: 5 }))
    expect(error.message).toBe(`${REFUSED}.`)
  })

  test("with a name that is not text, a declared tag and no message still maps by its tag", () => {
    const error = mapped(Object.assign(new Error(""), { name: 7, _tag: "InvalidRequestError" }))
    expect(error.code).toBe("invalid_argument")
  })

  test("whose constructor the body set to null is still a plain Error, and its text is redacted", () => {
    const error = mapped(Object.assign(new Error(`bad ${SECRET} here`), { constructor: null }), [SECRET])
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`${REFUSED}: bad [redacted] here`)
    expect(error.message).not.toContain(SECRET)
  })

  test("whose constructor the body set to Error is not made a plain Error if it is a subclass", () => {
    const bug = Object.assign(new TypeError("bug"), { constructor: Error })
    expect(serviceError(bug)).toBe(bug)
  })

  test("a name that is not text never reaches a message", () => {
    const error = mapped(Object.assign(new Error(`${SECRET}`), { name: { toString: () => SECRET } }), [SECRET])
    expect(error.message).not.toContain(SECRET)
  })
})
