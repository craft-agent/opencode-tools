import type { Pending } from "./pending"
import type { Plan } from "./reply.plan"
import type { ReplyResult } from "./reply.schemas"

/** The step a request belongs to: its session and the message that holds its call; requests with no message of one session share a step. */
function stepOf(request: Pending): string | undefined {
  return request.kind === "permission" ? JSON.stringify([request.session, request.step ?? null]) : undefined
}

/**
 * The permission requests the rejections of a call took along: those that were
 * pending before the replies, that the call did not name, that share a step
 * with a rejection that was sent, and that the first look after the replies no
 * longer found pending. `results` are the plan's, in the same order.
 */
export function alsoRejectedOf(
  plan: Plan,
  results: readonly ReplyResult[],
  before: readonly Pending[],
  firstPending: ReadonlySet<string>,
): string[] {
  const named = new Set(plan.map((reply) => reply.pending.id))
  const rejected = new Set(
    plan.flatMap((reply, index) =>
      reply.decision === "reject" && results[index]?.outcome === "sent" ? [stepOf(reply.pending)] : [],
    ),
  )
  return before
    .filter((request) => {
      const step = stepOf(request)
      return step !== undefined && rejected.has(step) && !named.has(request.id) && !firstPending.has(request.id)
    })
    .map((request) => request.id)
}
