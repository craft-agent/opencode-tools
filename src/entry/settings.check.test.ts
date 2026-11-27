import { describe, expect, test } from "bun:test"
import { ToolError, type ToolOptions } from "../core"
import { PROJECT_PROFILE, type EntryProfile } from "./profile"
import { parseSettings, parseTargetSettings, parseToolSettings } from "./settings"
import { failure, profile } from "./settings.testing"

const REFUSAL = "the options are refused"
const seen: ToolOptions[] = []
const checkedProfile: EntryProfile = {
  ...profile,
  options: { stamp: "text" },
  check(options) {
    seen.push(options)
    if (options.stamp === "bad") throw new ToolError("invalid_argument", REFUSAL)
  },
}
const parsers = {
  parseSettings,
  parseToolSettings,
  parseTargetSettings,
}

describe("a profile's check", () => {
  test.each(Object.entries(parsers))("%s hands it the parsed options", (_name, parse) => {
    seen.length = 0
    parse(["--stamp", "ok"], {}, checkedProfile)
    expect(seen).toEqual([{ stamp: "ok" }])
  })

  test.each(Object.entries(parsers))("%s lets its ToolError propagate", (_name, parse) => {
    expect(failure(() => parse(["--stamp", "bad"], {}, checkedProfile)).message).toBe(REFUSAL)
    expect(failure(() => parse([], { DEMO_STAMP: "bad" }, checkedProfile)).message).toBe(REFUSAL)
  })
})

describe("the package's own check", () => {
  test("refuses a role that breaks its shape", () => {
    expect(failure(() => parseSettings([], { OPENCODE_TOOLS_ROLES: '{"Bad":{}}' }, PROJECT_PROFILE)).message).toBe(
      'Role name "Bad" must be a lowercase letter followed by at most 23 lowercase letters, digits or underscores.',
    )
  })

  test("keeps valid roles in the options", () => {
    const roles = { x: { agent: "a", policy: "read-only" } }
    const settings = parseSettings([], { OPENCODE_TOOLS_ROLES: JSON.stringify(roles) }, PROJECT_PROFILE)
    expect(settings.options.roles).toEqual(roles)
  })

  test("stores no roles when none are set", () => {
    expect("roles" in parseSettings([], {}, PROJECT_PROFILE).options).toBe(false)
  })
})
