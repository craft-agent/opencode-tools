import { ownedSession } from "../run/owned"
import type { ServiceConnection } from "../service/connect"
import { idFits, listed } from "../service/listing"
import type { ToolContext } from "../tool"
import { pendingOf } from "./pending"
import { pendingOut } from "./read.out"
import {
  MAX_ENTRY_CHARS,
  MAX_LISTED_TEXT,
  MAX_REQUESTS_LISTED,
  type CallOf,
  type RequestOut,
  type RequestReadOutput,
} from "./read.schemas"

/** What an entry listed in brief keeps: who asked, what it asks and why it can only be rejected or declined. */
const BRIEF_KEYS = [
  "kind",
  "id",
  "session",
  "subagent",
  "agent",
  "action",
  "tool",
  "step",
  "title",
  "reject_only",
  "decline_only",
] as const satisfies readonly (keyof RequestOut)[]

/** The entry as it is listed: whole, or, when it takes more than `MAX_ENTRY_CHARS` as JSON, in brief. */
function entryOf(entry: RequestOut): RequestOut {
  if (JSON.stringify(entry).length <= MAX_ENTRY_CHARS) return entry
  return {
    ...Object.fromEntries(BRIEF_KEYS.filter((key) => key in entry).map((key) => [key, entry[key]])),
    brief: true,
  } as RequestOut
}

/** Method `list`: what the run is paused on, the run's own session's first, each with its text whole where it fits. */
export async function readList(
  checked: CallOf<"list">,
  service: ServiceConnection,
  ctx: ToolContext,
): Promise<RequestReadOutput> {
  const { session } = await ownedSession(service, checked.session, ctx.caller)
  const pending = await pendingOf(service, session, ctx)
  // An id is never cut, so a request whose id or session does not fit is left out.
  const usable = pending.filter((request) => idFits(request.id) && idFits(request.session))
  const entries = usable
    .slice(0, MAX_REQUESTS_LISTED)
    .map((request) => entryOf(pendingOut(request, { textLimit: MAX_LISTED_TEXT })))
  const { kept } = listed(entries)
  return {
    method: "list",
    service_started: service.started,
    session: session.id,
    requests: kept,
    total: pending.length,
    truncated: kept.length < pending.length,
  }
}
