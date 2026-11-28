import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { defineTool, type ToolSpec } from "../core"
import { PROJECT_PROFILE } from "../entry/profile"
import { EXIT_OK, EXIT_USAGE } from "./cli"
import { cli, json } from "./testing"

const ROLES_ID = "demo_thing_read"

/** A read tool that answers with the roles its call got. */
const rolesSpec: ToolSpec = defineTool({
  id: ROLES_ID,
  title: ROLES_ID,
  description: ROLES_ID,
  toolset: "alpha",
  class: "read",
  input: z.object({}),
  output: z.object({ roles: z.unknown() }),
  async execute(_args, ctx) {
    return { roles: ctx.options?.roles }
  },
})

const profile = {
  ...PROJECT_PROFILE,
  name: "demo-tools",
  envPrefix: "DEMO",
  toolsets: { names: ["alpha"], defaults: ["alpha"] },
}
const run = (args: string[]) => cli(args, "", { specs: [rolesSpec], profile })

describe("the command line's roles", () => {
  test("a role that breaks the shape is a usage error carrying the message", async () => {
    const result = await run(["list", "--roles", '{"x":{"agent":"a"}}'])
    expect(result.code).toBe(EXIT_USAGE)
    expect(result.stderr).toContain('Role "x" needs a policy of "read-only" or "write".')
  })

  test("run hands the tool the roles as an object", async () => {
    const roles = { x: { agent: "a", policy: "write", model: "p/m#v" } }
    const result = await run(["run", ROLES_ID, "--cwd", "/work", "--roles", JSON.stringify(roles)])
    expect(result.code).toBe(EXIT_OK)
    expect(json(result)).toEqual({ result: { roles } })
  })
})
