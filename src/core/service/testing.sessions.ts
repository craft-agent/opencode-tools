/**
 * The session routes of the fake service (see `testing.ts`): what a real
 * OpenCode 2.4.2 service was seen to answer, typed by the client's own types.
 * It uses no test runner's API.
 */
import type {
  ConflictError,
  FileDiffInfo,
  FormInfo,
  JsonValue,
  PermissionRequest,
  SessionActive,
  SessionCreateInput,
  SessionCreateOutput,
  SessionActiveOutput,
  SessionGetOutput,
  SessionInboxListOutput,
  SessionInboxUser,
  SessionInfo,
  SessionListOutput,
  SessionMessageInfo,
  SessionNotFoundError,
  SessionPromptInput,
  SessionPromptOutput,
  SessionUpdateInput,
  ExperimentalSessionInstructionsEntryListOutput,
} from "@opencode/client"
import { VARIANT_DEFAULT } from "../role"
import { TURN_ROUTES } from "./testing.turns"

const HTTP_OK = 200
const HTTP_NO_CONTENT = 204
const HTTP_NOT_FOUND = 404
const HTTP_CONFLICT = 409
const DEFAULT_LIST_LIMIT = 50
/** What a `parentID` filter written as `null` reaches the service as. */
const NULL_QUERY = "null"
/** What the fake's cursor starts with: the rest is the offset of the next page, which only the fake understands. */
const CURSOR_PREFIX = "offset:"
/** Ids descend from here, so a later session sorts before an earlier one. */
const FIRST_ID_NUMBER = 99_999_999
const ID_DIGITS = 8
const SESSION_ID_PREFIX = "ses_"
const MESSAGE_ID_PREFIX = "msg_"

/** A prompt the fake service received, kept beside the session and never sent in it. */
export type FakePrompt = { id: string; text: string; delivery: SessionInboxUser["delivery"] }

/** A session as the fake keeps it: the client's `SessionInfo`, and what a test reads of what was done to it. */
export type FakeSession = SessionInfo & {
  prompts: FakePrompt[]
  /** The prompts that were not started: those of a session that does not run them, or that were given `resume: false`. */
  inbox: SessionInboxUser[]
  /** The session's instruction entries, by key. */
  entries: Record<string, JsonValue>
  /** The session's messages, oldest first: a prompt that runs appends its user message, and a test plays the rest (`testing.play.ts`). */
  messages: SessionMessageInfo[]
  /** The permission requests the session is paused on. */
  pending: PermissionRequest[]
  /** The forms (questions) the session is paused on. */
  forms: FormInfo[]
  /** What `session.diff` answers: the files the newest turn changed. */
  diff: FileDiffInfo[]
}

/** The part of `FakeServiceState` the session routes read and a test changes. */
export type FakeSessionState = {
  sessions: FakeSession[]
  /** The ids `session.active` lists. */
  active: string[]
  /** Whether a prompt makes its session active and busy. Default true. */
  runsPrompts: boolean
  /** Applied to what `session.get`, `session.list` and `session.create` return, so a test makes the service report what it was not given. */
  reportsBack?: (session: SessionInfo) => SessionInfo
  /** Whether the instruction entry routes answer `404 {}`, as a service without them does. Default false. */
  entriesRefused: boolean
}

/** The initial session state. */
export function defaultSessionState(): FakeSessionState {
  return { sessions: [], active: [], runsPrompts: true, entriesRefused: false }
}

/** What the session routes need of the service around them. */
export type SessionEnvironment = {
  clock: { now: number }
  /** The directory a session gets when none is given. */
  defaultDirectory: string
  projectId: (directory: string) => string
}

/** What a route answers: a status and, unless it is empty, a JSON body. */
export type FakeReply = { status: number; body?: unknown }

/** A request a route answers. */
export type SessionCall = { query: Record<string, string>; body: unknown }

/** Answers a request for a path the session routes know, else `undefined`. */
export type SessionRouter = (method: string, path: string) => ((call: SessionCall) => FakeReply) | undefined

/** The stored session, or throws: for a test that reads what the service holds. */
export function fakeSession(service: { state: FakeSessionState }, id: string): FakeSession {
  const session = service.state.sessions.find((candidate) => candidate.id === id)
  if (!session) throw new Error(`The fake service holds no session ${id}`)
  return session
}

/** A session with nothing in it but its identity and its times: what a route or a test adds to. */
export function blankSession(init: { id: string; projectID: string; directory: string; now: number }): FakeSession {
  return {
    id: init.id,
    projectID: init.projectID,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: init.now, updated: init.now },
    location: { directory: init.directory },
    prompts: [],
    inbox: [],
    entries: {},
    messages: [],
    pending: [],
    forms: [],
    diff: [],
  }
}

