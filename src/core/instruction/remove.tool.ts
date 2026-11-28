import { DEFAULT_WAIT_SECONDS, WAIT_SECONDS_OPTION } from "../deadline"
import { ownedSession } from "../run/owned"
import { NOTE_KEY } from "../run/note"
import { withService } from "../service/connect"
import { defineTool } from "../tool"
import { entriesOfSession, valueText } from "./entries"
import { KEY_PREFIX, checkKey } from "./key"
import { removeEntry } from "./remove"
import { removeInput, removeOutput } from "./remove.schemas"

const DESCRIPTION =
  "Remove an instruction entry of an OpenCode run: a text its agent was told and kept under a key. " +
  "`session` is the id of a session a start returned, the run's own. " +
  `\`key\` is written whole as \`${KEY_PREFIX}<name>\`. ` +
  "The agent is told of the removal once, at its next step while the run's own session is running and at the head of its next turn otherwise; a fork made earlier keeps its own copy of the entry. " +
  "A key that is not there removes nothing and sends nothing, and is no error: `removed` is false. " +
  `A key that does not have the form of an entry of the package is refused as \`invalid_argument\` with the reason \`key\`, and \`${NOTE_KEY}\` is the operating note, which every start writes again: it is refused as \`forbidden\` with the reason \`reserved\`. ` +
  "A session that is not the caller's, one that does not exist, a person's own and a subagent's are not found. " +
  "A service without the entry routes fails as `upstream_error`. " +
  "`when` says when the run is told, and is present only when `removed`: `next_step` or `next_turn`. " +
  "`opencode_instruction_read` reads the entries, and `opencode_instruction_set` sets one. " +
  "The call starts the service when it is not running; `service_started` says when it did. " +
  `A call ends within the \`${WAIT_SECONDS_OPTION}\` setting of its start, ${DEFAULT_WAIT_SECONDS} seconds unless set.`

/** Removes an instruction entry from a run's session. */
export const opencodeInstructionRemove = defineTool({
  id: "opencode_instruction_remove",
  title: "Remove an instruction entry of an OpenCode run",
  intent: "About to remove an instruction entry",
  description: DESCRIPTION,
  toolset: "instruction",
  class: "overwrite",
  targets: (args, ctx) =>
    withService(ctx, async (service) => [(await ownedSession(service, args.session, ctx.caller)).session.directory]),
  async gate(args, ctx) {
    checkKey(args.key, "write")
    await withService(ctx, async (service) => void (await ownedSession(service, args.session, ctx.caller)))
  },
  describe: (args, ctx) =>
    withService(ctx, async (service) => {
      const { session } = await ownedSession(service, args.session, ctx.caller)
      const held = (await entriesOfSession(service, session.id)).find((entry) => entry.key === args.key)
      return {
        facts: [{ label: "Key", value: args.key }],
        ...(held !== undefined && { text: { label: "Value removed", body: valueText(held.value).text } }),
      }
    }),
  input: removeInput,
  output: removeOutput,
  execute: (args, ctx) => withService(ctx, (service) => removeEntry(service, args, ctx)),
})
