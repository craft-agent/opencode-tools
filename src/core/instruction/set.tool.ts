import { DEFAULT_WAIT_SECONDS, WAIT_SECONDS_OPTION } from "../deadline"
import { ownedSession } from "../run/owned"
import { NOTE_KEY } from "../run/note"
import { withService } from "../service/connect"
import { defineTool } from "../tool"
import { entriesOfSession } from "./entries"
import { KEY_PREFIX, MAX_ENTRY_NAME } from "./key"
import { MAX_ENTRIES, MAX_ENTRY_VALUE } from "./limits"
import { checkSet, requireRoom, setEntry } from "./set"
import { setInput, setOutput } from "./set.schemas"

const DESCRIPTION =
  "Set an instruction entry of an OpenCode run: a text its agent is told, kept under a key. " +
  "`session` is the id of a session a start returned, the run's own. " +
  `\`key\` is written whole as \`${KEY_PREFIX}<name>\`, the name of 1 to ${MAX_ENTRY_NAME} lower-case letters, digits, \`_\` and \`-\`. ` +
  `\`value\` is the text, 1 to ${MAX_ENTRY_VALUE} characters, not blank. ` +
  "The run reads the key beside the value, so a key that names what the entry is for helps it. " +
  "An entry is told to the run once, at its next step while its session is running and at the head of its next turn otherwise, and is kept for every later turn and for a fork of the session. A subagent's session holds none, so a subagent is not told: what an entry says reaches it only through its parent. " +
  "A key that holds another value is replaced; one that holds this text sends nothing, and the agent is told nothing. " +
  `A session holds at most ${MAX_ENTRIES} entries of the package, the operating note counted: a new key beyond that is refused as \`invalid_argument\` with the reason \`too_many\`; replacing one is allowed. ` +
  `A key that does not have the form above is refused as \`invalid_argument\` with the reason \`key\`, and a blank value as \`invalid_argument\`. \`${NOTE_KEY}\` is the operating note, which every start writes again: it is refused as \`forbidden\` with the reason \`reserved\`. ` +
  "A session that is not the caller's, one that does not exist, a person's own and a subagent's are not found. " +
  "A service without the entry routes fails as `upstream_error`. " +
  "`changed` is false when nothing was sent, and `replaced` is true when the key held another value. `when` says when the run is told, and is present only when `changed`: `next_step` or `next_turn`. " +
  "`opencode_instruction_read` reads the entries, and `opencode_instruction_remove` removes one. " +
  "The call starts the service when it is not running; `service_started` says when it did. " +
  `A call ends within the \`${WAIT_SECONDS_OPTION}\` setting of its start, ${DEFAULT_WAIT_SECONDS} seconds unless set.`

/** Sets an instruction entry on a run's session: puts a text the agent is told once and keeps. */
export const opencodeInstructionSet = defineTool({
  id: "opencode_instruction_set",
  title: "Set an instruction entry of an OpenCode run",
  intent: "About to set an instruction entry",
  description: DESCRIPTION,
  toolset: "instruction",
  class: "overwrite",
  targets: (args, ctx) =>
    withService(ctx, async (service) => [(await ownedSession(service, args.session, ctx.caller)).session.directory]),
  async gate(args, ctx) {
    checkSet(args)
    await withService(ctx, async (service) => {
      const { session } = await ownedSession(service, args.session, ctx.caller)
      requireRoom(await entriesOfSession(service, session.id), args.key)
    })
  },
  describe: (args, ctx) =>
    withService(ctx, async (service) => {
      const { session } = await ownedSession(service, args.session, ctx.caller)
      const replaces = (await entriesOfSession(service, session.id)).some((entry) => entry.key === args.key)
      return {
        facts: [
          { label: "Replaces", value: replaces ? "yes" : "no" },
          { label: "Key", value: args.key },
        ],
        text: { label: "Value", body: args.value },
      }
    }),
  bounds: { value_length: { kind: "max", description: "The most characters of the value." } },
  measure: (args) => ({ value_length: [...args.value].length }),
  input: setInput,
  output: setOutput,
  execute: (args, ctx) => withService(ctx, (service) => setEntry(service, args, ctx)),
})
