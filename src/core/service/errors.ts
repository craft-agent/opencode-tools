import {
  ClientError,
  isFormAlreadySettledError,
  isFormInvalidAnswerError,
  isInvalidRequestError,
  isServiceUnavailableError,
  isSessionNotFoundError,
  isUnauthorizedError,
} from "@opencode/client"
import type { Deadline } from "../deadline"
import { ToolError } from "../errors"
import { abortError } from "../exec"
import { UNSAFE_CHARACTERS } from "../text"

/** How long a request to the service may take, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 10_000

const MS_PER_SECOND = 1000
/** What a call has left, at most, when a request's timeout is the call's own end rather than the request's. */
const CALL_ENDING_MS = 100
/** The most characters of a service's own text that a tool's message carries. */
const MAX_TEXT_LENGTH = 300
/** What a secret in a service's own text becomes. */
const REDACTED = "[redacted]"
/** What a session that does not exist, or that is not the caller's to see, is told. */
export const SESSION_NOT_FOUND = "The session does not exist."
/** What a reply to a question that was already answered or cancelled is told. */
export const QUESTION_SETTLED = "The question was already answered or cancelled."
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
  /** The call's time: a request that timed out with no more than `CALL_ENDING_MS` of it left failed because the call ran out, and says so. */
  deadline?: Deadline
  /**
   * Texts that must not reach a message, such as the service's address and
   * credentials: wherever the service's own text is forwarded, each non-empty
   * entry in it is replaced by `[redacted]`, the longest first.
   */
  redact?: readonly string[]
}

function upstream(message: string): ToolError {
  return new ToolError("upstream_error", message)
}

function redacted(text: string, secrets: readonly string[]): string {
  return [...secrets]
    .filter((secret) => secret !== "")
    .sort((a, b) => b.length - a.length)
    .reduce((rest, secret) => rest.split(secret).join(REDACTED), text)
}

/** A service's text on one line, without anything that moves or reorders text, and cut to `MAX_TEXT_LENGTH` characters; `secrets` are replaced first. */
export function cleaned(text: string, secrets: readonly string[] = []): string {
  return [...redacted(text, secrets).replace(UNSAFE_CHARACTERS, " ").trim()].slice(0, MAX_TEXT_LENGTH).join("")
}

/** What a service's error says; empty when it says nothing. */
function messageOf(error: Error, secrets: readonly string[]): string {
  const message: unknown = error.message
  return typeof message === "string" ? cleaned(message, secrets) : ""
}

/** An error's name; empty when it is not text, which the client lets a declared body make it. */
function nameOf(error: Error): string {
  const name: unknown = error.name
  return typeof name === "string" ? name : ""
}

/** What a service's error says, or its name when it says nothing, cleaned and cut the same way. */
function textOf(error: Error, secrets: readonly string[]): string {
  return messageOf(error, secrets) || cleaned(nameOf(error), secrets)
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

function clientFailure(error: ClientError, timeoutMs: number, deadline: Deadline | undefined): ToolError {
  switch (error.reason) {
    case "Transport":
      if (propertyOf(error.cause, "name") !== "TimeoutError")
        return upstream("The OpenCode service could not be reached.")
      // A request cut short by the call's own time says that, not that the service was slow.
      return deadline !== undefined && deadline.remaining() <= CALL_ENDING_MS
        ? deadline.ended("the OpenCode service to answer")
        : upstream(`The OpenCode service did not answer within ${timeoutMs / MS_PER_SECOND} seconds.`)
    case "UnexpectedStatus":
      return statusFailure(error.cause)
    case "UnsupportedContentType":
    case "MalformedResponse":
    case "SseEventTooLarge":
      return upstream(UNREADABLE_REPLY)
  }
}

/** The failure of an error the route declares, which the client throws as a plain `Error` named by the body's `_tag`; `undefined` for any other. */
function declaredFailure(error: Error, secrets: readonly string[]): ToolError | undefined {
  if (isSessionNotFoundError(error)) return new ToolError("not_found", SESSION_NOT_FOUND)
  if (isUnauthorizedError(error)) return upstream(CREDENTIALS_REFUSED)
  if (isServiceUnavailableError(error)) return upstream(STARTING_OR_STOPPING)
  if (isInvalidRequestError(error)) {
    return new ToolError("invalid_argument", `${REQUEST_REFUSED}: ${textOf(error, secrets)}`)
  }
  if (isFormAlreadySettledError(error)) return new ToolError("stale", QUESTION_SETTLED)
  if (isFormInvalidAnswerError(error)) {
    return new ToolError("invalid_argument", `${REQUEST_REFUSED}: ${textOf(error, secrets)}`)
  }
  const name = nameOf(error)
  if (name.endsWith(NOT_FOUND_SUFFIX)) return new ToolError("not_found", textOf(error, secrets))
  if (name.endsWith("Error") && Object.hasOwn(error, "_tag") && propertyOf(error, "_tag") === name) {
    return upstream(`The OpenCode service failed: ${textOf(error, secrets)}`)
  }
  return undefined
}

/**
 * The failure of a declared status whose body has no `_tag`, such as the bare
 * `404 {}` of a route this service version does not have: the client throws it
 * as a plain `Error`. Only the base class counts as the service's answer, and
 * it is told by its prototype, which a body cannot shadow as it can the
 * `constructor`. A name that is `"Error"`, or that the body made something
 * other than text, is the base class's. The package's own failures are
 * `ToolError`s, and a programming error is a subclass (`TypeError`,
 * `RangeError`, …), which passes through unchanged.
 */
function untaggedFailure(error: Error, secrets: readonly string[]): ToolError | undefined {
  if (Object.getPrototypeOf(error) !== Error.prototype || !["Error", ""].includes(nameOf(error))) return undefined
  const text = messageOf(error, secrets)
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
  if (error instanceof ClientError) {
    return clientFailure(error, options.timeoutMs ?? REQUEST_TIMEOUT_MS, options.deadline)
  }
  if (error instanceof Error) {
    const secrets = options.redact ?? []
    return declaredFailure(error, secrets) ?? untaggedFailure(error, secrets) ?? error
  }
  return error
}
