import { describe, expect, test } from "bun:test"
import { ClientError, type ClientErrorReason } from "@opencode/client"
import { ToolError } from "../errors"
import { REQUEST_TIMEOUT_MS, serviceError } from "./errors"

/** An error the route declares, as the client throws it: the body's fields on an `Error` named by its `_tag`. */
function declared(body: { _tag: string; message: string } & Record<string, unknown>): Error {
  return Object.assign(new Error(body.message), body, { name: body._tag })
}

function mapped(error: unknown, options?: Parameters<typeof serviceError>[1]): ToolError {
  const result = serviceError(error, options)
  expect(result).toBeInstanceOf(ToolError)
  return result as ToolError
}

function unexpectedStatus(status: unknown): ClientError {
  return new ClientError("UnexpectedStatus", { cause: { status }, detail: String(status) })
}

describe("serviceError: failures of the client", () => {
  test("a ToolError is returned as it is", () => {
    const error = new ToolError("not_found", "x")
    expect(serviceError(error)).toBe(error)
  })

  test("a transport failure that timed out says how long the service had", () => {
    const cause = new DOMException("The operation timed out.", "TimeoutError")
    const error = mapped(new ClientError("Transport", { cause }), { timeoutMs: 20_000 })
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service did not answer within 20 seconds.")
  })

  test("a timeout counts the default limit when none is given", () => {
    const cause = new DOMException("The operation timed out.", "TimeoutError")
    expect(mapped(new ClientError("Transport", { cause })).message).toBe(
      `The OpenCode service did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`,
    )
  })

  test("any other transport failure is a service that cannot be reached", () => {
    for (const cause of [new TypeError("fetch failed"), new DOMException("aborted", "AbortError"), undefined, "boom"]) {
      const error = mapped(new ClientError("Transport", { cause }))
      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe("The OpenCode service could not be reached.")
    }
  })

  test("a status says what it is", () => {
    expect(mapped(unexpectedStatus(503)).message).toBe(
      "The OpenCode service is starting or stopping; try again in a moment.",
    )
    expect(mapped(unexpectedStatus(401)).message).toBe("The OpenCode service refused the tools' credentials.")
    expect(mapped(unexpectedStatus(500)).message).toBe("The OpenCode service answered with status 500.")
  })

  test("a status that cannot be read is an unexpected one", () => {
    for (const status of [undefined, "500", 5.5, null]) {
      const error = mapped(unexpectedStatus(status))
      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe("The OpenCode service answered with an unexpected status.")
    }
    expect(mapped(new ClientError("UnexpectedStatus")).message).toBe(
      "The OpenCode service answered with an unexpected status.",
    )
  })

  test.each<ClientErrorReason>(["UnsupportedContentType", "MalformedResponse", "SseEventTooLarge"])(
    "%s is a reply that could not be read",
    (reason) => {
      const error = mapped(new ClientError(reason, { detail: "text/html" }))
      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe("The OpenCode service sent a reply that could not be read.")
    },
  )
})

