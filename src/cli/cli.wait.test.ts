import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { defineTool, type ToolSpec } from "../core"
import { PROJECT_PROFILE } from "../entry/profile"
import { EXIT_OK, EXIT_USAGE } from "./cli"
import { cli, json } from "./testing"

const WAIT_ID = "demo_thing_read"

/** A read tool that answers with the wait its call got. */
const waitSpec: ToolSpec = defineTool({
  id: WAIT_ID,
  title: WAIT_ID,
  description: WAIT_ID,
  toolset: "alpha",
  class: "read",
  input: z.object({}),
  output: z.object({ wait: z.unknown() }),
  async execute(_args, ctx) {
    return { wait: ctx.options?.wait_seconds }
  },
})

const profile = {
  ...PROJECT_PROFILE,
  name: "demo-tools",
  envPrefix: "DEMO",
  toolsets: { names: ["alpha"], defaults: ["alpha"] },
}
const run = (args: string[], env: Record<string, string> = {}) =>
  cli(["run", WAIT_ID, "--cwd", "/work", ...args], "", { specs: [waitSpec], profile, env })

describe("the command line's wait_seconds", () => {
  test("a flag and a variable each reach the tool as a number", async () => {
    for (const result of [await run(["--wait-seconds", "120"]), await run([], { DEMO_WAIT_SECONDS: "120" })]) {
      expect(result.code).toBe(EXIT_OK)
      expect(json(result)).toEqual({ result: { wait: 120 } })
    }
  })

  test("unset, the option is absent", async () => {
    const result = await run([])
    expect(result.code).toBe(EXIT_OK)
    expect(json(result)).toEqual({ result: {} })
  })

  test.each(["0", "3301", "1.5", "abc"])("refuses %s, naming the flag or the variable", async (value) => {
    const byFlag = await run([`--wait-seconds=${value}`])
    expect(byFlag.code).toBe(EXIT_USAGE)
    expect(byFlag.stderr).toContain("--wait-seconds")
    const byVariable = await run([], { DEMO_WAIT_SECONDS: value })
    expect(byVariable.code).toBe(EXIT_USAGE)
    expect(byVariable.stderr).toContain("DEMO_WAIT_SECONDS")
  })
})
