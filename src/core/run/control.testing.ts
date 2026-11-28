/**
 * Test support for the tests of `opencode_run_steer` and `opencode_run_interrupt`:
 * a run whose turn is in flight, the two tools as the entry points call them,
 * messages that wait in a session's inbox, and a way to change the fake service
 * between two requests of one call. Imported by tests only; it uses no test
 * runner's API.
 */
import type { SessionInboxUser } from "@opencode/client"
import { fakeChild, type FakeRuntime, type FakeService, type FakeSession } from "../service/testing"
import { invoke, type ToolContext } from "../tool"
import type { InterruptOutput } from "./interrupt.schemas"
import { opencodeRunInterrupt } from "./interrupt.tool"
import { boundRun, runSetup, type RunSetup } from "./read.testing"
import type { SteerOutput } from "./steer.schemas"
import { opencodeRunSteer } from "./steer.tool"

/** The run's session in the tests. */
export const RUN = "ses_run"

/** A run whose turn is in flight, with its session. */
export type LiveSetup = RunSetup & { run: FakeSession }

/** The `runSetup` options, and a run bound to the test's caller whose session is active and busy. */
export function liveRun(options: Parameters<typeof runSetup>[0] = {}): LiveSetup {
  const setup = runSetup(options)
  return { ...setup, run: boundRun(setup.service, RUN, { busy: setup.service.clock.now, active: true }) }
}

/** Calls `opencode_run_steer` as the entry points do, for the run's session unless another is given. */
export function steerTo(message: string, ctx: ToolContext, session = RUN): Promise<SteerOutput> {
  return invoke(opencodeRunSteer, { session, message }, ctx)
}

/** Calls `opencode_run_interrupt` as the entry points do, for the run's session unless another is given. */
export function interruptRun(ctx: ToolContext, session = RUN): Promise<InterruptOutput> {
  return invoke(opencodeRunInterrupt, { session }, ctx)
}

/**
 * Ids of sessions a call is refused as not found: another caller's run, a
 * person's own session, a subagent of the run, and one the service lacks.
 */
export function unownedSessions(service: FakeService): string[] {
  boundRun(service, "ses_theirs", { caller: "someone-else", active: true })
  boundRun(service, "ses_person", { active: true }).metadata = undefined
  return ["ses_theirs", "ses_person", fakeChild(service, RUN).id, "ses_none"]
}

/** The requests the service received that change something, as `METHOD /path`, in order. */
export function writesOf(service: FakeService): string[] {
  return service.requests
    .filter((request) => request.method !== "GET")
    .map((request) => `${request.method} ${decodeURIComponent(request.path)}`)
}

/** Puts a message of the caller in the session's inbox as the service holds one it has not read. */
export function unreadMessage(
  service: FakeService,
  sessionID: string,
  id: string,
  delivery: SessionInboxUser["delivery"] = "steer",
): SessionInboxUser {
  const item: SessionInboxUser = {
    id,
    sessionID,
    time: { created: service.clock.now },
    type: "user",
    payload: { text: `Message ${id}` },
    delivery,
  }
  service.state.sessions.find((session) => session.id === sessionID)!.inbox.push(item)
  return item
}

/**
 * Runs `hook` with the number of such requests so far, counting from 1, right
 * after the service has answered each request of `method` whose path matches,
 * so that a test changes the fake between two requests of one call.
 */
export function afterRequest(runtime: FakeRuntime, method: string, path: RegExp, hook: (nth: number) => void): void {
  const send = runtime.fetch
  let seen = 0
  runtime.fetch = (async (input, init) => {
    const response = await send(input, init)
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
    if ((init?.method ?? "GET") === method && path.test(url.pathname)) {
      seen += 1
      hook(seen)
    }
    return response
  }) as typeof runtime.fetch
}
