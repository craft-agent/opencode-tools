import type { Pending } from "./pending"
import { permissionOut, type Shown } from "./read.permission"
import { questionOut } from "./read.question"
import type { RequestOut } from "./read.schemas"

/** A request or a question as a result carries it. */
export function pendingOut(pending: Pending, shown: Shown): RequestOut {
  return pending.kind === "permission" ? permissionOut(pending, shown) : questionOut(pending)
}
