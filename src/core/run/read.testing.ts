/**
 * Test support for the tests of `opencode_run_read`: the fake service, a
 * context whose runtime points at it, and builders for the runs it holds. No
 * git is involved: a run is a session with its binding written directly.
 * Imported by tests only; it uses no test runner's API.
 */
import { invoke, type ToolContext, type ToolOptions } from "../tool"
import {
  createFakeService,
  fakeRuntime,
  fakeSession,
  type FakeRuntime,
  type FakeRuntimeOptions,
  type FakeService,
  type FakeServiceState,
  type FakeSession,
} from "../service/testing"
import { BINDING_VERSION, withBinding, type Binding } from "./binding"
import { opencodeRunRead } from "./read.tool"
import type { RunReadOutput } from "./read.schemas"
import { seedSession, type SeededSession } from "./start.testing"

/** Whoever the calls of a test are made for. */
export const CALLER = "test-caller"
/** The directory the runs of a test are in. */
export const DIRECTORY = "/work/acme"
/** The repository the runs of a test are bound to. */
const REPOSITORY = "/work/acme/.git"

export type RunSetup = { service: FakeService; runtime: FakeRuntime; ctx: ToolContext }

/** A fake service, a runtime for it and a context to call the tool with; `waitSeconds` is the call's time. */
export function runSetup(
  options: {
    state?: Partial<FakeServiceState>
    runtime?: FakeRuntimeOptions
    caller?: string
    waitSeconds?: number
    signal?: AbortSignal
  } = {},
): RunSetup {
  const service = createFakeService(options.state)
  const runtime = fakeRuntime(service, options.runtime)
  const toolOptions =
    options.waitSeconds === undefined ? undefined : ({ wait_seconds: options.waitSeconds } as unknown as ToolOptions)
  return {
    service,
    runtime,
    ctx: {
      cwd: DIRECTORY,
      caller: options.caller ?? CALLER,
      runtime,
      ...(toolOptions && { options: toolOptions }),
      ...(options.signal && { signal: options.signal }),
    },
  }
}

/** The binding of a run of `role` in `DIRECTORY`, bound to `caller`. */
export function runBinding(caller = CALLER, role = "plan", branch: string | null = "main"): Binding {
  return { v: BINDING_VERSION, caller, role, repository: REPOSITORY, branch }
}

/** A session a start of `role` left, bound to `caller`; `overrides` change what it holds. */
export function boundRun(
  service: FakeService,
  id: string,
  overrides: Partial<SeededSession> & { caller?: string; role?: string; branch?: string | null } = {},
): FakeSession {
  const { caller, role, branch, ...seed } = overrides
  return seedSession(service, {
    id,
    directory: DIRECTORY,
    agent: role ?? "plan",
    model: { providerID: "acme", id: "model-1", variant: "default" },
    metadata: withBinding(undefined, runBinding(caller, role, branch)),
    ...seed,
  })
}

/** Starts another turn of a session as a prompt does: busy at the clock, in the active set, with a user message. */
export function beginTurn(service: FakeService, id: string): void {
  const session = fakeSession(service, id)
  session.time.busy = service.clock.now
  if (!service.state.active.includes(id)) service.state.active.push(id)
  session.messages.push({
    id: `${id}:prompt${session.messages.length + 1}`,
    time: { created: service.clock.now },
    type: "user",
    text: "go on",
  })
}

/** Calls `opencode_run_read` as the entry points do. */
export function readRun(args: Record<string, unknown>, ctx: ToolContext): Promise<RunReadOutput> {
  return invoke(opencodeRunRead, args, ctx)
}

/** The requests the service received whose path ends with `suffix`. */
export function requestsTo(service: FakeService, suffix: string): FakeService["requests"] {
  return service.requests.filter((request) => request.path.endsWith(suffix))
}

/** Every request received as `METHOD /path`, in order. */
export function callsOf(service: FakeService): string[] {
  return service.requests.map((request) => `${request.method} ${request.path}`)
}

/**
 * Runs `hook` with the number of sleeps so far after each sleep of the
 * runtime, which is how a test makes the service change while a wait is
 * between two looks.
 */
export function afterSleeps(runtime: FakeRuntime, hook: (sleeps: number) => void): void {
  const sleep = runtime.sleep
  let sleeps = 0
  runtime.sleep = async (ms, signal) => {
    await sleep(ms, signal)
    sleeps += 1
    hook(sleeps)
  }
}
