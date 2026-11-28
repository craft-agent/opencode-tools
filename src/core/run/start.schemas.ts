import { z } from "zod"
import { MAX_ID, MAX_ROLE_NAME } from "../service/schemas"

/** The most characters of a brief. */
export const MAX_BRIEF = 100_000

/** What a start reports of the brief: taken, or not confirmed either way. */
export const START_STATES = ["running", "unknown"] as const
/** Where the operating note went: an instruction entry of the session, or the head of the brief. */
export const NOTE_PLACES = ["entry", "prompt"] as const

/** The state a start reports. */
export type StartState = (typeof START_STATES)[number]
/** Where a start put the operating note. */
export type NotePlace = (typeof NOTE_PLACES)[number]

/** The arguments of both start tools. */
export const startInput = z.object({
  role: z
    .string()
    .min(1)
    .max(MAX_ROLE_NAME)
    .describe("The name of a configured role, as `opencode_service_read` method `status` lists it."),
  brief: z
    .string()
    .min(1)
    .max(MAX_BRIEF)
    .describe(`The message that starts or continues the run: 1 to ${MAX_BRIEF} characters, not blank.`),
  directory: z
    .string()
    .optional()
    .describe(
      "A new session: the absolute path of the top level of a Git worktree; left out, the call's working directory. Not with `session`.",
    ),
  session: z
    .string()
    .min(1)
    .max(MAX_ID)
    .optional()
    .describe("The id of a session an earlier start returned, to continue it. Not with `directory`."),
  fork: z
    .boolean()
    .optional()
    .describe("With `session`: start on a copy of that session instead of continuing it; the session stays as it was."),
})

/** The result of both start tools. */
export const startOutput = z.object({
  session: z.string().describe("The run's session: the copy, for a start on a fork."),
  new: z
    .boolean()
    .describe("True for a session this call created, a copy of another included, false for one it continued."),
  forked_from: z.string().optional().describe("A start on a fork: the session that was copied, which stays as it was."),
  role: z.string(),
  agent: z.string().describe("The OpenCode agent the role runs."),
  policy: z.enum(["read-only", "write"]),
  model: z.string().describe("The model written `<provider>/<model>`, with `#<variant>` when it has a variant."),
  directory: z.string().describe("The session's directory, the top level of its worktree."),
  branch: z.string().nullable().describe("The worktree's branch; null on a detached HEAD."),
  state: z
    .enum(START_STATES)
    .describe(
      "`running` once the brief is admitted; `unknown` when its admission could not be confirmed: the brief may have been taken.",
    ),
  note: z
    .enum(NOTE_PLACES)
    .describe("Where the operating note went: `entry` an instruction entry, `prompt` the head of the brief."),
  service_started: z.boolean().describe("True when this call found no service running and started one."),
  message: z.string().optional().describe("State `unknown`: what to do."),
})

/** The arguments of a start. */
export type StartInput = z.output<typeof startInput>
/** The result of a start. */
export type StartOutput = z.input<typeof startOutput>
