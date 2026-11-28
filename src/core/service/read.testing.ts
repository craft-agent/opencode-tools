/**
 * Test support for the tests of `opencode_service_read`: a context whose
 * runtime points at the fake service, and builders for what the fake holds.
 * Imported by tests only; it uses no test runner's API.
 */
import type { AgentInfo, ModelInfo } from "@opencode/client"
import { ToolError } from "../errors"
import { invoke, type ToolContext, type ToolOptions } from "../tool"
import { opencodeServiceRead } from "./read"
import type { ServiceReadOutput } from "./schemas"
import {
  createFakeService,
  fakeRuntime,
  type FakeRepository,
  type FakeRuntime,
  type FakeRuntimeOptions,
  type FakeService,
  type FakeServiceState,
} from "./testing"

/** The working directory of the calls a test makes. */
export const CWD = "/work/project"

/** A repository on a branch, as `FakeServiceState.repositories` holds one. */
export function repository(branch?: string): FakeRepository {
  return { vcs: { provider: "git", branch: { ...(branch !== undefined && { current: branch }) } }, status: [] }
}

export type ReadSetup = { service: FakeService; runtime: FakeRuntime; ctx: ToolContext }

/** A fake service, a runtime for it and a context to call the tool with; the service starts out holding what `createFakeService` gives, and CWD is a Git repository on `main`. */
export function setup(
  options: {
    state?: Partial<FakeServiceState>
    runtime?: FakeRuntimeOptions
    ctx?: Partial<ToolContext>
    roles?: unknown
  } = {},
): ReadSetup {
  const service = createFakeService({ repositories: { [CWD]: repository("main") }, ...options.state })
  const runtime = fakeRuntime(service, options.runtime)
  const roles = options.roles === undefined ? undefined : ({ roles: options.roles } as unknown as ToolOptions)
  return { service, runtime, ctx: { cwd: CWD, caller: "test-caller", runtime, options: roles, ...options.ctx } }
}

/** Calls the tool as the entry points do. */
export function read(args: Record<string, unknown>, ctx: ToolContext): Promise<ServiceReadOutput> {
  return invoke(opencodeServiceRead, args, ctx)
}

/** The `ToolError` a call fails with; any other outcome fails the test. */
export async function failure(pending: Promise<unknown>): Promise<ToolError> {
  const error = await pending.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  if (!(error instanceof ToolError)) throw new Error(`Expected a ToolError, got ${String(error)}`)
  return error
}

/** An agent like the fake's own, with what a test needs changed. */
export function agentLike(id: string, overrides: Partial<AgentInfo> = {}): AgentInfo {
  return { ...createFakeService().state.agents[0]!, id, name: id, ...overrides }
}

/** A model like the fake's own, of the provider `acme` unless the test says otherwise. */
export function modelLike(id: string, overrides: Partial<ModelInfo> = {}): ModelInfo {
  return { ...createFakeService().state.models[0]!, id, modelID: id, name: `Acme ${id}`, ...overrides }
}

/** A model's variants as the service lists them. */
export function variantsOf(...ids: string[]): ModelInfo["variants"] {
  return ids.map((id) => ({ id }))
}
