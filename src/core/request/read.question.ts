import type { FieldEntry, FieldOptionEntry } from "../service/reply.request"
import { MAX_ID, MAX_NAME } from "../service/schemas"
import type { PendingQuestion } from "./pending"
import { MAX_FIELDS_LISTED, MAX_LONG_LINE, MAX_OPTIONS_LISTED, MAX_SHORT_LINE, type RequestOut } from "./read.schemas"
import { lineFor, shortLine } from "./read.text"
import { isRepeatable } from "./text"

type FieldOut = NonNullable<RequestOut["fields"]>[number]
type OptionOut = NonNullable<FieldOut["options"]>[number]

function optionOut(option: FieldOptionEntry): OptionOut {
  return {
    value: option.value,
    ...lineFor("label", option.label, MAX_SHORT_LINE),
    ...lineFor("description", option.description, MAX_LONG_LINE),
  }
}

/** The options of a field as a result lists them: the first `MAX_OPTIONS_LISTED` whose value an answer can repeat, with how many there are when some were left out. */
function optionsOut(options: readonly FieldOptionEntry[]): Pick<FieldOut, "options" | "options_total"> {
  const listed = options.filter((option) => isRepeatable(option.value)).slice(0, MAX_OPTIONS_LISTED)
  return {
    options: listed.map(optionOut),
    ...(listed.length < options.length && { options_total: options.length }),
  }
}

/** A field's default, its texts cleaned to what a result may carry. */
function defaultOut(value: NonNullable<FieldEntry["default"]>): NonNullable<FieldOut["default"]> {
  if (typeof value === "string") return shortLine(value, MAX_LONG_LINE)
  if (Array.isArray(value)) return value.slice(0, MAX_OPTIONS_LISTED).map((item) => shortLine(item, MAX_LONG_LINE))
  return value
}

function fieldOut(field: FieldEntry): FieldOut {
  return {
    key: isRepeatable(field.key) ? field.key : shortLine(field.key, MAX_ID),
    kind: shortLine(field.type, MAX_NAME),
    ...lineFor("title", field.title, MAX_SHORT_LINE),
    ...lineFor("description", field.description, MAX_LONG_LINE),
    ...(field.required === true && { required: true as const }),
    ...(field.custom === true && { custom: true as const }),
    ...(field.options !== undefined && optionsOut(field.options)),
    ...(field.default !== undefined && { default: defaultOut(field.default) }),
    ...(field.minimum !== undefined && { minimum: field.minimum }),
    ...(field.maximum !== undefined && { maximum: field.maximum }),
    ...(field.minLength !== undefined && { min_length: field.minLength }),
    ...(field.maxLength !== undefined && { max_length: field.maxLength }),
    ...(field.minItems !== undefined && { min_items: field.minItems }),
    ...(field.maxItems !== undefined && { max_items: field.maxItems }),
    ...lineFor("pattern", field.pattern, MAX_LONG_LINE),
    ...lineFor("format", field.format, MAX_LONG_LINE),
    ...lineFor("url", field.url, MAX_LONG_LINE),
  }
}

/** A question as a result lists it: its texts cleaned to what a result may carry, and cut where the limits say. */
export function questionOut(question: PendingQuestion): RequestOut {
  const fields = question.fields.slice(0, MAX_FIELDS_LISTED)
  return {
    kind: "question",
    id: question.id,
    session: question.session,
    ...(question.subagent && { subagent: true as const }),
    ...lineFor("agent", question.agent, MAX_NAME),
    ...lineFor("title", question.title, MAX_SHORT_LINE),
    fields: fields.map(fieldOut),
    ...(question.fields.length > fields.length && { fields_total: question.fields.length }),
    ...(question.declineOnly !== undefined && { decline_only: question.declineOnly }),
  }
}
