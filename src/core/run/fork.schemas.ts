import { z } from "zod"
import { MAX_ID } from "../service/schemas"

/** The arguments of `opencode_run_fork`. */
export const forkInput = z.object({
  session: z.string().min(1).max(MAX_ID).describe("The id of an idle session a start returned."),
})

/** The result of `opencode_run_fork`. */
export const forkOutput = z.object({
  service_started: z.boolean().describe("True when this call found no service running and started one."),
  session: z.string().describe("The copy's session."),
  forked_from: z.string().describe("The session that was copied, which stays as it was."),
  role: z.string().describe("The role the source started under, which the copy is bound to."),
  title: z.string().optional().describe("The copy's title."),
  directory: z.string().describe("The copy's directory: the source's, the top level of its worktree."),
  branch: z.string().nullable().describe("The worktree's branch; null on a detached HEAD."),
})

/** The arguments of a call of `opencode_run_fork`. */
export type ForkInput = z.output<typeof forkInput>
/** The result of a call of `opencode_run_fork`. */
export type ForkOutput = z.input<typeof forkOutput>
