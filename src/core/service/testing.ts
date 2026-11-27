/**
 * Test support, imported by tests only and never by `index.ts`: one fake of the
 * OpenCode service, typed by the client's own types so a reply whose shape
 * drifted fails the type check, and the runtime that points the tools at it.
 * It uses no test runner's API, so it typechecks with Node's types alone.
 */
import type {
  AgentInfo,
  AgentListOutput,
  ModelDefaultOutput,
  ModelInfo,
  ModelListOutput,
  ProviderInfo,
  ProviderListOutput,
  ServerInfo,
  UnauthorizedError,
  VcsFileStatus,
  VcsGetOutput,
  VcsInfo,
  VcsStatusOutput,
} from "@opencode/client"
import { abortError } from "../exec"
import type { ServiceEndpoint, ToolRuntime } from "../runtime"
import { MIN_SERVICE_VERSION } from "./version"

/** The endpoint the fake runtime's `discover` returns. */
export const FAKE_ENDPOINT: ServiceEndpoint = {
  url: "http://service.test",
  headers: { authorization: "Basic fake" },
}

/** The directory a reply names when the request names none. */
const DEFAULT_DIRECTORY = "/work/acme"
const LOCATION_QUERY = "location[directory]"
const JSON_HEADERS = { "content-type": "application/json" }
/** What the route of a directory that is not a repository answers: no provider, no branch. */
const NOT_A_REPOSITORY: VcsInfo = { branch: {} }
const FAKE_START_TIME = Date.UTC(2026, 0, 1)
const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404
/** What every known route answers a request without the endpoint's credentials. */
const UNAUTHORIZED: UnauthorizedError = { _tag: "UnauthorizedError", message: "The credentials are missing or wrong." }

/** What a directory that is a repository answers `vcs.get` and `vcs.status` with. */
export type FakeRepository = { vcs: VcsInfo; status: VcsFileStatus[] }

/** What the fake service holds; a test changes it between calls. */
export type FakeServiceState = {
  info: ServerInfo
  agents: AgentInfo[]
  models: ModelInfo[]
  defaultModel: ModelInfo | null
  providers: ProviderInfo[]
  /** By directory; a directory not listed is not a repository: `vcs.get` has no provider or branch for it and `vcs.status` no files. */
  repositories: Record<string, FakeRepository>
}

/** A request the fake service received. */
export type FakeRequest = {
  method: string
  path: string
  /** The query as a plain record, such as `{ "location[directory]": "/work/acme" }`; of a repeated name, the last value. */
  query: Record<string, string>
  /** Whether it carried the authorization header of `FAKE_ENDPOINT`. */
  authorized: boolean
}

export type FakeOutcome = Response | Error | (() => Response | Promise<Response>)

export type FakeService = {
  /** What the service holds; a test changes it between calls. */
  state: FakeServiceState
  /** The `fetch` to give the client. */
  fetch: typeof globalThis.fetch
  /** Every request received, oldest first, those it refused for lack of credentials included. */
  requests: FakeRequest[]
  /** Makes the next request whose path matches answer with this response, or reject with this error, instead of the route's reply. */
  failNext(path: string | RegExp, outcome: FakeOutcome): void
}

function fakeAgent(id: string, mode: AgentInfo["mode"]): AgentInfo {
  return {
    id,
    name: id,
    mode,
    hidden: false,
    request: { settings: {}, headers: {}, body: {} },
    permissions: [],
  }
}

function fakeModel(modelID: string, variants: string[] = []): ModelInfo {
  return {
    id: modelID,
    modelID,
    providerID: "acme",
    name: `Acme ${modelID}`,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: variants.map((id) => ({ id })),
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 100_000, output: 8_000 },
  }
}

function defaultState(): FakeServiceState {
  const models = [fakeModel("model-1"), fakeModel("model-2", ["low", "high"])]
  return {
    info: { version: MIN_SERVICE_VERSION, pid: 4242, urls: [FAKE_ENDPOINT.url], paths: { tmp: "/tmp/acme" } },
    agents: [fakeAgent("plan", "primary"), fakeAgent("build", "primary"), fakeAgent("scout", "subagent")],
    models,
    defaultModel: models[0]!,
    providers: [{ id: "acme", name: "Acme", activation: "enabled", package: "acme-sdk" }],
    repositories: {},
  }
}

type Route = (state: FakeServiceState, location: { directory: string }) => unknown

