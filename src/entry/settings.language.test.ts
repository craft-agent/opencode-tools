import { describe, expect, test } from "bun:test"
import { languageVariable, parseSettings, parseToolSettings, promptLanguage, settingVariables } from "./settings"
import { DEFAULT_GRANTS, failure, profile } from "./settings.testing"

describe("languageVariable", () => {
  test("is the profile's prefix and LANGUAGE, and no setting variable", () => {
    expect(languageVariable(profile)).toBe("DEMO_LANGUAGE")
    expect(settingVariables(profile)).not.toContain("DEMO_LANGUAGE")
  })
})

describe("the command-line parsers", () => {
  test("reject --language as an unknown option", () => {
    expect(failure(() => parseSettings(["--language", "ja"], {}, profile)).message).toContain("--language")
    expect(failure(() => parseToolSettings(["--language=ja"], {}, profile)).message).toContain("--language")
  })

  test("ignore the language variable", () => {
    const env = { DEMO_LANGUAGE: "ja" }
    expect(parseSettings([], env, profile)).toEqual({ confirm: "harness", options: {}, grants: DEFAULT_GRANTS })
    expect(parseToolSettings([], env, profile)).toEqual({ options: {}, grants: DEFAULT_GRANTS })
  })
})

describe("promptLanguage", () => {
  const env = { DEMO_LANGUAGE: "fr" }

  test("prefers the flag, then the environment, then the harness", () => {
    expect(promptLanguage("ja", env, "de", profile)).toBe("ja")
    expect(promptLanguage(undefined, env, "de", profile)).toBe("fr")
    expect(promptLanguage(undefined, {}, "de", profile)).toBe("de")
  })

  test("skips blank values and trims", () => {
    expect(promptLanguage(" ", env, "de", profile)).toBe("fr")
    expect(promptLanguage(undefined, { DEMO_LANGUAGE: "" }, " de ", profile)).toBe("de")
    expect(promptLanguage(" ja ", {}, undefined, profile)).toBe("ja")
  })

  test("is undefined when nothing is set", () => {
    expect(promptLanguage(undefined, {}, undefined, profile)).toBeUndefined()
    expect(promptLanguage(" ", { DEMO_LANGUAGE: " " }, "", profile)).toBeUndefined()
  })
})
