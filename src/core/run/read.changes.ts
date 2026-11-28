import type { ServiceConnection } from "../service/connect"
import { diffOf } from "../service/reply.run"
import type { ToolContext } from "../tool"
import { ownedSession } from "./owned"
import {
  MAX_CHANGED_FILES,
  MAX_FILE_NAME,
  MAX_PATCH_CHARACTERS,
  NO_CONTEXT,
  PATCH_CONTEXT,
  type CallOf,
  type RunReadOutput,
} from "./read.schemas"
import { lineOf, multilineOf } from "./read.text"

type FileOutput = NonNullable<RunReadOutput["files"]>[number]

/**
 * Method `changes`: the files the session's newest turn changed. With
 * `patches`, each file's patch while the budget for the whole result lasts;
 * the first patch that does not fit is left out, and so is every one after it,
 * so that what is kept is a prefix, as in a list.
 */
export async function readChanges(
  checked: CallOf<"changes">,
  service: ServiceConnection,
  ctx: ToolContext,
): Promise<RunReadOutput> {
  const { session } = await ownedSession(service, checked.session, ctx.caller)
  const changed = diffOf(
    await service.client.session.diff({
      sessionID: session.id,
      context: checked.patches ? PATCH_CONTEXT : NO_CONTEXT,
    }),
  )
  let budget = MAX_PATCH_CHARACTERS
  let exhausted = false
  const files = changed.slice(0, MAX_CHANGED_FILES).map((change): FileOutput => {
    const file = {
      file: lineOf(change.file, MAX_FILE_NAME),
      status: change.status,
      additions: change.additions,
      deletions: change.deletions,
    }
    if (!checked.patches) return file
    const patch = multilineOf(change.patch)
    if (!exhausted && patch.length <= budget) {
      budget -= patch.length
      return { ...file, patch }
    }
    exhausted = true
    return { ...file, patch_omitted: true }
  })
  return {
    method: "changes",
    service_started: service.started,
    files,
    total: changed.length,
    truncated: changed.length > files.length || exhausted,
  }
}
