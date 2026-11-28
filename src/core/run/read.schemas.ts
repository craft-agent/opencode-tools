import { z } from "zod"
import { MAX_ID } from "../service/schemas"
import { RUN_STATES } from "./state"

/** The methods of `opencode_run_read`, in the order the schema lists them; a method is added here, in `read.arguments.ts`, in `CheckedCall` and in the dispatch of `read.tool.ts`. */
export const RUN_READ_METHODS = ["list", "get", "wait", "messages", "changes"] as const

/** One method of `opencode_run_read`. */
export type RunReadMethod = (typeof RUN_READ_METHODS)[number]

/** The most runs of a list `list` asks the service for at a time. */
export const LIST_PAGE_SIZE = 100
/** The most pages `list` follows: a person's service may hold far more sessions than a list can show. */
export const MAX_LIST_PAGES = 5
/** The most code points of a title, an agent, a model or a tool's name a result keeps. */
export const MAX_RUN_NAME = 100
/** The most code points of a file's name a result keeps: longer than a name, since it is a path. */
export const MAX_FILE_NAME = 200
/** The most messages of a turn `get` reads to find its reply. */
export const RESULT_PAGE = 100
/** The most code points of a result a run's reply keeps. */
export const MAX_RESULT = 20_000
/** The most requests `waiting_on` lists. */
export const MAX_WAITING_ON = 10
/** The most code points of an action, a resource or a question's title `waiting_on` keeps. */
export const MAX_WAITING_TEXT = 200
/** The most resources of a permission request `waiting_on` lists. */
export const MAX_RESOURCES = 10
/** The messages `messages` returns when `limit` is not given. */
export const DEFAULT_MESSAGES = 20
/** The most messages `messages` returns. */
export const MAX_MESSAGES = 50
/** The most code points of a message's text a result keeps. */
export const MAX_MESSAGE_TEXT = 3000
/** The most tool parts of a message a result lists. */
export const MAX_MESSAGE_TOOLS = 20
/** The most files `changes` lists. */
export const MAX_CHANGED_FILES = 200
/** The most characters of patches one `changes` result carries. */
export const MAX_PATCH_CHARACTERS = 60_000
/** The lines of context around a change in a patch. */
export const PATCH_CONTEXT = 3
/** The lines of context when the patches are not asked for. */
export const NO_CONTEXT = 0

const MESSAGE_OUTCOMES = ["succeeded", "failed", "interrupted"] as const
const FILE_STATUSES = ["added", "deleted", "modified"] as const
const REQUEST_KINDS = ["permission", "question"] as const

