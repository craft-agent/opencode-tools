import { afterEach, describe, expect, test } from "bun:test"
import { chmod, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startDeadline } from "../deadline"
import { isAbortError } from "../errors"
import { GIT_TIMEOUT_MS, runGit } from "./git"
import { callOf, cleanup, runtimeWith, tempDir } from "./git.testing"

afterEach(cleanup)

/** Puts a fake `git` with `body` in a new directory and returns the directory. */
async function fakeGit(body: string): Promise<string> {
  const directory = await tempDir()
  const path = join(directory, "git")
  await writeFile(path, `#!/bin/sh\n${body}\n`)
  await chmod(path, 0o755)
  return directory
}

describe("runGit", () => {
  test("gives git the path, the home and its switches, and nothing else", async () => {
    const bin = await fakeGit("/usr/bin/env")
    const cwd = await tempDir()
    const runtime = runtimeWith({ PATH: bin, HOME: "/home/someone", OPENCODE_TOOLS_SECRET: "x", GIT_DIR: "/elsewhere" })
    const { ctx, deadline } = callOf(runtime)
    const result = await runGit(["status"], cwd, ctx, deadline)
    const names = result.stdout
      .split("\n")
      .map((line) => line.split("=")[0])
      .filter((name) => name && !["PWD", "SHLVL", "_", "OLDPWD"].includes(name))
      .sort()
    expect(names).toEqual(["GIT_OPTIONAL_LOCKS", "GIT_TERMINAL_PROMPT", "HOME", "LC_ALL", "PATH"])
    expect(result.stdout).toContain("GIT_TERMINAL_PROMPT=0")
    expect(result.stdout).toContain("GIT_OPTIONAL_LOCKS=0")
    expect(result.stdout).toContain("LC_ALL=C")
    expect(result.stdout).toContain("HOME=/home/someone")
  })

  test("a variable that is unset is not passed", async () => {
    const bin = await fakeGit("/usr/bin/env")
    const { ctx, deadline } = callOf(runtimeWith({ PATH: bin }))
    const result = await runGit([], await tempDir(), ctx, deadline)
    expect(result.stdout).not.toContain("HOME=")
  })

  test("returns the exit code and output of a git that fails", async () => {
    const bin = await fakeGit("echo out; echo err >&2; exit 3")
    const { ctx, deadline } = callOf(runtimeWith({ PATH: bin }))
    const result = await runGit([], await tempDir(), ctx, deadline)
    expect(result).toMatchObject({ code: 3, stdout: "out\n", stderr: "err\n" })
  })

  test("a PATH without git is upstream_error saying so", async () => {
    const empty = await tempDir()
    const { ctx, deadline } = callOf(runtimeWith({ PATH: empty }))
    await expect(runGit(["status"], empty, ctx, deadline)).rejects.toMatchObject({
      code: "upstream_error",
      message: 'git is not installed, or "git" is not on PATH.',
    })
  })

  test("a git that outlasts the call's time is the deadline's error", async () => {
    const bin = await fakeGit("exec /bin/sleep 5")
    const runtime = runtimeWith({ PATH: bin })
    const deadline = startDeadline({ runtime, options: { wait_seconds: 1 } })
    expect(deadline.within(GIT_TIMEOUT_MS)).toBeLessThan(GIT_TIMEOUT_MS)
    await expect(runGit([], await tempDir(), { runtime }, deadline)).rejects.toMatchObject({
      code: "upstream_error",
      message: expect.stringContaining("git to answer"),
    })
  })

  test("a cancelled call rethrows the abort", async () => {
    const bin = await fakeGit("exec /bin/sleep 5")
    const { ctx, deadline } = callOf(runtimeWith({ PATH: bin }))
    const controller = new AbortController()
    const call = runGit([], await tempDir(), { ...ctx, signal: controller.signal }, deadline)
    controller.abort()
    const error = await call.catch((caught: unknown) => caught)
    expect(isAbortError(error)).toBe(true)
  })
})
