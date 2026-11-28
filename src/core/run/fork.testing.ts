/**
 * Test support for the tests of `opencode_run_fork` and of a start on a fork:
 * a source session with a turn behind it, in the temporary checkout of a
 * start's setup, the tool as the entry points call it, and the sessions a fork
 * of which is refused as not found. Imported by tests only; it uses no test
 * runner's API.
 */
import type { FakeSession } from "../service/testing"
import { invoke, type ToolContext } from "../tool"
import { withBinding } from "./binding"
import type { ForkOutput } from "./fork.schemas"
import { opencodeRunFork } from "./fork.tool"
import { expectedBinding, seedRun, seedSession, type SeededSession, type StartSetup } from "./start.testing"

/** The session that is forked in the tests. */
export const SOURCE = "ses_source"
/** The title of the source. */
export const TITLE = "Plan the work"
/** The refusal of a fork of the source while it is running. */
export const RUNNING = `Session ${SOURCE} is running; a fork needs it idle.`
/** A start's mark, as a source that is being continued still carries it. */
export const MARK = { at: 1, token: "token" }

/** The ids of the sessions the service holds. */
export function heldIds(setup: StartSetup): string[] {
  return setup.service.state.sessions.map((session) => session.id)
}

/** The source: a run of `role`, idle, with a title and one message, so that the service can copy it. */
export async function seedSource(
  setup: StartSetup,
  overrides: Partial<SeededSession> = {},
  role = "plan",
): Promise<FakeSession> {
  const source = await seedRun(setup, SOURCE, role, overrides)
  source.title = TITLE
  source.messages.push({
    id: `${SOURCE}:message1`,
    time: { created: setup.service.clock.now },
    type: "user",
    text: "Go.",
  })
  return source
}

/** Calls `opencode_run_fork` as the entry points do. */
export function forkOf(session: string, ctx: ToolContext): Promise<ForkOutput> {
  return invoke(opencodeRunFork, { session }, ctx)
}

/** Ids of sessions a call is refused as not found: another caller's run, a person's own session, a subagent of the source and one the service lacks. */
export async function unownedSessions(setup: StartSetup): Promise<string[]> {
  const theirs = withBinding(undefined, expectedBinding(setup, "plan", { caller: "someone-else" }))
  await seedRun(setup, "ses_theirs", "plan", { metadata: theirs })
  seedSession(setup.service, { id: "ses_person", directory: setup.directory })
  await seedRun(setup, "ses_child", "plan", { parentID: SOURCE })
  return ["ses_theirs", "ses_person", "ses_child", "ses_none"]
}