const ROUTES: Record<string, Route> = {
  "GET /api/info": (state) => state.info satisfies ServerInfo,
  "GET /api/agent": (state, location) => ({ location, data: state.agents }) satisfies AgentListOutput,
  "GET /api/model": (state, location) => ({ location, data: state.models }) satisfies ModelListOutput,
  "GET /api/model/default": (state, location) => ({ location, data: state.defaultModel }) satisfies ModelDefaultOutput,
  "GET /api/provider": (state, location) => ({ location, data: state.providers }) satisfies ProviderListOutput,
  "GET /api/vcs": (state, location) =>
    ({ location, data: state.repositories[location.directory]?.vcs ?? NOT_A_REPOSITORY }) satisfies VcsGetOutput,
  "GET /api/vcs/status": (state, location) =>
    ({ location, data: state.repositories[location.directory]?.status ?? [] }) satisfies VcsStatusOutput,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function urlOf(input: Parameters<typeof globalThis.fetch>[0]): URL {
  if (input instanceof URL) return input
  return new URL(typeof input === "string" ? input : input.url)
}

/** Settles with `work`, or rejects with the signal's reason as soon as the signal aborts, as a real `fetch` does. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return work
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort))
  })
}

/** Creates the one fake service the tools' tests run against: a `fetch` for the client that answers from `state`. */
export function createFakeService(initial: Partial<FakeServiceState> = {}): FakeService {
  const state: FakeServiceState = { ...defaultState(), ...initial }
  const requests: FakeRequest[] = []
  const failures: { path: string | RegExp; outcome: FakeOutcome }[] = []

  const answer = async (request: FakeRequest): Promise<Response> => {
    const index = failures.findIndex(({ path }) =>
      typeof path === "string" ? path === request.path : path.test(request.path),
    )
    if (index >= 0) {
      const { outcome } = failures.splice(index, 1)[0]!
      if (outcome instanceof Error) throw outcome
      return typeof outcome === "function" ? outcome() : outcome
    }
    const route = ROUTES[`${request.method} ${request.path}`]
    if (!route) return jsonResponse({}, HTTP_NOT_FOUND)
    if (!request.authorized) return jsonResponse(UNAUTHORIZED, HTTP_UNAUTHORIZED)
    return jsonResponse(route(state, { directory: request.query[LOCATION_QUERY] ?? DEFAULT_DIRECTORY }))
  }

  const serve = async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): Promise<Response> => {
    init?.signal?.throwIfAborted()
    const url = urlOf(input)
    const request: FakeRequest = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorized: new Headers(init?.headers).get("authorization") === FAKE_ENDPOINT.headers?.authorization,
    }
    requests.push(request)
    return untilAborted(answer(request), init?.signal)
  }

  return {
    state,
    fetch: serve as typeof globalThis.fetch,
    requests,
    failNext: (path, outcome) => {
      failures.push({ path, outcome })
    },
  }
}

export type FakeRuntime = ToolRuntime & {
  /** Every program the runtime was asked to start: its argv and the environment given. */
  started: { argv: string[]; env: Record<string, string> }[]
  /** The virtual clock: `sleep` advances it at once and never waits. */
  clock: { now: number }
}

export type FakeRuntimeOptions = {
  env?: Record<string, string | undefined>
  /** False: no service is registered until one is started. Default true. */
  running?: boolean
  /** How many `discover` calls after a start still find nothing. Default 0. `Infinity`: a start never brings one up. */
  startsAfterPolls?: number
  /** The error `start` rejects with, e.g. `Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" })`. */
  startError?: Error
  /** Runs before each `discover` call answers, so a test can act while the call is pending. */
  beforeDiscover?: () => void | Promise<void>
}

/** The runtime of a test: the fake service's `fetch`, a virtual clock, no real wait and no real program. */
export function fakeRuntime(service: FakeService, options: FakeRuntimeOptions = {}): FakeRuntime {
  const clock = { now: FAKE_START_TIME }
  const started: FakeRuntime["started"] = []
  let running = options.running ?? true
  /** The `discover` calls that still find nothing after a start; `undefined` while no start is under way. */
  let pollsLeft: number | undefined

  return {
    env: options.env ?? {},
    started,
    clock,
    now: () => clock.now,
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw abortError(signal)
      clock.now += ms
      await Promise.resolve()
      if (signal?.aborted) throw abortError(signal)
    },
    fetch: service.fetch,
    discover: async () => {
      await options.beforeDiscover?.()
      if (!running && pollsLeft !== undefined) {
        if (pollsLeft > 0) pollsLeft -= 1
        else running = true
      }
      return running ? FAKE_ENDPOINT : undefined
    },
    start: async (argv, startOptions) => {
      started.push({ argv: [...argv], env: { ...startOptions.env } })
      if (options.startError) throw options.startError
      pollsLeft ??= options.startsAfterPolls ?? 0
      return { pid: undefined }
    },
  }
}