type Call = SessionCall & { params: string[] }
type Handler = (call: Call) => FakeReply
type SessionHandler = (session: FakeSession, call: Call) => FakeReply

const NO_CONTENT: FakeReply = { status: HTTP_NO_CONTENT }

function ok(body: unknown): FakeReply {
  return { status: HTTP_OK, body }
}

function notFound(id: string): FakeReply {
  const body: SessionNotFoundError = {
    _tag: "SessionNotFoundError",
    sessionID: id,
    message: `Session not found: ${id}`,
  }
  return { status: HTTP_NOT_FOUND, body }
}

function modelOf(model: NonNullable<SessionCreateInput["model"]>): NonNullable<SessionInfo["model"]> {
  return { id: model.id, providerID: model.providerID, variant: model.variant ?? VARIANT_DEFAULT }
}

/** Builds the routes of one fake service over its state; the ids it hands out descend. */
export function createSessionRouter(state: FakeSessionState, env: SessionEnvironment): SessionRouter {
  const counters = { session: FIRST_ID_NUMBER, message: FIRST_ID_NUMBER }
  /** Every inbox item by prompt id, whether it was started or not. */
  const items = new Map<string, SessionInboxUser>()
  const newId = (kind: keyof typeof counters, prefix: string) =>
    `${prefix}${String(counters[kind]--).padStart(ID_DIGITS, "0")}`

  const find = (id: string) => state.sessions.find((session) => session.id === id)
  const report = (session: FakeSession): SessionInfo => {
    const {
      prompts: _prompts,
      inbox: _inbox,
      entries: _entries,
      messages: _messages,
      pending: _pending,
      forms: _forms,
      diff: _diff,
      ...info
    } = session
    return state.reportsBack ? state.reportsBack(info) : info
  }
  const touch = (session: FakeSession) => {
    session.time.updated = env.clock.now
  }
  const withSession =
    (handler: SessionHandler): Handler =>
    (call) => {
      const session = find(call.params[0]!)
      return session ? handler(session, call) : notFound(call.params[0]!)
    }

  const create: Handler = ({ body }) => {
    const input = (body ?? {}) as SessionCreateInput
    const existing = input.id ? find(input.id) : undefined
    if (existing) return ok({ data: report(existing) } satisfies { data: SessionCreateOutput })
    const directory = input.location?.directory ?? env.defaultDirectory
    const now = env.clock.now
    const session: FakeSession = {
      ...blankSession({
        id: input.id ?? newId("session", SESSION_ID_PREFIX),
        projectID: env.projectId(directory),
        directory,
        now,
      }),
      ...(input.parentID && { parentID: input.parentID }),
      ...(input.agent && { agent: input.agent }),
      ...(input.model && { model: modelOf(input.model) }),
      ...(input.title && { title: input.title }),
      ...(input.metadata && { metadata: { ...input.metadata } }),
      ...(input.permissions && { permissions: input.permissions.map((rule) => ({ ...rule })) }),
    }
    state.sessions.push(session)
    return ok({ data: report(session) } satisfies { data: SessionCreateOutput })
  }

  const list: Handler = ({ query }) => {
    const limit = query.limit === undefined ? DEFAULT_LIST_LIMIT : Number(query.limit)
    const start = query.cursor?.startsWith(CURSOR_PREFIX) ? Number(query.cursor.slice(CURSOR_PREFIX.length)) : 0
    const matching = state.sessions
      .filter((session) => query.directory === undefined || session.location.directory === query.directory)
      .filter((session) => {
        if (query.parentID === undefined) return true
        return query.parentID === NULL_QUERY ? session.parentID === undefined : session.parentID === query.parentID
      })
      .sort((a, b) => b.time.updated - a.time.updated || a.id.localeCompare(b.id))
    const data = matching.slice(start, start + limit).map(report)
    const next = start + limit < matching.length ? `${CURSOR_PREFIX}${start + limit}` : undefined
    return ok({ data, cursor: next === undefined ? {} : { next } } satisfies SessionListOutput)
  }

  const update: SessionHandler = (session, { body }) => {
    const input = (body ?? {}) as SessionUpdateInput
    if (input.title !== undefined) session.title = input.title
    if (input.metadata !== undefined) session.metadata = { ...input.metadata }
    if (input.permissions !== undefined) session.permissions = input.permissions.map((rule) => ({ ...rule }))
    touch(session)
    return NO_CONTENT
  }

  const prompt: SessionHandler = (session, { body }) => {
    const input = body as SessionPromptInput
    const id = input.id ?? newId("message", MESSAGE_ID_PREFIX)
    const first = items.get(id)
    if (first) return first.sessionID === session.id ? ok({ data: first }) : conflict(id)
    const delivery = input.delivery ?? "steer"
    const item = {
      id,
      sessionID: session.id,
      time: { created: env.clock.now },
      type: "user",
      payload: { text: input.text },
      delivery,
    } satisfies SessionPromptOutput
    items.set(id, item)
    session.prompts.push({ id, text: input.text, delivery })
    if (state.runsPrompts && input.resume !== false) {
      if (!state.active.includes(session.id)) state.active.push(session.id)
      session.time.busy = env.clock.now
      session.messages.push({ id, time: { created: env.clock.now }, type: "user", text: input.text })
    } else {
      session.inbox.push(item)
    }
    return ok({ data: item })
  }

  const entryList: SessionHandler = (session) => {
    const data = Object.entries(session.entries).map(([key, value]) => ({ key, value }))
    return ok({ data } satisfies { data: ExperimentalSessionInstructionsEntryListOutput })
  }
  const entryPut: SessionHandler = (session, { params, body }) => {
    session.entries[params[1]!] = (body as { value: JsonValue }).value
    return NO_CONTENT
  }
  const entryRemove: SessionHandler = (session, { params }) => {
    delete session.entries[params[1]!]
    return NO_CONTENT
  }
  const entryRoute =
    (handler: SessionHandler): Handler =>
    (call) =>
      state.entriesRefused ? { status: HTTP_NOT_FOUND, body: {} } : withSession(handler)(call)

  const routes: [method: string, pattern: RegExp, handler: Handler][] = [
    ["POST", /^\/api\/session$/, create],
    ["GET", /^\/api\/session$/, list],
    [
      "GET",
      /^\/api\/session\/active$/,
      () =>
        ok({
          data: Object.fromEntries(state.active.map((id) => [id, { type: "running" } satisfies SessionActive])),
        } satisfies { data: SessionActiveOutput }),
    ],
    [
      "GET",
      /^\/api\/session\/([^/]+)$/,
      withSession((session) => ok({ data: report(session) } satisfies { data: SessionGetOutput })),
    ],
    ["PATCH", /^\/api\/session\/([^/]+)$/, withSession(update)],
    [
      "DELETE",
      /^\/api\/session\/([^/]+)$/,
      withSession((session) => {
        state.sessions.splice(state.sessions.indexOf(session), 1)
        state.active = state.active.filter((id) => id !== session.id)
        return NO_CONTENT
      }),
    ],
    [
      "POST",
      /^\/api\/session\/([^/]+)\/agent$/,
      withSession((session, { body }) => {
        session.agent = (body as { agent: string }).agent
        touch(session)
        return NO_CONTENT
      }),
    ],
    [
      "POST",
      /^\/api\/session\/([^/]+)\/model$/,
      withSession((session, { body }) => {
        session.model = modelOf((body as { model: NonNullable<SessionCreateInput["model"]> }).model)
        touch(session)
        return NO_CONTENT
      }),
    ],
    ["POST", /^\/api\/session\/([^/]+)\/prompt$/, withSession(prompt)],
    [
      "GET",
      /^\/api\/session\/([^/]+)\/inbox$/,
      withSession((session) => ok({ data: session.inbox } satisfies { data: SessionInboxListOutput })),
    ],
    ...TURN_ROUTES.map(([method, pattern, handler]): [string, RegExp, Handler] => [
      method,
      pattern,
      withSession(handler),
    ]),
    ["GET", /^\/api\/experimental\/session\/([^/]+)\/instructions\/entries$/, entryRoute(entryList)],
    ["PUT", /^\/api\/experimental\/session\/([^/]+)\/instructions\/entries\/([^/]+)$/, entryRoute(entryPut)],
    ["DELETE", /^\/api\/experimental\/session\/([^/]+)\/instructions\/entries\/([^/]+)$/, entryRoute(entryRemove)],
  ]

  return (method, path) => {
    for (const [routeMethod, pattern, handler] of routes) {
      const hit = routeMethod === method ? pattern.exec(path) : null
      if (hit) return (call) => handler({ ...call, params: hit.slice(1).map(decodeURIComponent) })
    }
    return undefined
  }
}

function conflict(id: string): FakeReply {
  const body: ConflictError = { _tag: "ConflictError", message: `Message id already used by another session: ${id}` }
  return { status: HTTP_CONFLICT, body }
}
