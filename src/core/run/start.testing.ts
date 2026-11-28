/**
 * Test support for the tests of the start tools: a temporary Git repository,
 * the fake service and a context whose runtime points at it, and builders for
 * the sessions the fake holds. Imported by tests only; it uses no test
 * runner's API.
 */
import { join } from "node:path"
import type { AgentInfo, ModelInfo } from "@opencode/client"
import { invoke, type ToolContext, type ToolOptions } from "../tool"
import {
  FAKE_TMP,
  createFakeService,
  fakeRuntime,
  type FakeRuntime,
  type FakeRuntimeOptions,
  type FakeService,
  type FakeServiceState,
  type FakeSession,
} from "../service/testing"
import { repository } from "../service/read.testing"
import { BINDING_VERSION, withBinding, type Binding } from "./binding"
import { checkout } from "./git.testing"
import type { Rule } from "./rule"
import { rulesetOf } from "./ruleset"
import { scratchDirectories, withResolved } from "./scratch"
import { opencodeRunStart, opencodeRunStartWrite } from "./start.tool"
import type { StartOutput } from "./start.schemas"
import type { Policy } from "../role"

/** Whoever the calls of a test are made for. */
export const CALLER = "test-caller"

export type StartSetup = {
  service: FakeService
  runtime: FakeRuntime
  ctx: ToolContext
  /** The real path of a temporary checkout on `main`, the working directory of the calls. */
  directory: string
}

/**
 * A temporary checkout, a fake service, a runtime for it that has the real
 * `PATH` and `HOME` git needs, and a context to call the tools with. Call
 * `cleanup` of `git.testing` after the test.
 */
export async function startSetup(
  options: {
    state?: Partial<FakeServiceState>
    runtime?: FakeRuntimeOptions
    options?: Record<string, unknown>
    caller?: string
  } = {},
): Promise<StartSetup> {
  const directory = await checkout()
  const service = createFakeService({ repositories: { [directory]: repository("main") }, ...options.state })
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }
  const runtime = fakeRuntime(service, { env, ...options.runtime })
  const ctx: ToolContext = {
    cwd: directory,
    caller: options.caller ?? CALLER,
    runtime,
    ...(options.options && { options: options.options as ToolOptions }),
  }
  return { service, runtime, ctx, directory }
}

/** Calls `opencode_run_start` as the entry points do. */
export function startReadOnly(args: Record<string, unknown>, ctx: ToolContext): Promise<StartOutput> {
  return invoke(opencodeRunStart, args, ctx)
}

/** Calls `opencode_run_start_write` as the entry points do. */
export function startWrite(args: Record<string, unknown>, ctx: ToolContext): Promise<StartOutput> {
  return invoke(opencodeRunStartWrite, args, ctx)
}

/** The ruleset a run of `policy` gets from a call made under `setup`. */
export async function expectedRuleset(setup: StartSetup, policy: Policy): Promise<Rule[]> {
  return rulesetOf({
    policy,
    scratch: await withResolved(scratchDirectories(setup.runtime.env, FAKE_TMP)),
    readRoots: [],
    rules: [],
  })
}

/** The requests the service received other than its plugin polling, as `METHOD /path`. */
export function callsOf(service: FakeService): string[] {
  return service.requests.filter((request) => request.path !== "/api/plugin").map((r) => `${r.method} ${r.path}`)
}

/** The requests received whose path ends with `suffix`. */
export function requestsTo(service: FakeService, suffix: string): FakeService["requests"] {
  return service.requests.filter((request) => request.path.endsWith(suffix))
}

/** The binding a run of `setup` has after a start under `role`, without a mark. */
export function expectedBinding(setup: StartSetup, role = "plan", overrides: Partial<Binding> = {}): Binding {
  return {
    v: BINDING_VERSION,
    caller: setup.ctx.caller,
    role,
    repository: join(setup.directory, ".git"),
    branch: "main",
    ...overrides,
  }
}

export type SeededSession = {
  id: string
  directory: string
  parentID?: string
  agent?: string
  model?: { providerID: string; id: string; variant: string }
  permissions?: Rule[]
  metadata?: FakeSession["metadata"]
  /** When the session last started to run. */
  busy?: number
  /** Whether the service lists it as running. */
  active?: boolean
}

/** Puts a session the service holds, as one a person or another run made. */
export function seedSession(service: FakeService, init: SeededSession): FakeSession {
  const now = service.clock.now
  const session: FakeSession = {
    id: init.id,
    projectID: `project:${init.directory}`,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: now, updated: now, ...(init.busy !== undefined && { busy: init.busy }) },
    location: { directory: init.directory },
    ...(init.parentID !== undefined && { parentID: init.parentID }),
    ...(init.agent !== undefined && { agent: init.agent }),
    ...(init.model !== undefined && { model: init.model }),
    ...(init.permissions !== undefined && { permissions: init.permissions }),
    ...(init.metadata !== undefined && { metadata: init.metadata }),
    prompts: [],
    inbox: [],
    entries: {},
    messages: [],
    pending: [],
    forms: [],
    answers: [],
    settled: [],
    asked: 0,
    diff: [],
  }
  service.state.sessions.push(session)
  if (init.active) service.state.active.push(init.id)
  return session
}

/** A session a start of `role` set up under `setup`, idle, in the checkout; `overrides` change what it holds. */
export async function seedRun(
  setup: StartSetup,
  id: string,
  role = "plan",
  overrides: Partial<SeededSession> = {},
): Promise<FakeSession> {
  const policy = role === "build" ? "write" : "read-only"
  return seedSession(setup.service, {
    id,
    directory: setup.directory,
    agent: role,
    model: { providerID: "acme", id: "model-1", variant: "default" },
    permissions: await expectedRuleset(setup, policy),
    metadata: withBinding(undefined, expectedBinding(setup, role)),
    ...overrides,
  })
}

/** An agent of the fake service's kind. */
export function agentNamed(id: string, mode: AgentInfo["mode"] = "primary"): AgentInfo {
  return { ...createFakeService().state.agents[0]!, id, name: id, mode }
}

/** A model of the fake service's kind, of the provider `acme`. */
export function modelNamed(id: string, variants: string[] = []): ModelInfo {
  return {
    ...createFakeService().state.models[0]!,
    id,
    modelID: id,
    name: id,
    variants: variants.map((v) => ({ id: v })),
  }
}
