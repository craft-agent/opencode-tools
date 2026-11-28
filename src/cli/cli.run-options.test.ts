import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { MAX_RUN_NOTE_LENGTH, defineTool, type ToolSpec } from "../core"
import { PROJECT_PROFILE } from "../entry/profile"
import { EXIT_OK, EXIT_USAGE } from "./cli"
import { READ_ID, cli, json } from "./testing"

/** A read tool that answers with the run settings its call got. */
const optionsSpec: ToolSpec = defineTool({
  id: READ_ID,
  title: READ_ID,
  description: READ_ID,
  toolset: "alpha",
  class: "read",
  input: z.object({}),
  output: z.object({ rules: z.unknown(), note: z.unknown(), read_roots: z.unknown(), protected_dirs: z.unknown() }),
  async execute(_args, ctx) {
    const { rules, note, read_roots, protected_dirs } = ctx.options ?? {}
    return { rules, note, read_roots, protected_dirs }
  },
})

const profile = {
  ...PROJECT_PROFILE,
  name: "demo-tools",
  envPrefix: "DEMO",
  toolsets: { names: ["alpha"], defaults: ["alpha"] },
}
const run = (args: string[], env: Record<string, string> = {}) =>
  cli(["run", READ_ID, "--cwd", "/work", ...args], "", { specs: [optionsSpec], profile, env })

const RULES = { "read-only": [{ action: "bash", resource: "git log *", effect: "allow" }] }

describe("the command line's run settings", () => {
  test("a flag and a variable each reach the tool", async () => {
    const byFlag = await run([
      "--rules",
      JSON.stringify(RULES),
      "--note",
      " Be brief. ",
      "--read-roots",
      "/srv/a,/srv/b",
      "--protected-dirs",
      "/srv/main",
    ])
    expect(byFlag.code).toBe(EXIT_OK)
    expect(json(byFlag)).toEqual({
      result: { rules: RULES, note: "Be brief.", read_roots: ["/srv/a", "/srv/b"], protected_dirs: ["/srv/main"] },
    })
    const byVariable = await run([], { DEMO_RULES: JSON.stringify(RULES), DEMO_READ_ROOTS: "/srv/a" })
    expect(json(byVariable)).toEqual({ result: { rules: RULES, read_roots: ["/srv/a"] } })
  })

  test("unset, the settings are absent", async () => {
    expect(json(await run([]))).toEqual({ result: {} })
  })

  test("refuses rules of an unknown policy, naming the setting", async () => {
    const result = await run(["--rules", '{"other":[]}'])
    expect(result.code).toBe(EXIT_USAGE)
    expect(result.stderr).toContain("rules")
    expect(result.stderr).toContain("other")
  })

  test("refuses a rule with a bad effect, naming the setting", async () => {
    const result = await run(["--rules", '{"write":[{"action":"bash","resource":"x","effect":"maybe"}]}'])
    expect(result.code).toBe(EXIT_USAGE)
    expect(result.stderr).toContain("rules")
    expect(result.stderr).toContain("effect")
  })

  test("refuses a read root that holds the home directory", async () => {
    const result = await run(["--read-roots", "/"])
    expect(result.code).toBe(EXIT_USAGE)
    expect(result.stderr).toContain("read_roots")
    expect(result.stderr).toContain("home directory")
  })

  test("refuses a note over the limit", async () => {
    const result = await run(["--note", "a".repeat(MAX_RUN_NOTE_LENGTH + 1)])
    expect(result.code).toBe(EXIT_USAGE)
    expect(result.stderr).toContain("note")
  })
})
