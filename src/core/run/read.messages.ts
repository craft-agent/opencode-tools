import type { ServiceConnection } from "../service/connect"
import { listed } from "../service/listing"
import { messagesOf, type MessageEntry } from "../service/reply.run"
import type { ToolContext } from "../tool"
import { ownedSession } from "./owned"
import { MAX_MESSAGE_TEXT, MAX_MESSAGE_TOOLS, MAX_RUN_NAME, type CallOf, type RunReadOutput } from "./read.schemas"
import { blockOf, errorOf, lineOf } from "./read.text"

type MessageOutput = NonNullable<RunReadOutput["messages"]>[number]

/** A message as a result carries it: only the fields its type has, texts cleaned and cut. */
function messageOf(entry: MessageEntry): MessageOutput {
  const text = entry.text === undefined ? undefined : blockOf(entry.text, MAX_MESSAGE_TEXT)
  return {
    type: lineOf(entry.type, MAX_RUN_NAME),
    time: entry.created,
    ...(text !== undefined && { text: text.text, ...(text.cut && { truncated: true }) }),
    ...(entry.tools !== undefined && {
      tools: entry.tools.slice(0, MAX_MESSAGE_TOOLS).map((tool) => ({
        name: lineOf(tool.name, MAX_RUN_NAME),
        status: lineOf(tool.status, MAX_RUN_NAME),
      })),
    }),
    ...(entry.error !== undefined && { error: errorOf(entry.error) }),
    ...(entry.outcome !== undefined && { outcome: entry.outcome }),
    ...(entry.agent !== undefined && { agent: lineOf(entry.agent, MAX_RUN_NAME) }),
  }
}

/** Method `messages`: the session's newest messages, newest first, kept to the size of a list. */
export async function readMessages(
  checked: CallOf<"messages">,
  service: ServiceConnection,
  ctx: ToolContext,
): Promise<RunReadOutput> {
  const { session } = await ownedSession(service, checked.session, ctx.caller)
  const entries = messagesOf(
    await service.client.message.list({ sessionID: session.id, limit: checked.limit, order: "desc" }),
  )
  const { kept, truncated } = listed(entries.map(messageOf))
  return { method: "messages", service_started: service.started, messages: kept, total: entries.length, truncated }
}
