import type { Deadline } from "../deadline"
import { ToolError, isToolError } from "../errors"
import type { Policy } from "../role"
import type { ServiceConnection } from "../service/connect"
import { MAX_SHOWN_DIRECTORY, directoryOf } from "../service/directory"
import { cleaned } from "../service/errors"
import type { SessionEntry } from "../service/reply"
import { shown } from "../text"
import type { ToolContext } from "../tool"
import type { Binding } from "./binding"
import { protectedDirsOf } from "./options"
import { ownedSession } from "./owned"
import type { StartInput } from "./start.schemas"
import { readWorktree, refuseProtected, type Worktree } from "./worktree"

/** Where a start works: the worktree, the directory the service knows the session by and, for a continued or forked session, the session that is continued or copied. */
export type StartTarget = { worktree: Worktree; directory: string; session?: SessionEntry }

const LEFT_THE_WORKTREE = "its directory is no longer the top level of a worktree"

/** What a branch is called in a message; no branch is a detached HEAD. */
function written(branch: string | null): string {
  return branch === null ? "none" : shown(branch)
}

/** Why a session's worktree is not the one it was bound to; undefined when it is. */
function leftBecause(binding: Binding, worktree: Worktree): string | undefined {
  if (worktree.repository !== binding.repository) {
    return `repository was ${shown(binding.repository, MAX_SHOWN_DIRECTORY)}, is ${shown(worktree.repository, MAX_SHOWN_DIRECTORY)}`
  }
  if (worktree.branch !== binding.branch) {
    return `branch was ${written(binding.branch)}, is ${written(worktree.branch)}`
  }
  return undefined
}

/** The worktree of a new run: the top level of a Git worktree, and for a write run not a protected one. Asks no service. */
export async function newTarget(
  args: StartInput,
  ctx: ToolContext,
  policy: Policy,
  deadline: Deadline,
): Promise<StartTarget> {
  const worktree = await readWorktree(await directoryOf(args, ctx), ctx, deadline)
  if (policy === "write") await refuseProtected(worktree, protectedDirsOf(ctx.options))
  return { worktree, directory: worktree.directory }
}

/** The target of a run's own session: the session and its binding, and the worktree it is still bound to. */
export type BoundTarget = Required<StartTarget> & { binding: Binding }

/**
 * The worktree of a run's own session. The session is read again and its
 * directory with git, since an agent can move its session: one that has left
 * the worktree, repository or branch it was bound to is `stale`. No policy is
 * checked.
 */
export async function boundTarget(
  service: ServiceConnection,
  sessionID: string,
  ctx: ToolContext,
): Promise<BoundTarget> {
  const { session, binding } = await ownedSession(service, sessionID, ctx.caller)
  const stale = (what: string) =>
    new ToolError(
      "stale",
      `Session ${cleaned(session.id)} has left the worktree it was bound to (${what}); start a new session.`,
    )
  let worktree: Worktree
  try {
    worktree = await readWorktree(session.directory, ctx, service.deadline)
  } catch (error) {
    if (isToolError(error) && (error.code === "invalid_argument" || error.code === "not_found")) {
      throw stale(LEFT_THE_WORKTREE)
    }
    throw error
  }
  const left = leftBecause(binding, worktree)
  if (left !== undefined) throw stale(left)
  return { worktree, directory: session.directory, session, binding }
}

/** The worktree of a run that is continued: that of its session, and for a write run not a protected one. */
export async function continuedTarget(
  service: ServiceConnection,
  sessionID: string,
  ctx: ToolContext,
  policy: Policy,
): Promise<StartTarget> {
  const { worktree, directory, session } = await boundTarget(service, sessionID, ctx)
  if (policy === "write") await refuseProtected(worktree, protectedDirsOf(ctx.options))
  return { worktree, directory, session }
}
