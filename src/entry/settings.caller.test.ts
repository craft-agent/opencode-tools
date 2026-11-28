import { describe, expect, test } from "bun:test"
import {
  MAX_CALLER_LENGTH,
  callerText,
  parseSettings,
  parseTargetSettings,
  parseToolSettings,
  settingVariables,
} from "./settings"
import { failure, profile } from "./settings.testing"

type Env = Record<string, string | undefined>

const parse = (argv: string[], env: Env = {}) => parseSettings(argv, env, profile)
const LONGEST = "c".repeat(MAX_CALLER_LENGTH)
const TOO_LONG = `${LONGEST}c`

describe("the caller setting", () => {
  test("is unset by default, its key absent", () => {
    expect("caller" in parse([])).toBe(false)
  })

  test("reads the flag, with a space or an equals sign, and the variable", () => {
    expect(parse(["--caller", "x"]).caller).toBe("x")
    expect(parse(["--caller=x"]).caller).toBe("x")
    expect(parse([], { DEMO_CALLER: "from env" }).caller).toBe("from env")
  })

  test("is won by the flag over the variable", () => {
    expect(parse(["--caller", "flag"], { DEMO_CALLER: "env" }).caller).toBe("flag")
  })

  test("is trimmed", () => {
    expect(parse(["--caller", "  x  "]).caller).toBe("x")
    expect(parse([], { DEMO_CALLER: "  y\n" }).caller).toBe("y")
  })

  test("counts a blank value as unset", () => {
    expect("caller" in parse(["--caller", "  "])).toBe(false)
    expect("caller" in parse(["--caller="])).toBe(false)
    expect("caller" in parse([], { DEMO_CALLER: "   " })).toBe(false)
  })

  test("takes 200 characters and refuses 201, naming its source", () => {
    expect(parse(["--caller", LONGEST]).caller).toBe(LONGEST)
    expect(parse([], { DEMO_CALLER: LONGEST }).caller).toBe(LONGEST)
    expect(failure(() => parse(["--caller", TOO_LONG])).message).toBe("--caller must be at most 200 characters.")
    expect(failure(() => parse([], { DEMO_CALLER: TOO_LONG })).message).toBe(
      "DEMO_CALLER must be at most 200 characters.",
    )
  })

  test("counts astral characters as one each", () => {
    const emoji = "😀".repeat(MAX_CALLER_LENGTH)
    expect(parse(["--caller", emoji]).caller).toBe(emoji)
    expect(failure(() => parse(["--caller", `${emoji}😀`])).message).toBe("--caller must be at most 200 characters.")
  })

  test("takes a value that starts with -- when joined with =", () => {
    expect(parse(["--caller=--x=y"]).caller).toBe("--x=y")
  })

  test("is passed through by parseToolSettings", () => {
    expect(parseToolSettings(["--caller", "x"], {}, profile).caller).toBe("x")
  })

  test("is the last variable of the package's settings, before its own", () => {
    expect(settingVariables({ ...profile, options: {} }).at(-1)).toBe("DEMO_CALLER")
  })
})

describe("callerText", () => {
  test("trims and cuts to the longest caller", () => {
    expect(callerText("  client  ")).toBe("client")
    expect(callerText(TOO_LONG)).toBe(LONGEST)
  })

  test("is undefined for blank text and for what is not text", () => {
    for (const given of ["", "   ", undefined, null, 7, {}]) expect(callerText(given)).toBeUndefined()
  })
})

describe("parseTargetSettings and the caller", () => {
  test("accept --caller and return it", () => {
    expect(parseTargetSettings(["--caller", "x"], {}, profile).caller).toBe("x")
    expect(parseTargetSettings([], { DEMO_CALLER: "env" }, profile).caller).toBe("env")
    expect("caller" in parseTargetSettings([], {}, profile)).toBe(false)
  })

  test("still refuse the settings that are not theirs", () => {
    expect(failure(() => parseTargetSettings(["--toolsets", "alpha"], {}, profile)).message).toBe(
      'Unknown option "--toolsets".',
    )
    expect(failure(() => parseTargetSettings(["--read-only"], {}, profile)).message).toBe(
      'Unknown option "--read-only".',
    )
  })
})
