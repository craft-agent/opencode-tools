import { ToolError } from "../errors"
import { shown } from "../text"
import type { Pending, PendingPermission, PendingQuestion } from "./pending"
import { answerProblem } from "./reply.answer"
import type { Answer, ReplyDecision, ReplyInput } from "./reply.schemas"
import { MAX_APPROVAL_TEXT } from "./text"
import { REJECT_ONLY_WORDS } from "./verdict"

/** The characters between two approvals' texts in a prompt: a blank line. */
const TEXT_GAP = 2

/** The properties of a reply that its decision takes none of, in the order they are checked. */
const FOREIGN: Record<ReplyDecision, readonly ("text" | "reason" | "answer")[]> = {
  once: ["reason", "answer"],
  reject: ["text", "answer"],
  answer: ["text", "reason"],
}

/** A reply resolved against what is pending: the request it names, and what it carries, the reason trimmed. */
export type PlannedReply =
  | { decision: "once"; pending: PendingPermission }
  | { decision: "reject"; pending: Pending; reason: string }
  | { decision: "answer"; pending: PendingQuestion; answer: Answer }

/** Every reply of a call that passed its checks, in the order given. */
export type Plan = readonly PlannedReply[]

function invalid(message: string, reason?: string): ToolError {
  return new ToolError("invalid_argument", message, reason === undefined ? undefined : { details: { reason } })
}

function forbidden(message: string, reason: string): ToolError {
  return new ToolError("forbidden", message, { details: { reason } })
}

/** The checks of an approval of `request`. */
function approval(reply: ReplyInput, request: PendingPermission): PlannedReply {
  const id = shown(reply.request)
  if (reply.text === undefined) {
    throw invalid(`An approval of request ${id} repeats its \`text\`, as the read gave it.`)
  }
  if (request.rejectOnly !== undefined) {
    throw forbidden(`Request ${id} can only be rejected: ${REJECT_ONLY_WORDS[request.rejectOnly]}`, "reject_only")
  }
  if (reply.text !== request.text) {
    throw invalid(
      `The \`text\` given for request ${id} is not the request's. Read it again and repeat it exactly.`,
      "text_mismatch",
    )
  }
  return { decision: "once", pending: request }
}

/** The checks of a rejection of `request`, or the declining of a question: it carries a reason, and is never refused for what the request can only be. */
function rejection(reply: ReplyInput, request: Pending): PlannedReply {
  const reason = reply.reason?.trim() ?? ""
  if (reason === "") {
    throw invalid(
      `A rejection of request ${shown(reply.request)} carries a \`reason\`: without one the service ends the run's turn.`,
    )
  }
  return { decision: "reject", pending: request, reason }
}

/** The checks of an answer to `question`. */
function answering(reply: ReplyInput, question: PendingQuestion): PlannedReply {
  const id = shown(reply.request)
  const { answer } = reply
  if (answer === undefined || Object.keys(answer).length === 0) {
    throw invalid(`An answer to question ${id} gives a value for at least one field.`)
  }
  if (question.declineOnly !== undefined) {
    throw forbidden(`Question ${id} can only be declined: ${question.declineOnly}`, "decline_only")
  }
  const problem = answerProblem(question.fields, answer)
  if (problem !== undefined) {
    throw invalid(`The answer to question ${id} does not fit its fields: ${problem}`, "answer")
  }
  return { decision: "answer", pending: question, answer }
}

/** One reply resolved against the request it names, after the checks of its kind, its properties, what it must carry and what the request allows, in that order. */
function planned(reply: ReplyInput, request: Pending): PlannedReply {
  const id = shown(reply.request)
  const { decision } = reply
  if (request.kind === "question" && decision === "once") {
    throw invalid(`Request ${id} is a question: answer it with \`answer\`, or decline it with \`reject\`.`)
  }
  if (request.kind === "permission" && decision === "answer") {
    throw invalid(`Request ${id} is a permission request: answer it \`once\` or \`reject\`.`)
  }
  const foreign = FOREIGN[decision].find((property) => reply[property] !== undefined)
  if (foreign !== undefined) throw invalid(`A reply that says \`${decision}\` takes no \`${foreign}\`.`)
  if (decision === "reject") return rejection(reply, request)
  return request.kind === "question" ? answering(reply, request) : approval(reply, request)
}

/** The code points the approvals of a plan show together in a prompt: their texts, with a blank line between two. */
function approvalLength(plan: Plan): number {
  const texts = plan.flatMap((reply) => (reply.decision === "once" ? [reply.pending.text] : []))
  return texts.reduce((total, text) => total + [...text].length, 0) + Math.max(0, texts.length - 1) * TEXT_GAP
}

/** The replies in the order they are sent: every approval and answer as given, then every rejection as given, since a rejection takes its step with it. */
export function inSendingOrder(plan: Plan): PlannedReply[] {
  return [
    ...plan.filter((reply) => reply.decision !== "reject"),
    ...plan.filter((reply) => reply.decision === "reject"),
  ]
}

/**
 * Checks every reply of a call against what the run is paused on and resolves
 * it, throwing the first problem as a `ToolError`: replies in the order given,
 * all the checks of one before the next reply's. Then the approvals' texts are
 * checked together against what one prompt shows.
 */
export function planReplies(replies: readonly ReplyInput[], pending: readonly Pending[]): Plan {
  const named = new Set<string>()
  const plan = replies.map((reply) => {
    if (named.has(reply.request)) {
      throw invalid(`Request ${shown(reply.request)} is named twice; a request is answered once.`)
    }
    named.add(reply.request)
    const request = pending.find((candidate) => candidate.id === reply.request)
    if (request === undefined) {
      throw new ToolError("not_found", `Request ${shown(reply.request)} is not pending in this run.`)
    }
    return planned(reply, request)
  })
  const length = approvalLength(plan)
  if (length > MAX_APPROVAL_TEXT) {
    throw invalid(
      `The approvals of this call hold ${length} characters of text together, and a prompt shows ${MAX_APPROVAL_TEXT}. Answer them in separate calls.`,
    )
  }
  return plan
}
