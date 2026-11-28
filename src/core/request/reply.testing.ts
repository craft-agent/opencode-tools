/**
 * Test support for the tests of `opencode_request_reply`: a caller of the
 * tool, the replies it takes, the requests of a run that is paused and the
 * writes the fake service received, on the setup of `request.testing.ts`.
 * Imported by tests only; it uses no test runner's API.
 */
import type { PermissionRequest, SessionMessageAssistant } from "@opencode/client"
import { callsOf } from "../run/read.testing"
import { fakeToolAsk, type FakeService } from "../service/testing"
import { invoke, type ToolContext, type ToolOptions } from "../tool"
import type { PendingPermission, PendingQuestion } from "./pending"
import type { Answer, ReplyInput, RequestReplyOutput } from "./reply.schemas"
import { opencodeRequestReply } from "./reply.tool"
import { RUN, requestSetup, type RequestSetup } from "./request.testing"

/** Calls `opencode_request_reply` as the entry points do, for the run's session unless another is given; the replies are raw, so that a test can give one the schema refuses. */
export function replyTo(replies: readonly unknown[], ctx: ToolContext, session = RUN): Promise<RequestReplyOutput> {
  return invoke(opencodeRequestReply, { session, replies }, ctx)
}

/** An approval of `request` that repeats `text`. */
export function approve(request: string, text: string): ReplyInput {
  return { request, decision: "once", text }
}

/** A rejection of `request` for `reason`. */
export function reject(request: string, reason = "Not now."): ReplyInput {
  return { request, decision: "reject", reason }
}

/** An answer to the question `request`. */
export function answer(request: string, value: Answer): ReplyInput {
  return { request, decision: "answer", answer: value }
}

/** A set-up of a paused run whose context carries the settings of `settings`. */
export function replySetup(
  options: Parameters<typeof requestSetup>[0] = {},
  settings: Record<string, unknown> = {},
): RequestSetup {
  const setup = requestSetup(options)
  if (Object.keys(settings).length > 0) {
    setup.ctx.options = { ...setup.ctx.options, ...settings } as unknown as ToolOptions
  }
  return setup
}

/** Pauses a session (the run's own unless one is given) on a request for the shell command `command`, in `step` or a step of its own. */
export function askShell(
  service: FakeService,
  command: string,
  options: { session?: string; step?: SessionMessageAssistant } = {},
): PermissionRequest {
  return fakeToolAsk(service, options.session ?? RUN, {
    tool: "shell",
    input: { command },
    action: "shell",
    resources: [command],
    ...(options.step !== undefined && { step: options.step }),
  })
}

/** The requests the service received that change something, as `METHOD /path`, in order. */
export function writesOf(service: FakeService): string[] {
  return callsOf(service).filter((call) => !call.startsWith("GET "))
}

/** The session and the request or form each write of the service answered, in order, as the route's path names them. */
export function answeredOf(service: FakeService): { session: string; id: string }[] {
  return service.requests
    .filter((request) => request.method !== "GET")
    .map((request) => {
      const [, , , session, , id] = request.path.split("/").map(decodeURIComponent)
      return { session: session!, id: id! }
    })
}

/** The path of the reply to the request or form `id` (a form that is declined has none beyond its id), for `failNext`, whether the client writes its id escaped or not. */
export function replyRoute(id: string): RegExp {
  return new RegExp(`/(?:${id}|${encodeURIComponent(id)})(?:/reply)?$`)
}

/** What the service answers as a declared error: the status and the body the client reads its `_tag` from. */
export function serviceRefusal(status: number, tag: string, message: string): Response {
  return new Response(JSON.stringify({ _tag: tag, message }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** A permission request as `pendingOf` makes one; `overrides` change what it holds. */
export function permissionPending(overrides: Partial<PendingPermission> = {}): PendingPermission {
  return {
    kind: "permission",
    id: "req_1",
    session: RUN,
    subagent: false,
    action: "shell",
    resources: ["echo hi"],
    text: "echo hi",
    ...overrides,
  }
}

/** A question as `pendingOf` makes one, with a field that takes one of two branches; `overrides` change what it holds. */
export function questionPending(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    kind: "question",
    id: "form_1",
    session: RUN,
    subagent: false,
    title: "Which branch?",
    fields: [{ key: "branch", type: "string", options: [{ value: "main" }, { value: "dev" }] }],
    ...overrides,
  }
}
