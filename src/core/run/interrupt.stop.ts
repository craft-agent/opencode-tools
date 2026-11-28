import { isToolError } from "../errors"
import { runtimeOf } from "../runtime"
import type { ServiceConnection } from "../service/connect"
import type { SessionEntry } from "../service/reply"
import { inboxOf, interruptedOf, jobsOf, type JobEntry } from "../service/reply.control"
import type { ToolContext } from "../tool"
import { WAIT_RESERVE_MS } from "./read.wait"
import { rosterOf, type Roster } from "./roster"
import { MAX_DEPTH } from "./tree"

/** How long an interrupt looks for something of the run that is still active, on the runtime's clock. */
export const INTERRUPT_SETTLE_MS = 20_000
/** How long an interrupt leaves between two looks, on the runtime's clock. */
export const INTERRUPT_POLL_MS = 500
/** What a result says of what an interrupt leaves as it is. */
export const NOTHING_ROLLED_BACK =
  "Nothing was rolled back: files, commits and whatever left the machine stay as the run left them. Read the changes before continuing."

/** How many looks in a row that find nothing active end an interrupt that stopped something: a report can arrive after its session was stopped. */
const QUIET_LOOKS = 2
/** The kind of a job that is a subagent, which is stopped through its session. */
const SUBAGENT_KIND = "subagent"
/** The status of a job that is running. */
const JOB_RUNNING = "running"
/** The type of an inbox item a caller's message is. */
const USER_ITEM = "user"

/** What an interrupt did. */
export type StopReport = {
  /** The sessions whose interrupt the service answered as stopped, each once, in the order they were first stopped. */
  sessions: string[]
  /** How many distinct jobs were cancelled. */
  commands: number
  /** How many of the caller's unread messages were withdrawn. */
  withdrawn: number
  /** Whether something was still active at the last look, when the time ended. */
  timedOut: boolean
  /** Whether the job routes were refused, so that no job was looked for. */
  backgroundUnchecked: boolean
}

/** What an interrupt has done so far. */
type Stopped = { sessions: string[]; commands: Set<string>; backgroundUnchecked: boolean }

type StopCall = {
  service: ServiceConnection
  session: SessionEntry
  roster: Roster
  stopped: Stopped
}

/** Withdraws every message of the caller in the run's own session's inbox that the run has not read; what the service put there itself stays. Returns how many. */
async function withdrawUnread({ service, session }: Pick<StopCall, "service" | "session">): Promise<number> {
  const { client } = service
  const sessionID = session.id
  const unread = inboxOf(await client.session.inbox.list({ sessionID })).filter((item) => item.type === USER_ITEM)
  for (const item of unread) await client.session.inbox.cancel({ sessionID, inboxID: item.id })
  return unread.length
}

/**
 * The running jobs of the run and of the sessions below it that are not
 * subagents. Where the service refuses the route and the call still has time,
 * the background is left unchecked from then on and there are none.
 */
async function backgroundJobs({ service, session, stopped }: StopCall): Promise<JobEntry[]> {
  if (stopped.backgroundUnchecked) return []
  try {
    const jobs = jobsOf(
      await service.client.experimental.job.list({ sessionID: session.id, descendants: true, status: JOB_RUNNING }),
    )
    return jobs.filter((job) => job.kind !== SUBAGENT_KIND && job.status === JOB_RUNNING)
  } catch (error) {
    if (!isToolError(error) || error.code !== "upstream_error" || service.deadline.remaining() <= 0) throw error
    stopped.backgroundUnchecked = true
    return []
  }
}

/** How many sessions lie between `id` and the run's own session. */
function depthOf(roster: Roster, id: string): number {
  let depth = 0
  let entry = roster.entryOf(id)
  while (entry?.parentID !== undefined && depth < MAX_DEPTH) {
    depth += 1
    entry = roster.entryOf(entry.parentID)
  }
  return depth
}

/** Interrupts `sessionID` and notes it as stopped when the service says it was running. A session the service no longer has is skipped when `mayBeGone`. */
async function interruptSession({ service, stopped }: StopCall, sessionID: string, mayBeGone: boolean): Promise<void> {
  try {
    const interrupted = interruptedOf(await service.client.session.interrupt({ sessionID }))
    if (interrupted && !stopped.sessions.includes(sessionID)) stopped.sessions.push(sessionID)
  } catch (error) {
    if (!(mayBeGone && isToolError(error) && error.code === "not_found")) throw error
  }
}

/**
 * One look at the run, and what it calls for: where something is below the
 * run's own session, an active subagent's session or a job, the jobs are
 * cancelled and the subagents' sessions interrupted, the deepest first, and
 * the run's own session is left; else, where it is active, it is interrupted.
 * Returns whether anything was active.
 */
async function lookAndStop(call: StopCall): Promise<boolean> {
  const { service, session, roster, stopped } = call
  await roster.refresh()
  const members = await roster.membersOf(session.id)
  const below = members.filter((id) => id !== session.id)
  const jobs = await backgroundJobs(call)

  if (below.length > 0 || jobs.length > 0) {
    for (const job of jobs) {
      await service.client.experimental.job.cancel({ id: job.id })
      stopped.commands.add(job.id)
    }
    const deepestFirst = [...below].sort((a, b) => depthOf(roster, b) - depthOf(roster, a))
    for (const id of deepestFirst) await interruptSession(call, id, true)
    return true
  }
  if (members.includes(session.id)) {
    await interruptSession(call, session.id, false)
    return true
  }
  return false
}

/**
 * Stops the whole run: the caller's unread messages are withdrawn, then the
 * run is looked at every `INTERRUPT_POLL_MS`, and what is active is stopped
 * (`lookAndStop`) until nothing is, for `INTERRUPT_SETTLE_MS` at most and never
 * into the `WAIT_RESERVE_MS` the call keeps for reading the result. A run with
 * nothing active, where nothing was stopped, ends the looking at once; after
 * a stop two looks in a row that find nothing active end it, since a report of
 * a stopped session can start its parent again. Messages sent meanwhile are
 * withdrawn at the end.
 */
export async function stopRun(
  service: ServiceConnection,
  session: SessionEntry,
  ctx: Pick<ToolContext, "runtime" | "signal">,
): Promise<StopReport> {
  const rt = runtimeOf(ctx)
  const endsAt = rt.now() + INTERRUPT_SETTLE_MS
  const call: StopCall = {
    service,
    session,
    roster: rosterOf(service, [session]),
    stopped: { sessions: [], commands: new Set(), backgroundUnchecked: false },
  }
  const { stopped } = call

  let withdrawn = await withdrawUnread(call)
  let quietLooks = 0
  let timedOut = false
  for (;;) {
    const active = await lookAndStop(call)
    if (active) {
      quietLooks = 0
    } else {
      if (stopped.sessions.length === 0 && stopped.commands.size === 0) break
      quietLooks += 1
      if (quietLooks === QUIET_LOOKS) break
    }
    const leftMs = Math.min(endsAt - rt.now(), service.deadline.remaining() - WAIT_RESERVE_MS)
    if (leftMs <= 0) {
      timedOut = active
      break
    }
    await rt.sleep(Math.min(INTERRUPT_POLL_MS, leftMs), ctx.signal)
  }
  withdrawn += await withdrawUnread(call)

  return {
    sessions: stopped.sessions,
    commands: stopped.commands.size,
    withdrawn,
    timedOut,
    backgroundUnchecked: stopped.backgroundUnchecked,
  }
}
