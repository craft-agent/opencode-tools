/** Fixtures for the tests that run real git in temporary directories. */
import { execFileSync } from "node:child_process"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startDeadline } from "../deadline"
import { defaultRuntime, type ToolRuntime } from "../runtime"

/** An environment that ignores the developer's own git configuration. */
const ISOLATED_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
}

/** Runs git in `cwd`, as a person with no configuration would. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
    cwd,
    env: ISOLATED_ENV,
    encoding: "utf8",
    stdio: "pipe",
  })
}

const created: string[] = []

/** A temporary directory, real-pathed; it is removed by `cleanup`. */
export async function tempDir(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "run-git-")))
  created.push(directory)
  return directory
}

/** Removes every directory `tempDir` made. */
export async function cleanup(): Promise<void> {
  await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
}

/** A checkout on `main` with one commit. */
export async function checkout(): Promise<string> {
  const directory = await tempDir()
  git(directory, "init", "-b", "main")
  await writeFile(join(directory, "file.txt"), "x")
  git(directory, "add", ".")
  git(directory, "commit", "-m", "first")
  return directory
}

/** A runtime with the real environment, or `env` instead of it. */
export function runtimeWith(env?: Record<string, string>): ToolRuntime {
  return { ...defaultRuntime(), ...(env && { env }) }
}

/** The context and the deadline of a git call. */
export function callOf(runtime: ToolRuntime = runtimeWith()) {
  return { ctx: { runtime }, deadline: startDeadline({ runtime }) }
}
