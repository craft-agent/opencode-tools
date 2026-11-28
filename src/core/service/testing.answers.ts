/**
 * The routes of the fake service (see `testing.ts`) that answer what a session
 * is paused on: a permission request, a form. What a real OpenCode 2.4.2
 * service was seen to answer, typed by the client's own types; uses no test
 * runner's API.
 */
import type {
  FormAlreadySettledError,
  FormField,
  FormInfo,
  FormInvalidAnswerError,
  FormNotFoundError,
  JsonValue,
  PermissionNotFoundError,
  PermissionReplyInput,
  SessionFormReplyInput,
} from "@opencode/client"
import type { Call, FakeReply, FakeSession } from "./testing.sessions"
import type { StopSession, TurnRoute } from "./testing.turns"

const HTTP_BAD_REQUEST = 400
const HTTP_NO_CONTENT = 204
const HTTP_NOT_FOUND = 404
const HTTP_CONFLICT = 409

const NO_CONTENT: FakeReply = { status: HTTP_NO_CONTENT }

/** What the check of a form's answer says of a value of the wrong kind, by the field's type: the field that cannot be acknowledged has none. */
const KIND_WORDS: Record<Exclude<FormField["type"], "external">, string> = {
  string: "string",
  number: "number",
  integer: "integer",
  boolean: "boolean",
  multiselect: "string array",
}

function permissionNotFound(requestID: string): FakeReply {
  const body: PermissionNotFoundError = {
    _tag: "PermissionNotFoundError",
    requestID,
    message: `Permission request not found: ${requestID}`,
  }
  return { status: HTTP_NOT_FOUND, body }
}

function formNotFound(id: string): FakeReply {
  const body: FormNotFoundError = { _tag: "FormNotFoundError", id, message: `Form not found: ${id}` }
  return { status: HTTP_NOT_FOUND, body }
}

function formSettled(id: string): FakeReply {
  const body: FormAlreadySettledError = {
    _tag: "FormAlreadySettledError",
    id,
    message: `Form already settled: ${id}`,
  }
  return { status: HTTP_CONFLICT, body }
}

function invalidAnswer(id: string, message: string): FakeReply {
  const body: FormInvalidAnswerError = { _tag: "FormInvalidAnswerError", id, message }
  return { status: HTTP_BAD_REQUEST, body }
}

/** `{ message }` when the text is not empty, else nothing: a message the service would not keep. */
function messageOf(text: string | undefined): { message?: string } {
  return text ? { message: text } : {}
}

function isKind(field: FormField, value: unknown): boolean {
  switch (field.type) {
    case "string":
      return typeof value === "string"
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "integer":
      return Number.isInteger(value)
    case "boolean":
      return typeof value === "boolean"
    case "multiselect":
      return Array.isArray(value) && value.every((item) => typeof item === "string")
    case "external":
      return value === true
  }
}

/** Whether a value of the right kind lies outside the options of a field that does not take its own. */
function isOutsideOptions(field: FormField, value: unknown): boolean {
  if (field.type === "string" && field.options && !field.custom) {
    return !field.options.some((option) => option.value === value)
  }
  if (field.type === "multiselect" && !field.custom) {
    return (value as string[]).some((item) => !field.options.some((option) => option.value === item))
  }
  return false
}

/** What the service refuses an answer for, in its order: an unknown key, then per field the kind, the option and the missing value; `undefined` when it takes it. */
function answerError(form: FormInfo, answer: Record<string, JsonValue>): string | undefined {
  const unknown = Object.keys(answer).find((key) => !form.fields.some((field) => field.key === key))
  if (unknown !== undefined) return `Unknown form field: ${unknown}`
  for (const field of form.fields) {
    if (!Object.hasOwn(answer, field.key)) {
      if (field.type !== "external" && field.required) return `Missing required form field: ${field.key}`
      continue
    }
    const value = answer[field.key]
    if (!isKind(field, value)) {
      return field.type === "external"
        ? `External form field must be acknowledged: ${field.key}`
        : `Expected ${KIND_WORDS[field.type]} for form field: ${field.key}`
    }
    if (isOutsideOptions(field, value)) return `Invalid option for form field: ${field.key}`
  }
  return undefined
}

/** Answers a pending request; a rejection takes the others of its step with it, and one without a message ends the turn. */
function replyPermission(session: FakeSession, { params, body }: Call, stop: StopSession): FakeReply {
  const requestID = params[1]!
  const request = session.pending.find((candidate) => candidate.id === requestID)
  if (!request) return permissionNotFound(requestID)
  const { decision, message } = body as Pick<PermissionReplyInput, "decision" | "message">
  const kept = messageOf(message)
  const taken = [request]
  if (decision === "reject") {
    const step = request.source?.messageID
    taken.push(...session.pending.filter((other) => other !== request && other.source?.messageID === step))
  }
  session.pending = session.pending.filter((pending) => !taken.includes(pending))
  session.answers.push({ kind: "permission", id: request.id, decision, ...kept })
  for (const other of taken.slice(1)) {
    session.answers.push({ kind: "permission", id: other.id, decision, ...kept, along: true })
  }
  if (decision === "reject" && !message) stop(session.id)
  return NO_CONTENT
}

/** The form of the session with the id the path names, or the refusal for one it no longer holds or never had. */
function pendingForm(session: FakeSession, id: string): FormInfo | FakeReply {
  const form = session.forms.find((candidate) => candidate.id === id)
  if (form) return form
  return session.settled.includes(id) ? formSettled(id) : formNotFound(id)
}

function settle(session: FakeSession, form: FormInfo): void {
  session.forms = session.forms.filter((candidate) => candidate !== form)
  session.settled.push(form.id)
}

/** Answers a pending form when its answer passes the check, else refuses it and leaves the form pending. */
function replyForm(session: FakeSession, { params, body }: Call): FakeReply {
  const found = pendingForm(session, params[1]!)
  if ("status" in found) return found
  const { answer } = body as Pick<SessionFormReplyInput, "answer">
  const kept = answer as Record<string, JsonValue>
  const error = answerError(found, kept)
  if (error !== undefined) return invalidAnswer(found.id, error)
  settle(session, found)
  session.answers.push({ kind: "form", id: found.id, answer: kept })
  return NO_CONTENT
}

/** Cancels a pending form; one without a message ends the turn. */
function cancelForm(session: FakeSession, { params, query }: Call, stop: StopSession): FakeReply {
  const found = pendingForm(session, params[1]!)
  if ("status" in found) return found
  settle(session, found)
  session.answers.push({ kind: "cancel", id: found.id, ...messageOf(query.message) })
  if (!query.message) stop(session.id)
  return NO_CONTENT
}

/** The routes that answer a request or a form of a session, or cancel a form. */
export const ANSWER_ROUTES: TurnRoute[] = [
  ["POST", /^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/, replyPermission],
  ["POST", /^\/api\/session\/([^/]+)\/form\/([^/]+)\/reply$/, replyForm],
  ["DELETE", /^\/api\/session\/([^/]+)\/form\/([^/]+)$/, cancelForm],
]
