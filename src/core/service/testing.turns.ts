/**
 * The routes of the fake service (see `testing.ts`) that read what a session's
 * turns left: its messages, what it is paused on and what its newest turn
 * changed. Typed by the client's own types; uses no test runner's API.
 */
import type {
  MessageNotFoundError,
  PermissionListOutput,
  SessionDiffOutput,
  SessionFormListOutput,
  SessionMessageGetOutput,
  SessionMessagesResponse,
} from "@opencode/client"
import type { Call, FakeReply, FakeSession, SessionCall } from "./testing.sessions"

const HTTP_OK = 200
const HTTP_NOT_FOUND = 404
const DEFAULT_PAGE = 50

/** Takes a session out of the active set with no end written, as `fakeStop` does. */
export type StopSession = (sessionID: string) => void

/** A route of one existing session: the router answers an unknown one itself. `call.params` are the path's captures, the session's id first. */
export type TurnRoute = [
  method: string,
  pattern: RegExp,
  handler: (session: FakeSession, call: Call, stop: StopSession) => FakeReply,
]

function ok(body: unknown): FakeReply {
  return { status: HTTP_OK, body }
}

/** The messages newest first unless `order` says `asc`, of the `type` asked for, at most `limit`. */
function messages(session: FakeSession, { query }: SessionCall): FakeReply {
  const limit = query.limit === undefined ? DEFAULT_PAGE : Number(query.limit)
  const ordered = query.order === "asc" ? [...session.messages] : [...session.messages].reverse()
  const data = ordered.filter((message) => query.type === undefined || message.type === query.type).slice(0, limit)
  return ok({ data, cursor: {} } satisfies SessionMessagesResponse)
}

/** The one message of the session with the id the path names. */
function message(session: FakeSession, { params }: Call): FakeReply {
  const messageID = params[1]!
  const found = session.messages.find((candidate) => candidate.id === messageID)
  if (found) return ok({ data: found } satisfies { data: SessionMessageGetOutput })
  const body: MessageNotFoundError = {
    _tag: "MessageNotFoundError",
    sessionID: session.id,
    messageID,
    message: `Message not found: ${messageID}`,
  }
  return { status: HTTP_NOT_FOUND, body }
}

/** The routes, each answering what a test set on the session; the `context` of a diff request is kept in the fake's request log, not applied. */
export const TURN_ROUTES: TurnRoute[] = [
  ["GET", /^\/api\/session\/([^/]+)\/message$/, messages],
  ["GET", /^\/api\/session\/([^/]+)\/message\/([^/]+)$/, message],
  [
    "GET",
    /^\/api\/session\/([^/]+)\/permission$/,
    (session) => ok({ data: session.pending } satisfies { data: PermissionListOutput }),
  ],
  [
    "GET",
    /^\/api\/session\/([^/]+)\/form$/,
    (session) => ok({ data: session.forms } satisfies { data: SessionFormListOutput }),
  ],
  [
    "GET",
    /^\/api\/session\/([^/]+)\/diff$/,
    (session) => ok({ data: session.diff } satisfies { data: SessionDiffOutput }),
  ],
]
