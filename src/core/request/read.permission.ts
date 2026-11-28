import { patchBudget } from "../run/read.changes"
import { blockOf } from "../run/read.text"
import { MAX_ID, MAX_NAME } from "../service/schemas"
import type { PendingPermission } from "./pending"
import { MAX_FILES_LISTED, MAX_LONG_LINE, MAX_RESOURCES_LISTED, MAX_SHORT_LINE, type RequestOut } from "./read.schemas"
import { lineFor, shortLine } from "./read.text"
import { REJECT_ONLY_WORDS } from "./verdict"

/** How much of a request a result shows: the code points of its text, and the budget of its patches when it shows them. */
export type Shown = { textLimit: number; patches?: ReturnType<typeof patchBudget> }

/** The files a request would change, as a result lists them: the first `MAX_FILES_LISTED`, with their patches when `shown` has a budget for them. */
function filesOut(
  files: NonNullable<PendingPermission["files"]>,
  shown: Shown,
): Pick<RequestOut, "files" | "files_total"> {
  const listed = files.slice(0, MAX_FILES_LISTED).map((file) => ({
    file: shortLine(file.file, MAX_LONG_LINE),
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    ...shown.patches?.take(file.patch),
  }))
  return { files: listed, ...(files.length > listed.length && { files_total: files.length }) }
}

/** A permission request as a result lists it: its texts cleaned to what a result may carry, and cut where the limits say. */
export function permissionOut(request: PendingPermission, shown: Shown): RequestOut {
  const { text, cut } = blockOf(request.text, shown.textLimit)
  const resources = request.resources.slice(0, MAX_RESOURCES_LISTED)
  return {
    kind: "permission",
    id: request.id,
    session: request.session,
    ...(request.subagent && { subagent: true as const }),
    ...lineFor("agent", request.agent, MAX_NAME),
    action: shortLine(request.action, MAX_NAME),
    resources: resources.map((resource) => shortLine(resource, MAX_LONG_LINE)),
    ...(request.resources.length > resources.length && { resources_total: request.resources.length }),
    ...lineFor("tool", request.tool, MAX_NAME),
    ...lineFor("step", request.step, MAX_ID),
    text,
    ...(cut && { text_truncated: true as const }),
    ...lineFor("message", request.message, MAX_SHORT_LINE),
    ...(request.files !== undefined && filesOut(request.files, shown)),
    ...(request.rejectOnly !== undefined && { reject_only: REJECT_ONLY_WORDS[request.rejectOnly] }),
  }
}
