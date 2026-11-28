import type { Binding } from "../run/binding"
import { UNSAFE_CHARACTERS } from "../text"
import type { CallDescription, CallFact, CallMeasure } from "../tool"
import { inSendingOrder, type Plan } from "./reply.plan"
import type { Answer } from "./reply.schemas"

/** The bound on how many approvals a call gives. */
export const APPROVALS_BOUND = "approvals"

const TEXT_LABEL = "Replies"
const BLOCK_SEPARATOR = "\n\n"

/** A text of a call on one line: whatever moves or reorders text becomes a space. */
function oneLine(text: string): string {
  return text.replace(UNSAFE_CHARACTERS, " ").trim()
}

function answerText(answer: Answer): string {
  return Object.entries(answer)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join("; ")
}

/** The approvals of the plan in the order they are sent. */
function approvalsOf(plan: Plan) {
  return inSendingOrder(plan).flatMap((reply) => (reply.decision === "once" ? [reply.pending] : []))
}

/**
 * What the call does, for the person approving it: the run's role, the
 * actions approved and how many requests are rejected and answered; the text
 * is the approvals' own texts, whole, then a line for each rejection and each
 * answer. The approvals come first so that a prompt shows them whole.
 */
export function describeReplies(plan: Plan, binding: Binding): CallDescription {
  const approvals = approvalsOf(plan)
  const rejections = plan.flatMap((reply) =>
    reply.decision === "reject"
      ? [
          `Reject ${oneLine(reply.pending.kind === "permission" ? reply.pending.action : reply.pending.title)}: ${oneLine(reply.reason)}`,
        ]
      : [],
  )
  const answers = plan.flatMap((reply) =>
    reply.decision === "answer" ? [`Answer ${oneLine(reply.pending.title)}: ${oneLine(answerText(reply.answer))}`] : [],
  )

  const facts: CallFact[] = [{ label: "Role", value: binding.role }]
  if (approvals.length > 0) facts.push({ label: "Approves", value: approvals.map(({ action }) => action).join(", ") })
  if (rejections.length > 0) facts.push({ label: "Rejects", value: String(rejections.length) })
  if (answers.length > 0) facts.push({ label: "Answers", value: String(answers.length) })

  const blocks = [approvals.map(({ text }) => text).join(BLOCK_SEPARATOR), [...rejections, ...answers].join("\n")]
  return { facts, text: { label: TEXT_LABEL, body: blocks.filter((block) => block !== "").join(BLOCK_SEPARATOR) } }
}

/** What a grant can bound of the call: how many approvals it gives. */
export function measureReplies(plan: Plan): CallMeasure {
  return { [APPROVALS_BOUND]: approvalsOf(plan).length }
}
