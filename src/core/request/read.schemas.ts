import { z } from "zod"
import { MAX_ID } from "../service/schemas"

/** The methods of `opencode_request_read`, in the order the schema lists them; a method is added here, in `read.arguments.ts`, in `CheckedCall` and in the dispatch of `read.tool.ts`. */
export const REQUEST_READ_METHODS = ["list", "get"] as const

/** One method of `opencode_request_read`. */
export type RequestReadMethod = (typeof REQUEST_READ_METHODS)[number]

/** The most code points of a request's text `list` keeps: more than the most an approval shows, so a request that can be approved is whole there. */
export const MAX_LISTED_TEXT = 4000
/** The most requests `list` lists. */
export const MAX_REQUESTS_LISTED = 20
/** The most resources of a request a result lists. */
export const MAX_RESOURCES_LISTED = 50
/** The most files of a request a result lists. */
export const MAX_FILES_LISTED = 50
/** The most fields of a question a result lists. */
export const MAX_FIELDS_LISTED = 20
/** The most options of a field, and the most items of a field's default, a result lists. */
export const MAX_OPTIONS_LISTED = 50
/** The most code points of a request's message, a title, or an option's label a result keeps. */
export const MAX_SHORT_LINE = 300
/** The most code points of a resource, a file's name, a description, a pattern, a format or a link a result keeps. */
export const MAX_LONG_LINE = 500

/** The most characters of JSON an entry of `list` takes whole: a larger one is listed in brief, so that no entry crowds out the list. */
export const MAX_ENTRY_CHARS = 6000

const FILE_STATUSES = ["added", "deleted", "modified"] as const
const REQUEST_KINDS = ["permission", "question"] as const

/** The arguments of `opencode_request_read`: one `method`, and the arguments that method takes (`read.arguments.ts` checks which). */
export const requestReadInput = z.object({
  method: z
    .enum(REQUEST_READ_METHODS)
    .describe("What to read: `list` what the run is paused on, `get` one request or question whole."),
  session: z
    .string()
    .min(1)
    .max(MAX_ID)
    .optional()
    .describe("Both methods, required: the id of a session a start returned."),
  request: z
    .string()
    .min(1)
    .max(MAX_ID)
    .optional()
    .describe("Method `get`, required there: the id of a request or a question `list` returned."),
})

const optionOut = z.object({
  value: z.string().describe("What an answer repeats, as it is."),
  label: z.string().optional(),
  description: z.string().optional(),
})

const fieldOut = z.object({
  key: z.string().describe("What an answer names the field by, as it is."),
  kind: z.string().describe("`string`, `number`, `integer`, `boolean`, `multiselect` or `external` (a link to visit)."),
  title: z.string().optional(),
  description: z.string().optional(),
  required: z.literal(true).optional(),
  custom: z.literal(true).optional().describe("True when an answer may be text of its own, not only an option."),
  options: z.array(optionOut).optional().describe(`At most ${MAX_OPTIONS_LISTED}.`),
  options_total: z.number().optional().describe("How many options there are, when some were left out."),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  minimum: z.union([z.number(), z.string()]).optional(),
  maximum: z.union([z.number(), z.string()]).optional(),
  min_length: z.number().optional(),
  max_length: z.number().optional(),
  min_items: z.number().optional(),
  max_items: z.number().optional(),
  pattern: z.string().optional(),
  format: z.string().optional(),
  url: z.string().optional().describe("A link to visit, as the field gives it."),
})

const fileOut = z.object({
  file: z.string(),
  status: z.enum(FILE_STATUSES),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
  patch_omitted: z
    .literal(true)
    .optional()
    .describe("True when the patch did not fit the size limit and was left out."),
})

const requestOut = z.object({
  kind: z.enum(REQUEST_KINDS),
  id: z.string(),
  session: z.string().describe("The session that asked: the run's own, or a subagent's."),
  subagent: z.literal(true).optional().describe("True when a subagent asked."),
  agent: z.string().optional().describe("The agent of the session that asked."),
  action: z.string().optional().describe("A permission request: what it asks to do."),
  resources: z
    .array(z.string())
    .optional()
    .describe(
      `A permission request: what it asks to do it to, at most ${MAX_RESOURCES_LISTED}; those of a shell call are its simple commands.`,
    ),
  resources_total: z.number().optional().describe("How many resources there are, when some were left out."),
  tool: z.string().optional().describe("A permission request: the tool call that asked, when it could be read."),
  step: z
    .string()
    .optional()
    .describe("A permission request: the step that holds the call; rejecting one request rejects the others of it."),
  text: z.string().optional().describe("A permission request: what an approval lets run, which an approval repeats."),
  text_truncated: z.literal(true).optional().describe("True when `text` was cut."),
  message: z.string().optional().describe("A permission request: what the service says of it."),
  files: z
    .array(fileOut)
    .optional()
    .describe(`A permission request: the files it would change, at most ${MAX_FILES_LISTED}.`),
  files_total: z.number().optional().describe("How many files there are, when some were left out."),
  reject_only: z.string().optional().describe("A permission request that can only be rejected: why."),
  title: z.string().optional().describe("A question: its title."),
  fields: z.array(fieldOut).optional().describe(`A question: its fields, at most ${MAX_FIELDS_LISTED}.`),
  fields_total: z.number().optional().describe("How many fields there are, when some were left out."),
  decline_only: z.string().optional().describe("A question that can only be declined: why."),
  brief: z.literal(true).optional().describe("Method `list`: listed without its text or fields, which `get` reads."),
})

/** The result of `opencode_request_read`: the fields every method has, and those of the method that was read, each left out by the other. */
export const requestReadOutput = z.object({
  method: z.enum(REQUEST_READ_METHODS).describe("The method that was read."),
  service_started: z.boolean().describe("True when this call found no service running and started one."),
  session: z.string().describe("The run's session."),
  requests: z
    .array(requestOut)
    .optional()
    .describe(
      `Method \`list\`: what the run is paused on, at most ${MAX_REQUESTS_LISTED}, the run's own session's first.`,
    ),
  total: z.number().optional().describe("Method `list`: how many requests the run is paused on, before the limits."),
  truncated: z.boolean().optional().describe("Method `list`: true when requests were left out."),
  request: requestOut.optional().describe("Method `get`: the request or question."),
})

/** The arguments of a call of `opencode_request_read`. */
export type RequestReadInput = z.output<typeof requestReadInput>
/** The result of a call of `opencode_request_read`. */
export type RequestReadOutput = z.input<typeof requestReadOutput>
/** One request or question of a result. */
export type RequestOut = z.input<typeof requestOut>

/**
 * A call whose arguments have been checked, with what the checks resolved:
 * nothing about it can be refused once the service is connected.
 */
export type CheckedCall = { method: "list"; session: string } | { method: "get"; session: string; request: string }

/** The checked call of one method. */
export type CallOf<Method extends RequestReadMethod> = Extract<CheckedCall, { method: Method }>
