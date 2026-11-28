import type { Deadline } from "../deadline"
import { ToolError } from "../errors"
import { exec, type ExecResult } from "../exec"
import { runtimeOf } from "../runtime"
import type { ToolContext } from "../tool"

/** How long one git command may take. */
export const GIT_TIMEOUT_MS = 10_000

const MS_PER_SECOND = 1000

/** The variables of the call's environment git is given, beside its own switches. */
const PASSED_VARIABLES = ["PATH", "HOME"] as const

/** Switches that keep git from waiting on a person, from taking locks a person's own git needs, and from answering in another language. */
const GIT_SWITCHES: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  LC_ALL: "C",
}

function gitEnvironment(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const name of PASSED_VARIABLES) {
    const value = env[name]
    if (value !== undefined) environment[name] = value
  }
  return { ...environment, ...GIT_SWITCHES }
}

/** Runs git with `args` in `cwd`, with prompts off, and returns what `exec` returns. */
export async function runGit(
  args: readonly string[],
  cwd: string,
  ctx: Pick<ToolContext, "signal" | "runtime">,
  deadline: Deadline,
): Promise<ExecResult> {
  const limitMs = deadline.within(GIT_TIMEOUT_MS)
  let result: ExecResult
  try {
    result = await exec(["git", ...args], {
      cwd,
      env: gitEnvironment(runtimeOf(ctx).env),
      signal: ctx.signal,
      timeoutMs: limitMs,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new ToolError("upstream_error", 'git is not installed, or "git" is not on PATH.')
    }
    throw error
  }
  if (result.timedOut) {
    throw limitMs < GIT_TIMEOUT_MS
      ? deadline.ended("git to answer")
      : new ToolError("upstream_error", `git did not answer within ${GIT_TIMEOUT_MS / MS_PER_SECOND} seconds.`)
  }
  return result
}
