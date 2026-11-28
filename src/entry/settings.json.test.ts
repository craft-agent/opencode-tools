import { describe, expect, test } from "bun:test"
import type { EntryProfile } from "./profile"
import { parseSettings, parseTargetSettings } from "./settings"
import { failure, profile } from "./settings.testing"

const jsonProfile: EntryProfile = {
  ...profile,
  options: { rules_map: "json", labels: { type: "list", max: 2 } },
}
const parse = (argv: string[], variables: Record<string, string | undefined> = {}) =>
  parseSettings(argv, variables, jsonProfile)

const nested = { a: 1, b: { c: [true, null, "x", { d: 2.5 }] }, e: "" }
const message = (source: string) => `${source} must be a JSON object.`

describe("json settings", () => {
  test("reads an object from a flag, in both forms, and from the variable", () => {
    expect(parse(["--rules-map", '{"a":1}']).options).toEqual({ rules_map: { a: 1 } })
    expect(parse(['--rules-map={"a":1}']).options).toEqual({ rules_map: { a: 1 } })
    expect(parse([], { DEMO_RULES_MAP: '{"a":1}' }).options).toEqual({ rules_map: { a: 1 } })
  })

  test("a flag wins over the variable, even when the variable is invalid", () => {
    expect(parse(['--rules-map={"a":1}'], { DEMO_RULES_MAP: "oops" }).options).toEqual({ rules_map: { a: 1 } })
  })

  test("nested values survive unchanged", () => {
    expect(parse(["--rules-map", JSON.stringify(nested)]).options.rules_map).toEqual(nested)
  })

  test.each(["{}", " { } ", ""])("%j is unset and the key is absent", (text) => {
    expect("rules_map" in parse([`--rules-map=${text}`]).options).toBe(false)
    expect("rules_map" in parse([], { DEMO_RULES_MAP: text }).options).toBe(false)
  })

  test("a flag of {} suppresses the variable", () => {
    expect("rules_map" in parse(["--rules-map={}"], { DEMO_RULES_MAP: '{"a":1}' }).options).toBe(false)
  })

  test.each(["{oops", "null", "[]", "1", '"s"', "true"])("refuses %s, naming the flag or the variable", (text) => {
    expect(failure(() => parse([`--rules-map=${text}`])).message).toBe(message("--rules-map"))
    expect(failure(() => parse([], { DEMO_RULES_MAP: text })).message).toBe(message("DEMO_RULES_MAP"))
  })

  test("a refusal never contains the given text", () => {
    const secret = "s3cr3t-value"
    for (const text of [`{${secret}`, `"${secret}"`, `[${secret.length}]`]) {
      expect(failure(() => parse([`--rules-map=${text}`])).message).not.toContain(secret)
    }
  })

  test("a json option does not disturb a list's bounds", () => {
    const options = parse(['--rules-map={"a":1}', "--labels=x,y"]).options
    expect(options).toEqual({ rules_map: { a: 1 }, labels: ["x", "y"] })
    expect(failure(() => parse(['--rules-map={"a":1}', "--labels=x,y,z"])).message).toBe(
      "--labels must list at most 2 items.",
    )
  })

  test("parseTargetSettings reads a json option too", () => {
    expect(parseTargetSettings(['--rules-map={"a":1}'], {}, jsonProfile).options).toEqual({ rules_map: { a: 1 } })
    expect(parseTargetSettings([], { DEMO_RULES_MAP: '{"a":1}' }, jsonProfile).options).toEqual({
      rules_map: { a: 1 },
    })
  })
})
