/**
 * The route of the fake service (see `testing.ts`) that forks a session. What
 * a real OpenCode 2.4.2 service was seen to answer, typed by the client's own
 * types; uses no test runner's API.
 */
import type { InvalidRequestError, SessionForkOutput } from "@opencode/client"
import type { ControlContext, ControlRoute } from "./testing.control"
import { blankSession } from "./testing.lifecycle"
import type { Call, FakeReply, FakeSession } from "./testing.sessions"

const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const EMPTY_SESSION_KIND = "empty_session"
/** A title that is already a fork's: what comes before the suffix and its number. */
const FORK_TITLE = /^(.*) \(fork #(\d+)\)$/s

function emptySession(id: string): FakeReply {
  const body: InvalidRequestError = {
    _tag: "InvalidRequestError",
    message: `Cannot fork empty session: ${id}`,
    kind: EMPTY_SESSION_KIND,
  }
  return { status: HTTP_BAD_REQUEST, body }
}

/** The source's title with ` (fork #1)` added, or the number of the one it ends in raised by one. */
function forkTitle(title: string): string {
  const numbered = FORK_TITLE.exec(title)
  return numbered ? forkedTitle(numbered[1]!, Number(numbered[2]) + 1) : forkedTitle(title, 1)
}

function forkedTitle(base: string, number: number): string {
  return `${base} (fork #${number})`
}

/**
 * Forks a session into a new one, which is stored: no parent, a `fork` field
 * naming the source and its newest message, the source's agent, model,
 * metadata, permissions, entries and title copied (the title numbered), what
 * waits unread in its inbox copied as items made now, under new ids, and its
 * messages copied under new ids, a turn still in flight left out. The
 * source may be running; the fork is not. A session with no messages answers
 * 400. The `before` of the request is not modelled: the body is `{}` and the
 * fork always goes through the newest message.
 */
function fork(session: FakeSession, _call: Call, context: ControlContext): FakeReply {
  const { state, clock, newSessionId, newMessageId, report } = context
  const newest = session.messages.at(-1)
  if (newest === undefined) return emptySession(session.id)
  const id = newSessionId()
  const copy: FakeSession = {
    ...blankSession({ id, projectID: session.projectID, directory: session.location.directory, now: clock.now }),
    location: structuredClone(session.location),
    fork: { sessionID: session.id, boundary: { type: "through", messageID: newest.id } },
    ...(session.agent !== undefined && { agent: session.agent }),
    ...(session.model !== undefined && { model: structuredClone(session.model) }),
    ...(session.title !== undefined && { title: forkTitle(session.title) }),
    ...(session.metadata !== undefined && { metadata: structuredClone(session.metadata) }),
    ...(session.permissions !== undefined && { permissions: structuredClone(session.permissions) }),
    entries: structuredClone(session.entries),
    inbox: session.inbox.map((item) => ({
      ...structuredClone(item),
      id: newMessageId(),
      sessionID: id,
      time: { created: clock.now },
    })),
    messages: session.messages
      .filter((message) => message.type !== "assistant" || message.time.completed !== undefined)
      .map((message, index) => ({ ...structuredClone(message), id: `${id}:message${index + 1}` })),
  }
  state.sessions.push(copy)
  return { status: HTTP_OK, body: { data: report(copy) } satisfies { data: SessionForkOutput } }
}

/** The route that forks one session. */
export const FORK_ROUTES: ControlRoute[] = [["POST", /^\/api\/session\/([^/]+)\/fork$/, fork]]
