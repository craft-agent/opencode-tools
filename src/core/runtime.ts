import { discover as discoverService, headers as serviceHeaders } from "@opencode/client/service"
import { ToolError } from "./errors"
import { abortError, startDetached, type StartOptions } from "./exec"

/** Where the service answers, and the headers that authenticate to it. Never logged or returned. */
export type ServiceEndpoint = { url: string; headers?: Readonly<Record<string, string>> }

/** What a tool takes from its surroundings beside the call's own context; an entry point leaves it out and gets the real ones, a test supplies its own. */
export type ToolRuntime = {
  /** The environment the tools read: a service they start is given a named part of it. */
  env: Readonly<Record<string, string | undefined>>
  /** The clock in epoch milliseconds. */
  now(): number
  /** Resolves after `ms`; rejects with an `AbortError` when the signal aborts first. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  /** What requests to the service are sent with. */
  fetch: typeof globalThis.fetch
  /** Finds the running service; never starts one. */
  discover(): Promise<ServiceEndpoint | undefined>
  /** Starts a program and leaves it running. */
  start(argv: string[], options: StartOptions): Promise<unknown>
}

const REGISTRATION_UNREADABLE = "The OpenCode service's registration could not be read."

/**
 * The address a client on this machine reaches a service at. A service bound
 * to every interface registers `0.0.0.0` or `[::]`, which is where it listens,
 * not an address to connect to. Text that is not a URL throws.
 */
export function localUrl(url: string): string {
  const parsed = new URL(url)
  if (parsed.hostname === "0.0.0.0") parsed.hostname = "127.0.0.1"
  else if (parsed.hostname === "[::]") parsed.hostname = "[::1]"
  return parsed.href.replace(/\/+$/, "")
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal!))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** The client's own probe has a two-second limit of its own and cannot be given the call's signal. */
async function discover(): Promise<ServiceEndpoint | undefined> {
  try {
    const endpoint = await discoverService()
    if (endpoint === undefined) return undefined
    const authorization = serviceHeaders(endpoint)
    return { url: localUrl(endpoint.url), ...(authorization === undefined ? {} : { headers: authorization }) }
  } catch {
    // Neither the cause nor its text is kept: a registration holds the service's password.
    throw new ToolError("upstream_error", REGISTRATION_UNREADABLE)
  }
}

/** The real surroundings: this process's environment and clock, the global `fetch`, the client's `discover` and `startDetached`. */
export function defaultRuntime(): ToolRuntime {
  return {
    env: process.env,
    now: Date.now,
    sleep,
    // Looked up when called, so a replaced global is honoured; the cast is for a runtime whose `fetch` type carries more than the call.
    fetch: ((input, init) => globalThis.fetch(input, init)) as typeof globalThis.fetch,
    discover,
    start: startDetached,
  }
}

/** The call's runtime, else the default one. */
export function runtimeOf(ctx: { runtime?: ToolRuntime }): ToolRuntime {
  return ctx.runtime ?? defaultRuntime()
}
