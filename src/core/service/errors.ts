import {
  ClientError,
  isInvalidRequestError,
  isServiceUnavailableError,
  isSessionNotFoundError,
  isUnauthorizedError,
} from "@opencode/client"
import { ToolError } from "../errors"
import { abortError } from "../exec"

/** How long a request to the service may take, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 10_000

const MS_PER_SECOND = 1000
/** The most characters of a service's own text that a tool's message carries. */
const MAX_TEXT_LENGTH = 300
/** C0 and C1 controls, the line and paragraph separators, the bidirectional controls and the byte order mark. */
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g
const NOT_FOUND_SUFFIX = "NotFoundError"
const CREDENTIALS_REFUSED = "The OpenCode service refused the tools' credentials."
const STARTING_OR_STOPPING = "The OpenCode service is starting or stopping; try again in a moment."
const REQUEST_REFUSED = "The OpenCode service refused the request"
/** What a reply the client cannot read, or one that does not have the shape the tools rely on, becomes. */
export const UNREADABLE_REPLY = "The OpenCode service sent a reply that could not be read."
const HTTP_UNAUTHORIZED = 401
const HTTP_UNAVAILABLE = 503

export type ServiceErrorOptions = {
  /** The call's signal: once it has aborted, whatever failed is the cancellation. */
  signal?: AbortSignal
  /** The time limit the request had, for the message that reports it; defaults to `REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number
}

function upstream(message: string): ToolError {
  return new ToolError("upstream_error", message)
}

/** A service's text on one line, without anything that moves or reorders text, and cut to `MAX_TEXT_LENGTH` characters. */
function cleaned(text: string): string {
  return [...text.replace(UNSAFE_CHARACTERS, " ").trim()].slice(0, MAX_TEXT_LENGTH).join("")
}

/** What a service's error says; empty when it says nothing. */
function messageOf(error: Error): string {
  const message: unknown = error.message
  return typeof message === "string" ? cleaned(message) : ""
}

/** What a service's error says, or its name when it says nothing, cleaned and cut the same way. */
function textOf(error: Error): string {
  return messageOf(error) || cleaned(error.name)
}

function propertyOf(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[name] : undefined
}

function statusFailure(cause: unknown): ToolError {
  const status = propertyOf(cause, "status")
  if (status === HTTP_UNAVAILABLE) return upstream(STARTING_OR_STOPPING)
  if (status === HTTP_UNAUTHORIZED) return upstream(CREDENTIALS_REFUSED)
  return upstream(
    typeof status === "number" && Number.isInteger(status)
      ? `The OpenCode service answered with status ${status}.`
      : "The OpenCode service answered with an unexpected status.",
  )
}

function clientFailure(error: ClientError, timeoutMs: number): ToolError {
  switch (error.reason) {
    case "Transport":
      return upstream(
        propertyOf(error.cause, "name") === "TimeoutError"
          ? `The OpenCode service did not answer within ${timeoutMs / MS_PER_SECOND} seconds.`
          : "The OpenCode service could not be reached.",
      )
    case "UnexpectedStatus":
      return statusFailure(error.cause)
    case "UnsupportedContentType":
    case "MalformedResponse":
    case "SseEventTooLarge":
      return upstream(UNREADABLE_REPLY)
  }
}

/** The failure of an error the route declares, which the client throws as a plain `Error` named by the body's `_tag`; `undefined` for any other. */
function declaredFailure(error: Error): ToolError | undefined {
  if (isSessionNotFoundError(error)) return new ToolError("not_found", "The session does not exist.")
  if (isUnauthorizedError(error)) return upstream(CREDENTIALS_REFUSED)
  if (isServiceUnavailableError(error)) return upstream(STARTING_OR_STOPPING)
  if (isInvalidRequestError(error)) {
    return new ToolError("invalid_argument", `${REQUEST_REFUSED}: ${textOf(error)}`)
  }
  if (error.name.endsWith(NOT_FOUND_SUFFIX)) return new ToolError("not_found", textOf(error))
  if (error.name.endsWith("Error") && Object.hasOwn(error, "_tag") && propertyOf(error, "_tag") === error.name) {
    return upstream(`The OpenCode service failed: ${textOf(error)}`)
  }
  return undefined
}

/**
 * The failure of a declared status whose body has no `_tag`, such as the bare
 * `404 {}` of a route this service version does not have: the client throws it
 * as a plain `Error`. Only the base class counts as the service's answer. The
 * package's own failures are `ToolError`s, and a programming error is a
 * subclass (`TypeError`, `RangeError`, …), which passes through unchanged.
 */
function untaggedFailure(error: Error): ToolError | undefined {
  if (error.constructor !== Error || error.name !== "Error") return undefined
  const text = messageOf(error)
  return upstream(text === "" ? `${REQUEST_REFUSED}.` : `${REQUEST_REFUSED}: ${text}`)
}

/**
 * The error a failed request to the service becomes: a `ToolError` with its
 * code, or the `AbortError` of a call that was cancelled. Anything it does not
 * know is returned unchanged. No message carries the service's address, a
 * header, the underlying error's text or a stack.
 */
export function serviceError(error: unknown, options: ServiceErrorOptions = {}): unknown {
  if (error instanceof ToolError) return error
  if (options.signal?.aborted) return abortError(options.signal)
  if (error instanceof ClientError) return clientFailure(error, options.timeoutMs ?? REQUEST_TIMEOUT_MS)
  if (error instanceof Error) return declaredFailure(error) ?? untaggedFailure(error) ?? error
  return error
}