/** The arguments of `opencode_run_read`: one `method`, and the arguments that method takes (`read.arguments.ts` checks which). */
export const runReadInput = z.object({
  method: z
    .enum(RUN_READ_METHODS)
    .describe(
      "What to read: `list` the caller's runs, `get` one run's state and result, `wait` until it hands back, `messages` its recent messages, `changes` the files its newest turn changed.",
    ),
  session: z
    .string()
    .min(1)
    .max(MAX_ID)
    .optional()
    .describe("Methods `get`, `wait`, `messages` and `changes`, required there: the id of a session a start returned."),
  directory: z
    .string()
    .optional()
    .describe(
      "Method `list`: the absolute path of a worktree; keeps its runs. Left out, the runs of every worktree are listed.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_MESSAGES)
    .optional()
    .describe(`Method \`messages\`: how many messages, 1 to ${MAX_MESSAGES}; ${DEFAULT_MESSAGES} when left out.`),
  patches: z
    .boolean()
    .optional()
    .describe(
      "Method `changes`: true adds each file's patch, within a size limit; false or left out, the files alone.",
    ),
})

const errorSchema = z.object({ type: z.string(), message: z.string() })

const stateSchema = z.enum(RUN_STATES)

const listedRunSchema = z.object({
  session: z.string(),
  title: z.string().optional(),
  role: z.string(),
  directory: z.string(),
  branch: z.string().nullable().describe("The branch the run is bound to; null on a detached HEAD."),
  state: stateSchema,
})

const requestSchema = z.object({
  kind: z.enum(REQUEST_KINDS),
  id: z.string(),
  session: z.string().describe("The session that asked: the run's own, or a subagent's."),
  action: z.string().optional().describe("A permission request: what it asks to do."),
  resources: z
    .array(z.string())
    .optional()
    .describe(`A permission request: what it asks to do it to, at most ${MAX_RESOURCES}.`),
  title: z.string().optional().describe("A question: its title."),
})

const retrySchema = z.object({
  attempt: z.number(),
  at: z.number().describe("When the service tries again, as the service gives it."),
  error: errorSchema,
})

const messageSchema = z.object({
  type: z.string(),
  time: z.number().describe("When the message was created."),
  text: z.string().optional(),
  truncated: z.boolean().optional().describe("True when `text` was cut."),
  tools: z
    .array(z.object({ name: z.string(), status: z.string() }))
    .optional()
    .describe(`An assistant message's tool parts, at most ${MAX_MESSAGE_TOOLS}.`),
  error: errorSchema.optional(),
  outcome: z.enum(MESSAGE_OUTCOMES).optional().describe("An idle message: how the turn ended."),
  agent: z.string().optional(),
})

const fileSchema = z.object({
  file: z.string(),
  status: z.enum(FILE_STATUSES),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
  patch_omitted: z.boolean().optional().describe("True when the patch did not fit the size limit and was left out."),
})

/** The result of `opencode_run_read`: the fields every method has, and those of the method that was read, each left out by the others. */
export const runReadOutput = z.object({
  method: z.enum(RUN_READ_METHODS).describe("The method that was read."),
  service_started: z.boolean().describe("True when this call found no service running and started one."),
  runs: z.array(listedRunSchema).optional().describe("Method `list`: the caller's runs, newest update first."),
  total: z
    .number()
    .optional()
    .describe("Methods `list`, `messages` and `changes`: how many there are, before the size limit."),
  truncated: z
    .boolean()
    .optional()
    .describe("Methods `list`, `messages` and `changes`: true when entries, or a patch, were left out."),
  more: z.boolean().optional().describe("Method `list`: true when the service holds more sessions than were read."),
  session: z.string().optional().describe("Methods `get` and `wait`: the run's session."),
  title: z.string().optional().describe("Methods `get` and `wait`: the session's title."),
  role: z.string().optional().describe("Methods `get` and `wait`: the role the run started under."),
  agent: z.string().optional().describe("Methods `get` and `wait`: the session's agent."),
  model: z
    .string()
    .optional()
    .describe("Methods `get` and `wait`: the session's model written `<provider>/<model>`, with `#<variant>`."),
  directory: z.string().optional().describe("Methods `get` and `wait`: the session's directory."),
  branch: z
    .string()
    .nullable()
    .optional()
    .describe("Methods `get` and `wait`: the branch the run is bound to; null on a detached HEAD."),
  state: stateSchema
    .optional()
    .describe(
      "Methods `get` and `wait`: `running`, `waiting` (on a request), `completed`, `failed`, `interrupted`, or `unknown` (the brief's admission was not confirmed, or the session holds no turn).",
    ),
  waiting_on: z
    .array(requestSchema)
    .optional()
    .describe(`State \`waiting\`: the requests the run is paused on, at most ${MAX_WAITING_ON}.`),
  waiting_total: z.number().optional().describe("State `waiting`: how many requests there are, when more than listed."),
  retry: retrySchema
    .optional()
    .describe("State `running`: the provider call the run is retrying, with the error that made it."),
  result: z
    .string()
    .optional()
    .describe("The text of the newest reply of the newest turn that ended without an error, when there is one."),
  result_truncated: z.boolean().optional().describe("True when `result` was cut."),
  error: errorSchema.optional().describe("State `failed`: the error the turn ended with."),
  resumes: z
    .boolean()
    .optional()
    .describe("State `interrupted`: true when OpenCode takes the turn up again when the service next starts."),
  message: z.string().optional().describe("States `interrupted` and `unknown`: what the state means."),
  timed_out: z
    .boolean()
    .optional()
    .describe("Method `wait`: true when the call's time ended while the run was still running."),
  messages: z
    .array(messageSchema)
    .optional()
    .describe("Method `messages`: the session's newest messages, newest first."),
  files: z
    .array(fileSchema)
    .optional()
    .describe(`Method \`changes\`: the files the newest turn changed, at most ${MAX_CHANGED_FILES}.`),
})

/** The arguments of a call of `opencode_run_read`. */
export type RunReadInput = z.output<typeof runReadInput>
/** The result of a call of `opencode_run_read`. */
export type RunReadOutput = z.input<typeof runReadOutput>

/**
 * A call whose arguments and context have been checked, with what the checks
 * resolved: nothing about it can be refused once the service is connected.
 */
export type CheckedCall =
  | { method: "list"; directory?: string }
  | { method: "get"; session: string }
  | { method: "wait"; session: string }
  | { method: "messages"; session: string; limit: number }
  | { method: "changes"; session: string; patches: boolean }

/** The checked call of one method. */
export type CallOf<Method extends RunReadMethod> = Extract<CheckedCall, { method: Method }>
