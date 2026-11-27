import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { ToolError } from "../errors"
import { abortError } from "../exec"
import { runtimeOf, type ServiceEndpoint, type ToolRuntime } from "../runtime"
import type { ToolContext } from "../tool"
import { serviceEnv } from "./env"
import { REQUEST_TIMEOUT_MS, UNREADABLE_REPLY, serviceError } from "./errors"
import { checkServiceVersion } from "./version"

export { REQUEST_TIMEOUT_MS }

/** What a call that started a missing service waits for it to register. */
export const START_TIMEOUT_MS = 30_000
/** How often a started service is looked for. */
export const START_POLL_MS = 250
/** The program and arguments that start the service, run through the runtime's `start`. */
export const SERVICE_COMMAND = ["opencode", "serve", "--service"] as const

const NOT_INSTALLED = 'OpenCode is not installed, or "opencode" is not on PATH.'
const NOT_STARTED = "The OpenCode service could not be started."
const NOT_REGISTERED = `The OpenCode service did not start within ${START_TIMEOUT_MS / 1000} seconds.`

export type ServiceConnection = {
  /** Every method of it fails with what `serviceError` makes of the failure of its request. */
  client: OpenCodeClient
  /** The version the service reports. */
  version: string
  /** True when this call found no service and started one. Two calls made at once may both say so: the service settles which process stays. */
  started: boolean
}

type ConnectContext = Pick<ToolContext, "signal" | "runtime">

export type ConnectOptions = {
  /** The time limit of every request the client makes; defaults to `REQUEST_TIMEOUT_MS`. It covers the whole request, its body included, so a caller that reads a stream passes its own. */
  requestTimeoutMs?: number
}

function checkNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal)
}

async function startService(rt: ToolRuntime, signal: AbortSignal | undefined): Promise<ServiceEndpoint> {
  const startedAt = rt.now()
  try {
    await rt.start([...SERVICE_COMMAND], { env: serviceEnv(rt.env) })
  } catch (error) {
    if (signal?.aborted) throw abortError(signal)
    throw new ToolError(
      "upstream_error",
      error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT" ? NOT_INSTALLED : NOT_STARTED,
    )
  }
  for (;;) {
    await rt.sleep(START_POLL_MS, signal)
    const endpoint = await rt.discover()
    checkNotAborted(signal)
    if (endpoint) return endpoint
    if (rt.now() >= startedAt + START_TIMEOUT_MS) throw new ToolError("upstream_error", NOT_REGISTERED)
  }
}

/** The `fetch` the client sends with: the runtime's, ended by the call's signal and by the time limit. */
function limitedFetch(rt: ToolRuntime, signal: AbortSignal | undefined, timeoutMs: number): typeof globalThis.fetch {
  return ((input, init) => {
    const ends = [AbortSignal.timeout(timeoutMs)]
    if (init?.signal) ends.push(init.signal)
    if (signal) ends.push(signal)
    return rt.fetch(input, { ...init, signal: AbortSignal.any(ends) })
  }) as typeof globalThis.fetch
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null
}

/**
 * Wraps an object of the client so that every function in it, at any depth,
 * passes a thrown error or a rejection through `map` and rethrows the result.
 * The mapping belongs to the request, not to the code that makes it: a tool's
 * own failure inside a callback is never taken for the service's. A value
 * that is not a promise, such as the `AsyncIterable` of a stream method, is
 * returned as it is. Members are wrapped on first access and kept, so
 * `client.agent === client.agent`, and functions run on the original object.
 */
function mappingFailures<T extends object>(target: T, map: (error: unknown) => unknown): T {
  const members = new Map<PropertyKey, unknown>()
  return new Proxy(target, {
    get(object, key) {
      if (members.has(key)) return members.get(key)
      const value: unknown = Reflect.get(object, key)
      const remember = (member: unknown): unknown => {
        members.set(key, member)
        return member
      }
      if (typeof value === "function") {
        return remember((...args: unknown[]): unknown => {
          try {
            const result: unknown = Reflect.apply(value, object, args)
            return result instanceof Promise
              ? result.catch((error: unknown) => {
                  throw map(error)
                })
              : result
          } catch (error) {
            throw map(error)
          }
        })
      }
      return isObject(value) ? remember(mappingFailures(value, map)) : value
    },
  })
}

/** Finds the service, starting a missing one with `serviceEnv`, and checks its version. */
export async function connectService(ctx: ConnectContext, options: ConnectOptions = {}): Promise<ServiceConnection> {
  const rt = runtimeOf(ctx)
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  checkNotAborted(ctx.signal)

  let endpoint = await rt.discover()
  checkNotAborted(ctx.signal)
  const started = endpoint === undefined
  // Two callers may both start the service: of two services started together the loser exits by itself, so no lock is needed.
  endpoint ??= await startService(rt, ctx.signal)

  const client = mappingFailures(
    OpenCode.make({
      baseUrl: endpoint.url,
      headers: endpoint.headers,
      fetch: limitedFetch(rt, ctx.signal, timeoutMs),
    }),
    (error) => serviceError(error, { signal: ctx.signal, timeoutMs }),
  )
  // The reply is JSON the client does not validate.
  const info: unknown = await client.server.info()
  const version = isObject(info) && "version" in info ? info.version : undefined
  if (typeof version !== "string") throw new ToolError("upstream_error", UNREADABLE_REPLY)
  checkServiceVersion(version)
  return { client, version, started }
}

/** Connects, then runs `use` with the service. What `use` throws is its own: only the failures of the client's requests are mapped, where they are made. */
export async function withService<T>(
  ctx: ConnectContext,
  use: (service: ServiceConnection) => Promise<T>,
  options: ConnectOptions = {},
): Promise<T> {
  return use(await connectService(ctx, options))
}
