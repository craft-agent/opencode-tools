/**
 * Test support for the tests of what a run is paused on: a run that is paused
 * (its session bound to the test's caller and active), on the setup of the
 * `opencode_run_read` tests. Imported by tests only; it uses no test runner's
 * API.
 */
import { boundRun, runSetup, type RunSetup } from "../run/read.testing"
import type { SeededSession } from "../run/start.testing"
import { sessionIfThere } from "../run/tree"
import { withService } from "../service/connect"
import type { FakeService, FakeSession } from "../service/testing"
import type { ToolContext } from "../tool"
import { pendingOf, type Pending } from "./pending"

/** The run's session in the tests. */
export const RUN = "ses_run"

/** The arguments of a shell call that switches branch, as a request of the run names them. */
export const SWITCH = { command: "git switch -c topic", workdir: "/work/acme" }

/** A set-up of a run that is active, with its session. */
export type RequestSetup = RunSetup & { run: FakeSession }

/** The `runSetup` options, and the run's session as `boundRun` takes them. */
export function requestSetup(
  options: Parameters<typeof runSetup>[0] = {},
  run: Partial<SeededSession> = {},
): RequestSetup {
  const setup = runSetup(options)
  return { ...setup, run: boundRun(setup.service, RUN, { busy: setup.service.clock.now, active: true, ...run }) }
}

/** The ids of the messages of `sessionID` the service was asked for one by one, in order. */
export function messageReadsOf(service: FakeService, sessionID: string): string[] {
  const prefix = `/api/session/${sessionID}/message/`
  return service.requests
    .filter((request) => request.method === "GET" && request.path.startsWith(prefix))
    .map((request) => decodeURIComponent(request.path.slice(prefix.length)))
}

/** What `pendingOf` gives for the run, on a service connected as a call connects. */
export function pendingIn(ctx: ToolContext): Promise<Pending[]> {
  return withService(ctx, async (service) => {
    const root = await sessionIfThere(service, RUN)
    return pendingOf(service, root!, ctx)
  })
}
