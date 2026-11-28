import { z } from "zod"
import { runStateOutput } from "../run/read.schemas"
import { MAX_ID } from "../service/schemas"

/** The most replies one call gives. */
export const MAX_REPLIES = 10
/** The most characters of the reason of a rejection. */
export const MAX_REASON = 2000

/** What a reply says: approve a permission request once, reject a request or decline a question, answer a question. */
export const REPLY_DECISIONS = ["once", "reject", "answer"] as const
/** What became of one reply: sent, no longer pending when it arrived, refused by the service, or not sent after an earlier send failed. */
export const REPLY_OUTCOMES = ["sent", "gone", "failed", "not_sent"] as const

/** What `decision` of one reply says. */
export type ReplyDecision = (typeof REPLY_DECISIONS)[number]
/** What became of one reply. */
export type ReplyOutcome = (typeof REPLY_OUTCOMES)[number]

const answerValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])

const replyInput = z.strictObject({
  request: z
    .string()
    .min(1)
    .max(MAX_ID)
    .describe("The id of a permission request or a question `opencode_request_read` listed."),
  decision: z
    .enum(REPLY_DECISIONS)
    .describe(
      "`once` approves a permission request once, `reject` rejects it or declines a question, `answer` answers a question.",
    ),
  text: z
    .string()
    .optional()
    .describe("Decision `once`, required there: the request's `text`, exactly as `opencode_request_read` gave it."),
  reason: z
    .string()
    .max(MAX_REASON)
    .optional()
    .describe(`Decision \`reject\`, required there and not blank: why, which the run reads. At most ${MAX_REASON}.`),
  answer: z
    .record(z.string(), answerValue)
    .optional()
    .describe(
      "Decision `answer`, required there: a value for at least one field of the question, by the field's `key`, each as the field's `kind` takes it.",
    ),
})

/** The arguments of `opencode_request_reply`. */
export const requestReplyInput = z.object({
  session: z.string().min(1).max(MAX_ID).describe("The id of a session a start returned."),
  replies: z
    .array(replyInput)
    .min(1)
    .max(MAX_REPLIES)
    .describe(`1 to ${MAX_REPLIES} replies, each to a request of the run named once.`),
})

const replyOutput = z.object({
  request: z.string(),
  decision: z.enum(REPLY_DECISIONS),
  outcome: z
    .enum(REPLY_OUTCOMES)
    .describe(
      "`sent`; `gone` (no longer pending when the reply arrived); `failed` (the service refused it, see `error`); `not_sent` (an earlier send failed).",
    ),
  error: z
    .object({ code: z.string(), message: z.string() })
    .optional()
    .describe("Outcome `failed`: the error code and message."),
})

/** The result of `opencode_request_reply`. */
export const requestReplyOutput = z.object({
  service_started: z.boolean().describe("True when this call found no service running and started one."),
  session: z.string().describe("The run's session."),
  replies: z.array(replyOutput).describe("Each reply of the call, in the order given."),
  also_rejected: z
    .array(z.string())
    .optional()
    .describe("The ids of the other requests the rejections of this call took along, which the call did not name."),
  run: runStateOutput
    .optional()
    .describe(
      "The run after the replies, as `opencode_run_read` method `get` gives it. Present unless `run_error` is: exactly one of the two.",
    ),
  run_error: z
    .object({ code: z.string(), message: z.string() })
    .optional()
    .describe(
      "Present, instead of `run`, when the run could not be read after the replies were sent: the error code and message. `opencode_run_read` reads the run.",
    ),
})

/** The arguments of a call of `opencode_request_reply`. */
export type RequestReplyInput = z.output<typeof requestReplyInput>
/** One reply of a call. */
export type ReplyInput = RequestReplyInput["replies"][number]
/** The result of a call of `opencode_request_reply`. */
export type RequestReplyOutput = z.input<typeof requestReplyOutput>
/** What became of one reply of a call. */
export type ReplyResult = RequestReplyOutput["replies"][number]
/** An answer to a question: a value by the key of a field. */
export type Answer = NonNullable<ReplyInput["answer"]>
