import { realpath, stat } from "node:fs/promises"
import type { Deadline } from "../deadline"
import { ToolError } from "../errors"
import { isWithin } from "../paths"
import { MAX_SHOWN_DIRECTORY } from "../service/directory"
import { shown } from "../text"
import type { ToolContext } from "../tool"
import { runGit } from "./git"

/** A run's worktree as git reads it. */
export type Worktree = {
  /** The real path of the worktree's top level. */
  directory: string
  /** The real path of the common directory a checkout and its linked worktrees share. */
  repository: string
  /** The branch checked out; null on a detached HEAD. */
  branch: string | null
}

type GitContext = Pick<ToolContext, "signal" | "runtime">

const NOT_A_REPOSITORY = /not a git repository|must be run in a work tree/i
/** The exit code of `git symbolic-ref --quiet` on a HEAD that is not a branch. */
const DETACHED_EXIT_CODE = 1

async function checkDirectory(directory: string, named: string): Promise<void> {
  const info = await stat(directory).catch(() => undefined)
  if (info === undefined) throw new ToolError("not_found", `${named} does not exist.`)
  if (!info.isDirectory()) throw new ToolError("not_found", `${named} is not a directory.`)
}

/** Reads the worktree a directory is the top level of, with git; anything else is refused. */
export async function readWorktree(directory: string, ctx: GitContext, deadline: Deadline): Promise<Worktree> {
  const named = shown(directory, MAX_SHOWN_DIRECTORY)
  const unreadable = () => new ToolError("upstream_error", `git could not read ${named}.`)
  await checkDirectory(directory, named)

  const paths = await runGit(
    ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"],
    directory,
    ctx,
    deadline,
  )
  if (paths.code !== 0) {
    throw NOT_A_REPOSITORY.test(paths.stderr)
      ? new ToolError("invalid_argument", `${named} is not in a Git worktree.`)
      : unreadable()
  }
  const [top, common] = paths.stdout.split("\n")
  if (!top || !common) throw unreadable()

  const [realDirectory, realTop, repository] = await Promise.all([realpath(directory), realpath(top), realpath(common)])
  if (realDirectory !== realTop) {
    throw new ToolError(
      "invalid_argument",
      `${named} is not the top level of its worktree; the top level is ${shown(realTop, MAX_SHOWN_DIRECTORY)}.`,
    )
  }

  const head = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], directory, ctx, deadline)
  if (head.code === DETACHED_EXIT_CODE) return { directory: realTop, repository, branch: null }
  if (head.code !== 0) throw unreadable()
  return { directory: realTop, repository, branch: head.stdout.trim() }
}

/** Refuses a write run in a directory under one of `protectedDirs`. Async, since `isWithin` compares real paths. */
export async function refuseProtected(worktree: Worktree, protectedDirs: readonly string[]): Promise<void> {
  for (const protectedDir of protectedDirs) {
    if (await isWithin(worktree.directory, protectedDir)) {
      throw new ToolError(
        "forbidden",
        `${shown(worktree.directory, MAX_SHOWN_DIRECTORY)} is under a protected directory; no write run starts there.`,
      )
    }
  }
}
