import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { defineTool, type ToolSpec } from "../core"
import { EXIT_OK, EXIT_USAGE } from "./cli"
import { cli, json } from "./testing"

const CALLER_ID = "demo_thing_whose"

/** An add tool that answers with the caller of its call, and shows it as a fact of its description. */
const callerSpec: ToolSpec = defineTool({
  id: CALLER_ID,
  title: CALLER_ID,
  description: CALLER_ID,
  toolset: "alpha",
  class: "add",
  targets: () => ["north"],
  describe: (_args, ctx) => ({ facts: [{ label: "Caller", value: ctx.caller }] }),
  input: z.object({}),
  output: z.object({ caller: z.string() }),
  async execute(_args, ctx) {
    return { caller: ctx.caller }
  },
})

const run = (args: string[], env: Record<string, string | undefined> = {}) =>
  cli(args, "", { specs: [callerSpec], env })

describe("the command line's caller", () => {
  test("run gives the tool the caller of --caller", async () => {
    const result = await run(["run", CALLER_ID, "--cwd", "/work", "--caller", "x"])
    expect(result.code).toBe(EXIT_OK)
    expect(json(result)).toEqual({ result: { caller: "x" } })
    expect(json(await run(["run", CALLER_ID, "--cwd", "/work", "--caller=y"]))).toEqual({ result: { caller: "y" } })
  })

  test("run takes a caller that starts with -- when joined with =", async () => {
    expect(json(await run(["run", CALLER_ID, "--cwd", "/work", "--caller=--x=y"]))).toEqual({
      result: { caller: "--x=y" },
    })
  })

  test("run without one gets cli", async () => {
    expect(json(await run(["run", CALLER_ID, "--cwd", "/work"]))).toEqual({ result: { caller: "cli" } })
  })

  test("run reads the variable, and the flag wins over it", async () => {
    const env = { DEMO_CALLER: "from env" }
    expect(json(await run(["run", CALLER_ID, "--cwd", "/work"], env))).toEqual({ result: { caller: "from env" } })
    expect(json(await run(["run", CALLER_ID, "--cwd", "/work", "--caller", "x"], env))).toEqual({
      result: { caller: "x" },
    })
  })

  test("target accepts --caller and resolves the description with it", async () => {
    const result = await run(["target", CALLER_ID, "--cwd", "/work", "--caller", "x"])
    expect(result.code).toBe(EXIT_OK)
    expect(json(result).description.facts).toContainEqual({ label: "Caller", value: "x" })
    const fallback = await run(["target", CALLER_ID, "--cwd", "/work"])
    expect(json(fallback).description.facts).toContainEqual({ label: "Caller", value: "cli" })
  })

  test("list accepts --caller", async () => {
    expect((await run(["list", "--caller", "x"])).code).toBe(EXIT_OK)
  })

  test("a caller over 200 characters is a usage error", async () => {
    const result = await run(["run", CALLER_ID, "--cwd", "/work", "--caller", "c".repeat(201)])
    expect(result.code).toBe(EXIT_USAGE)
    expect(result.stderr).toContain("--caller must be at most 200 characters.")
  })
})
