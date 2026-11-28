import { afterEach, describe, expect, test } from "bun:test"
import { symlink } from "node:fs/promises"
import { join } from "node:path"
import { MAX_TEXT_LENGTH, callDescription, omittedBy, wholeCallDescription } from "../describe"
import { failure } from "../service/read.testing"
import { opencodeServiceRead } from "../service/read"
import { ANY_TARGET, writeTargets } from "../targets"
import { annotations, defineTool, selectTools, type ToolSpec } from "../tool"
import { cleanup, tempDir } from "./git.testing"
import { MAX_BRIEF } from "./start.schemas"
import { opencodeRunStart, opencodeRunStartWrite } from "./start.tool"
import { expectedBinding, seedRun, startSetup } from "./start.testing"
import { withBinding } from "./binding"

afterEach(cleanup)

const BRIEF = "Review the diff."
const TOOLSETS = { names: ["service", "run"], defaults: ["service", "run"] }

describe("the two start tools", () => {
  test("differ in their id, their write class and the policy they take", () => {
    expect([opencodeRunStart.id, opencodeRunStart.class]).toEqual(["opencode_run_start", "add"])
    expect([opencodeRunStartWrite.id, opencodeRunStartWrite.class]).toEqual(["opencode_run_start_write", "overwrite"])
    expect(annotations(opencodeRunStart)).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    expect(annotations(opencodeRunStartWrite)).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  })

  test("are in the run toolset, and read_only leaves neither", () => {
    expect(opencodeRunStart.toolset).toBe("run")
    expect(opencodeRunStartWrite.toolset).toBe("run")
    const all: ToolSpec[] = [opencodeServiceRead, opencodeRunStart, opencodeRunStartWrite]
    expect(selectTools(all, {}, TOOLSETS)).toEqual(all)
    expect(selectTools(all, { read_only: true }, TOOLSETS)).toEqual([opencodeServiceRead])
  })

  test("declare a bound on the role by exact name and one on the brief's length", () => {
    for (const spec of [opencodeRunStart, opencodeRunStartWrite]) {
      expect(spec.bounds).toEqual({
        role: { kind: "prefix", separator: "/", description: expect.any(String) },
        brief_length: { kind: "max", description: expect.any(String) },
      })
      expect(() => defineTool(spec)).not.toThrow()
    }
  })

  test("say what the call does and does not wait for", () => {
    for (const spec of [opencodeRunStart, opencodeRunStartWrite]) {
      for (const text of [
        "opencode_service_read",
        "`status`",
        "opencode_run_read",
        "does not wait for the turn",
        "is running is refused",
        "read back before any brief is sent",
        "`unknown`",
        "send nothing again",
      ]) {
        expect(spec.description).toContain(text)
      }
    }
    expect(opencodeRunStartWrite.description).toContain("edit files inside its worktree")
    expect(opencodeRunStart.description).not.toContain("edit files inside")
    expect(opencodeRunStart.description).toContain("opencode_run_start_write")
  })
})

describe("measure", () => {
  test("gives the role's name and the brief's length in characters", async () => {
    const { ctx } = await startSetup()
    const measure = opencodeRunStart.measure!
    expect(await measure({ role: "plan", brief: "😀ab" }, ctx)).toEqual({ role: "plan", brief_length: 3 })
    expect(await measure({ role: "plan", brief: "x".repeat(MAX_BRIEF) }, ctx)).toEqual({
      role: "plan",
      brief_length: MAX_BRIEF,
    })
  })
})

