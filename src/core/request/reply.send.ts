import { isAbortError, isToolError } from "../errors"
import type { ServiceConnection } from "../service/connect"
import type { ToolContext } from "../tool"
import { inSendingOrder, type Plan, type PlannedReply } from "./reply.plan"
import type { ReplyOutcome, ReplyResult } from "./reply.schemas"

/** The codes of a refusal that say the request was no longer pending when its reply arrived. */
const GONE_CODES = ["not_found", "stale"]

/** Sends one reply to the session that asked. */
async function sendOne(service: ServiceConnection, reply: PlannedReply): Promise<void> {
  const { client } = service
  const { id, session: sessionID } = reply.pending
  if (reply.decision === "once") {
    await client.permission.reply({ sessionID, requestID: id, decision: "once" })
  } else if (reply.decision === "answer") {
    await client.session.form.reply({ sessionID, formID: id, answer: reply.answer })
  } else if (reply.pending.kind === "permission") {
    await client.permission.reply({ sessionID, requestID: id, decision: "reject", message: reply.reason })
  } else {
    await client.session.form.cancel({ sessionID, formID: id, message: reply.reason })
  }
}

function resultOf(reply: PlannedReply, outcome: ReplyOutcome, error?: { code: string; message: string }): ReplyResult {
  return { request: reply.pending.id, decision: reply.decision, outcome, ...(error !== undefined && { error }) }
}

/**
 * Sends the replies of a plan, approvals and answers first and rejections
 * after, each in the order given, and says what became of each, in the order
 * given. A request the service no longer has is `gone`. After a send that fails
 * no later reply is sent, and that failure is the call's own error when it was
 * the first send attempted. A cancellation is rethrown, never an outcome.
 */
export async function sendReplies(
  service: ServiceConnection,
  plan: Plan,
  ctx: Pick<ToolContext, "signal">,
): Promise<ReplyResult[]> {
  const results = new Map<PlannedReply, ReplyResult>()
  let attempted = 0
  let failed = false
  for (const reply of inSendingOrder(plan)) {
    if (failed) {
      results.set(reply, resultOf(reply, "not_sent"))
      continue
    }
    try {
      await sendOne(service, reply)
      results.set(reply, resultOf(reply, "sent"))
    } catch (error) {
      if (isAbortError(error) || ctx.signal?.aborted || !isToolError(error)) throw error
      if (GONE_CODES.includes(error.code)) {
        results.set(reply, resultOf(reply, "gone"))
      } else if (attempted === 0) {
        throw error
      } else {
        results.set(reply, resultOf(reply, "failed", { code: error.code, message: error.message }))
        failed = true
      }
    }
    attempted += 1
  }
  return plan.map((reply) => results.get(reply)!)
}
