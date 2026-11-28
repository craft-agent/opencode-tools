import { ToolError } from "../errors"
import type { ServiceConnection } from "../service/connect"
import { sessionOf, type SessionEntry } from "../service/reply"
import type { ToolContext } from "../tool"
import { bindingOf, sameBinding, unmarked, withBinding, type Binding } from "./binding"
import type { ForkInput, ForkOutput } from "./fork.schemas"
import { MAX_RUN_NAME } from "./read.schemas"
import { lineOf } from "./read.text"
import { refuseRunning } from "./start.busy"
import { forkSession, removeSession } from "./start.setup"
import { boundTarget, type BoundTarget } from "./start.target"

/** Who needs the run idle, as the refusal of a running one says it. */
const FORKING = "a fork"

/** The parts of a copy a fork compares, in the order a failure names them. */
const PARTS = ["binding", "directory", "parent"] as const

type Part = (typeof PARTS)[number]

/** The parts of `copy` that differ from what a fork bound it to, in `PARTS` order. */
function differencesOf(copy: SessionEntry, source: SessionEntry, binding: Binding): Part[] {
  const same: Record<Part, boolean> = {
    binding: sameBinding(bindingOf(copy.metadata), binding),
    directory: copy.directory === source.directory,
    parent: copy.parentID === undefined,
  }
  return PARTS.filter((part) => !same[part])
}

/** A session's title as a read gives it: one line, cut to `MAX_RUN_NAME`; empty when the session has none. */
export function titleLine(title: string | undefined): string {
  return title === undefined ? "" : lineOf(title, MAX_RUN_NAME)
}

/**
 * The run's own session and binding and its worktree, for a run with nothing
 * active (its own session or a subagent's): a run that is running is refused
 * as `running`.
 */
export async function requireIdle(
  service: ServiceConnection,
  sessionID: string,
  ctx: ToolContext,
): Promise<BoundTarget> {
  const target = await boundTarget(service, sessionID, ctx)
  await refuseRunning(service, target.session, FORKING)
  return target
}

/**
 * Writes the binding of a copy again without the start's mark, which the
 * service copied with the rest of the metadata, and reads the copy back: it
 * must hold that binding, its source's directory and no parent. Every other key
 * of its metadata is written back as it was read. A difference is
 * `upstream_error` naming the parts.
 */
async function bindFork(
  service: ServiceConnection,
  copy: SessionEntry,
  source: SessionEntry,
  binding: Binding,
): Promise<SessionEntry> {
  const bound = unmarked(binding)
  await service.client.session.update({ sessionID: copy.id, metadata: withBinding(copy.metadata, bound) })
  const held = sessionOf(await service.client.session.get({ sessionID: copy.id }))
  const differences = differencesOf(held, source, bound)
  if (differences.length > 0) {
    throw new ToolError(
      "upstream_error",
      `The OpenCode service did not report back the fork as it was bound (${differences.join(", ")}); the copy was removed.`,
    )
  }
  return held
}

/**
 * Copies the run's own session, which must be idle and in the worktree it was
 * bound to, into a new session bound as the source is, without its mark. The
 * source is only read. A copy that cannot be bound is removed, and the call
 * fails.
 */
export async function forkRun(service: ServiceConnection, args: ForkInput, ctx: ToolContext): Promise<ForkOutput> {
  const { session: source, binding } = await requireIdle(service, args.session, ctx)
  const copy = await forkSession(service, source.id)
  let bound: SessionEntry
  try {
    bound = await bindFork(service, copy, source, binding)
  } catch (error) {
    await removeSession(service, copy.id)
    throw error
  }
  const title = titleLine(bound.title)
  return {
    service_started: service.started,
    session: bound.id,
    forked_from: source.id,
    role: binding.role,
    ...(title !== "" && { title }),
    directory: bound.directory,
    branch: binding.branch,
  }
}