describe("serviceError: errors the route declares", () => {
  test("a missing session is not_found", () => {
    const error = mapped(declared({ _tag: "SessionNotFoundError", sessionID: "ses_1", message: "no ses_1" }))
    expect(error.code).toBe("not_found")
    expect(error.message).toBe("The session does not exist.")
  })

  test("a refusal of the credentials is upstream_error", () => {
    const error = mapped(declared({ _tag: "UnauthorizedError", message: "nope" }))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service refused the tools' credentials.")
  })

  test("a service that is starting or stopping says so, as the 503 of the info route does", () => {
    const error = mapped(declared({ _tag: "ServiceUnavailableError", message: "restarting", service: "db" }))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service is starting or stopping; try again in a moment.")
  })

  test("an invalid request is invalid_argument and says why", () => {
    const error = mapped(declared({ _tag: "InvalidRequestError", message: "directory must be absolute" }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("The OpenCode service refused the request: directory must be absolute")
  })

  test("any other missing thing is not_found with the service's text", () => {
    const error = mapped(declared({ _tag: "AgentNotFoundError", agentID: "x", message: "No agent x" }))
    expect(error.code).toBe("not_found")
    expect(error.message).toBe("No agent x")
  })

  test("any other declared error is upstream_error with the service's text", () => {
    const error = mapped(declared({ _tag: "ConflictError", message: "busy" }))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service failed: busy")
  })

  test("the text loses control characters, is trimmed and cut, and falls back to the name", () => {
    const text = mapped(
      declared({ _tag: "ConflictError", message: `  a\u001b[31m\nb\u0000c ${"z".repeat(400)}` }),
    ).message
    expect(text).toBe(`The OpenCode service failed: a [31m b c ${"z".repeat(300 - "a [31m b c ".length)}`)
    expect(mapped(declared({ _tag: "ConflictError", message: " \n " })).message).toBe(
      "The OpenCode service failed: ConflictError",
    )
  })

  test("the name that stands for an empty message is cleaned and cut like a message", () => {
    const name = `${"x".repeat(5000)}\n\u202eNotFoundError`
    const result = mapped(Object.assign(new Error(""), { name }))
    expect(result.code).toBe("not_found")
    expect(result.message).toBe("x".repeat(300))
    expect(mapped(Object.assign(new Error(""), { name: "Odd\n\u202eNotFoundError" })).message).toBe(
      "Odd  NotFoundError",
    )
  })

  test("line and paragraph separators, bidirectional controls and the byte order mark become spaces", () => {
    const unsafe = ["\u2028", "\u2029", "\u200e", "\u200f", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e"]
    const isolates = ["\u2066", "\u2067", "\u2068", "\u2069", "\ufeff", "\u061c"]
    const message = [...unsafe, ...isolates].map((character) => `a${character}b`).join("")
    const result = mapped(declared({ _tag: "ConflictError", message })).message
    expect(result).toBe(`The OpenCode service failed: ${"a b".repeat(unsafe.length + isolates.length)}`)
    expect(result).not.toMatch(/[\u061c\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/)
    expect(mapped(declared({ _tag: "ConflictError", message: "a\u2028b\u202ec" })).message).toBe(
      "The OpenCode service failed: a b c",
    )
  })

  test("the cut counts characters, not UTF-16 units", () => {
    const result = mapped(declared({ _tag: "ConflictError", message: "😀".repeat(400) })).message
    expect(result).toBe(`The OpenCode service failed: ${"😀".repeat(300)}`)
  })

  test("an error without its own _tag is not a declared one", () => {
    const error = new Error("x")
    error.name = "ConflictError"
    expect(serviceError(error)).toBe(error)
  })
})

describe("serviceError: a declared status whose body has no tag", () => {
  test("without a message is a refused request", () => {
    const error = mapped(Object.assign(new Error(undefined), {}))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The OpenCode service refused the request.")
  })

  test("with a message says it, cleaned and cut", () => {
    expect(mapped(new Error("no such route")).message).toBe("The OpenCode service refused the request: no such route")
    const text = mapped(new Error(`  a\u001b[31m\nb ${"z".repeat(400)}`)).message
    expect(text).toBe(`The OpenCode service refused the request: a [31m b ${"z".repeat(300 - "a [31m b ".length)}`)
  })

  test("a message of blanks counts as none, without falling back to the name", () => {
    expect(mapped(new Error(" \n ")).message).toBe("The OpenCode service refused the request.")
  })

  test("a subclass of Error is a programming error and passes through", () => {
    for (const error of [new TypeError("bug"), new RangeError("bug")]) {
      expect(serviceError(error)).toBe(error)
    }
  })
})

describe("serviceError: what it does not know", () => {
  test("is returned unchanged", () => {
    const error = new TypeError("bug")
    expect(serviceError(error)).toBe(error)
    expect(serviceError("text")).toBe("text")
    expect(serviceError(undefined)).toBeUndefined()
  })

  test("an aborted signal wins over any error", () => {
    const controller = new AbortController()
    controller.abort()
    for (const error of [
      new ClientError("Transport", { cause: new TypeError("x") }),
      declared({ _tag: "SessionNotFoundError", sessionID: "s", message: "m" }),
      new TypeError("bug"),
      "text",
    ]) {
      const result = serviceError(error, { signal: controller.signal }) as Error
      expect(result.name).toBe("AbortError")
    }
  })

  test("a signal that has not aborted changes nothing", () => {
    const error = new TypeError("bug")
    expect(serviceError(error, { signal: new AbortController().signal })).toBe(error)
  })
})

describe("serviceError: texts to redact", () => {
  const redact = ["http://service.test", "service.test", "Basic czNjcmV0", "s3cretpw"]

  test("each is replaced by [redacted] in every text the service's own message is forwarded in, the longest first", () => {
    const message = "bad http://service.test (service.test) with Basic czNjcmV0 and s3cretpw"
    const replaced = "bad [redacted] ([redacted]) with [redacted] and [redacted]"
    expect(mapped(declared({ _tag: "InvalidRequestError", message }), { redact }).message).toBe(
      `The OpenCode service refused the request: ${replaced}`,
    )
    expect(mapped(declared({ _tag: "AgentNotFoundError", message }), { redact }).message).toBe(replaced)
    expect(mapped(declared({ _tag: "ConflictError", message }), { redact }).message).toBe(
      `The OpenCode service failed: ${replaced}`,
    )
    expect(mapped(new Error(message), { redact }).message).toBe(`The OpenCode service refused the request: ${replaced}`)
  })

  test("a name that stands for an empty message is redacted too", () => {
    const name = "Secret-s3cretpwNotFoundError"
    expect(mapped(Object.assign(new Error(""), { name }), { redact }).message).toBe("Secret-[redacted]NotFoundError")
  })

  test("is done before the cut", () => {
    const message = `${"z".repeat(295)} s3cretpw`
    expect(mapped(new Error(message), { redact }).message).toBe(
      `The OpenCode service refused the request: ${"z".repeat(295)} [red`,
    )
  })

  test("leaves a message without them untouched, and ignores empty entries", () => {
    const message = "directory must be absolute"
    expect(mapped(declared({ _tag: "InvalidRequestError", message }), { redact: [...redact, ""] }).message).toBe(
      `The OpenCode service refused the request: ${message}`,
    )
  })
})

describe("serviceError: what a message never carries", () => {
  test("a transport error whose cause names the address and a header", () => {
    const cause = new Error("connect ECONNREFUSED http://127.0.0.1:4096 with authorization: Basic c2VjcmV0")
    const error = new ClientError("Transport", { cause })
    expect(error.message).toContain("127.0.0.1")
    const result = mapped(error)
    expect(result.message).not.toContain("127.0.0.1")
    expect(result.message).not.toContain("http")
    expect(result.message).not.toContain("Basic")
    expect(result.cause).toBeUndefined()
  })
})