describe("targets", () => {
  test("of a new session is the real path of its directory", async () => {
    const { ctx, directory } = await startSetup()
    const link = join(await tempDir(), "link")
    await symlink(directory, link)
    expect(await writeTargets(opencodeRunStart, { role: "plan", brief: BRIEF, directory: link }, ctx)).toEqual([
      directory,
    ])
    expect(await writeTargets(opencodeRunStartWrite, { role: "build", brief: BRIEF }, ctx)).toEqual([directory])
  })

  test("of a new session in a directory that cannot be resolved is the directory", async () => {
    const { ctx, directory } = await startSetup()
    const missing = join(directory, "missing")
    expect(await opencodeRunStart.targets!({ role: "plan", brief: BRIEF, directory: missing }, ctx)).toEqual([missing])
  })

  test("of a continued session is the session's own directory", async () => {
    const setup = await startSetup()
    await seedRun(setup, "ses_mine")
    const targets = await writeTargets(opencodeRunStart, { role: "plan", brief: BRIEF, session: "ses_mine" }, setup.ctx)
    expect(targets).toEqual([setup.directory])
  })

  test("of a session that is another caller's or does not exist cannot be told, as one target", async () => {
    const setup = await startSetup()
    await seedRun(setup, "ses_theirs", "plan", {
      metadata: withBinding(undefined, expectedBinding(setup, "plan", { caller: "someone-else" })),
    })
    for (const session of ["ses_theirs", "ses_none"]) {
      const args = { role: "plan", brief: BRIEF, session }
      const error = await failure(opencodeRunStart.targets!(args, setup.ctx) as Promise<unknown>)
      expect(error.code).toBe("not_found")
      expect(await writeTargets(opencodeRunStart, args, setup.ctx)).toEqual([ANY_TARGET])
    }
  })
})

describe("describe", () => {
  test("shows the role, the agent, the policy, the model and that the session is new, then the brief", async () => {
    const { ctx, service, runtime } = await startSetup({ runtime: { running: false } })
    const description = await wholeCallDescription(opencodeRunStart, { role: "plan", brief: BRIEF }, ctx)
    expect(description).toEqual({
      facts: [
        { label: "Role", value: "plan" },
        { label: "Agent", value: "plan" },
        { label: "Policy", value: "read-only" },
        { label: "Model", value: "the agent's, else the service's default" },
        { label: "Session", value: "new" },
      ],
      text: { label: "Brief", body: BRIEF },
    })
    expect(service.requests).toEqual([])
    expect(runtime.started).toEqual([])
  })

  test("shows the role's model as written and the session to continue", async () => {
    const roles = { deep: { agent: "plan", policy: "read-only", model: "acme/model-2#high" } }
    const { ctx } = await startSetup({ options: { roles } })
    const description = await wholeCallDescription(
      opencodeRunStart,
      { role: "deep", brief: BRIEF, session: "ses_mine" },
      ctx,
    )
    expect(description?.facts).toContainEqual({ label: "Model", value: "acme/model-2#high" })
    expect(description?.facts).toContainEqual({ label: "Session", value: "ses_mine" })
  })

  test("says that a continued session keeps its model when the role names none", async () => {
    const { ctx } = await startSetup()
    const args = { role: "plan", brief: BRIEF, session: "ses_mine" }
    expect((await wholeCallDescription(opencodeRunStart, args, ctx))?.facts).toContainEqual({
      label: "Model",
      value: "the session's own",
    })
  })

  test("gives no description for a role that is not configured", async () => {
    const { ctx } = await startSetup()
    expect(await wholeCallDescription(opencodeRunStart, { role: "ghost", brief: BRIEF }, ctx)).toBeUndefined()
  })

  test("is the same for the same arguments", async () => {
    const { ctx } = await startSetup()
    const args = { role: "build", brief: BRIEF }
    expect(await opencodeRunStartWrite.describe!(args, ctx)).toEqual(await opencodeRunStartWrite.describe!(args, ctx))
  })

  test("keeps the whole of a long brief, which the prompt cuts and counts", async () => {
    const { ctx } = await startSetup()
    const brief = "x".repeat(MAX_TEXT_LENGTH + 500)
    const args = { role: "plan", brief }
    expect((await wholeCallDescription(opencodeRunStart, args, ctx))?.text?.body).toBe(brief)
    const shown = (await callDescription(opencodeRunStart, args, ctx))?.text?.body
    expect(shown).toHaveLength(MAX_TEXT_LENGTH)
    expect(shown).toEndWith("…")
    expect(omittedBy(brief, MAX_TEXT_LENGTH)).toBe(501)
  })
})
