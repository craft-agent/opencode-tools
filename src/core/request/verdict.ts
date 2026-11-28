import { lastEffect, matches } from "../run/match"
import { ACTION, ANY_RESOURCE } from "../run/patterns"
import type { Rule } from "../run/rule"
import type { FieldEntry } from "../service/reply.request"
import { MAX_APPROVAL_TEXT, isRepeatable, isShowable } from "./text"

/** Why a request can only be rejected. */
export type RejectOnly = "never_approve" | "subagent_ask" | "unshowable" | "too_long"

/** What a result says of each reason a request can only be rejected. */
export const REJECT_ONLY_WORDS: Record<RejectOnly, string> = {
  never_approve: "The `never_approve` setting holds its action.",
  subagent_ask: "A subagent asked for what the run's own rules ask about.",
  unshowable: "Its text holds characters that cannot be shown as they are.",
  too_long: `Its text is over ${MAX_APPROVAL_TEXT} characters, more than an approval can show.`,
}

/** What a result says of a question with a link to visit, which can only be declined. */
export const DECLINE_ONLY_LINK = "It has a link to visit, which no tool has visited."
/** What a result says of a question with a field of an unknown kind, which can only be declined. */
export const DECLINE_ONLY_KIND = "It has a field of a kind these tools do not know."

const FIELD_KINDS = ["string", "number", "integer", "boolean", "multiselect"]
const LINK_KIND = "external"

/** A permission request as the verdict reads it: what it asks, the text an approval would repeat and whether a subagent asked. */
export type VerdictRequest = { action: string; resources: readonly string[]; text: string; subagent: boolean }

/** What the verdict reads besides the request: the `never_approve` patterns and the run's own session's rules. */
export type VerdictContext = { neverApprove: readonly string[]; rules: readonly Rule[] }

/** The first reason `request` can only be rejected, in this order: the setting, a subagent's ask, a text that cannot be shown, a text too long; `undefined` when it can be approved. */
export function rejectOnlyOf(request: VerdictRequest, context: VerdictContext): RejectOnly | undefined {
  if (context.neverApprove.some((pattern) => matches(pattern, request.action))) return "never_approve"
  if (request.subagent && request.action !== ACTION.externalDirectory) {
    const resources = request.resources.length === 0 ? [ANY_RESOURCE] : request.resources
    if (resources.some((resource) => lastEffect(context.rules, request.action, resource) === "ask")) {
      return "subagent_ask"
    }
  }
  if (!isShowable(request.text)) return "unshowable"
  if ([...request.text].length > MAX_APPROVAL_TEXT) return "too_long"
  return undefined
}

/**
 * Why a question can only be declined: a link to visit, else a field these
 * tools cannot answer, of a kind they do not know or whose key an answer could
 * not repeat; `undefined` when it can be answered.
 */
export function declineOnlyOf(fields: readonly Pick<FieldEntry, "key" | "type">[]): string | undefined {
  if (fields.some((field) => field.type === LINK_KIND)) return DECLINE_ONLY_LINK
  if (fields.some((field) => !FIELD_KINDS.includes(field.type) || !isRepeatable(field.key))) return DECLINE_ONLY_KIND
  return undefined
}
