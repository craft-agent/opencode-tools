import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { MIN_SERVICE_VERSION, checkServiceVersion } from "./version"

function refusal(version: string): ToolError {
  try {
    checkServiceVersion(version)
  } catch (error) {
    return error as ToolError
  }
  throw new Error(`${version} was not refused`)
}

describe("checkServiceVersion", () => {
  test.each(["2.4.2", "2.4.3", "2.5.0", "2.10.0", "3.0.0", "10.0.0", "2.4.2-beta.1", "2.4.2+build.7"])(
    "accepts %s",
    (version) => {
      expect(() => checkServiceVersion(version)).not.toThrow()
    },
  )

  test.each(["0.0.0-dev-202611", "dev", "", "2.4", "v2.4.1", "latest-build"])(
    "does not refuse %p, a development build's version",
    (version) => {
      expect(() => checkServiceVersion(version)).not.toThrow()
    },
  )

  test.each(["2.4.1", "2.3.99", "1.99.99", "0.0.0", "0.0.1-dev", "2.4.1-beta.1", "1.10.0"])(
    "refuses %s as upstream_error",
    (version) => {
      const error = refusal(version)
      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe(`OpenCode ${version} is running; these tools need ${MIN_SERVICE_VERSION} or later.`)
    },
  )

  test("compares numbers, not text", () => {
    expect(() => checkServiceVersion("2.10.0")).not.toThrow()
    expect(() => checkServiceVersion("2.4.10")).not.toThrow()
    expect(refusal("2.3.10").code).toBe("upstream_error")
  })

  test("cuts the shown version to 40 characters and drops what is not printable", () => {
    const error = refusal(`1.0.0-\u001b[31m${"x".repeat(100)}`)
    expect(error.message).toBe(`OpenCode 1.0.0-[31m${"x".repeat(30)} is running; these tools need 2.4.2 or later.`)
  })
})
