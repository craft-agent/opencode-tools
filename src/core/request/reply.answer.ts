import { shown } from "../text"
import type { FieldEntry } from "../service/reply.request"
import type { Answer } from "./reply.schemas"

/** What a field takes, by its type, as a message words it. */
const TAKES: Record<string, string> = {
  string: "a text",
  number: "a number",
  integer: "a whole number",
  boolean: "true or false",
  multiselect: "a list of texts",
}

/** Whether `value` is of the kind a field of `type` takes; a type these tools do not know takes nothing. */
function isKind(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string"
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "integer":
      return Number.isInteger(value)
    case "boolean":
      return typeof value === "boolean"
    case "multiselect":
      return Array.isArray(value) && value.every((item) => typeof item === "string")
    default:
      return true
  }
}

/** Whether a value of the right kind lies outside the options of a field that takes no text of the answerer's own. */
function isOutsideOptions(field: FieldEntry, value: unknown): boolean {
  if (field.custom === true) return false
  const options = field.options?.map((option) => option.value)
  if (field.type === "string" && options !== undefined) return !options.includes(value as string)
  if (field.type === "multiselect") return (value as string[]).some((item) => !(options ?? []).includes(item))
  return false
}

/**
 * The first thing wrong with an answer to a question's fields, in this order:
 * a key no field has, then field by field in the question's order a value of
 * another kind, a value outside the options of a field that takes only its
 * options, and a required field the answer lacks; `undefined` when the answer
 * fits. Lengths, ranges, patterns and formats are the service's to check.
 */
export function answerProblem(fields: readonly FieldEntry[], answer: Answer): string | undefined {
  const unknown = Object.keys(answer).find((key) => !fields.some((field) => field.key === key))
  if (unknown !== undefined) return `it has no field ${shown(unknown)}`
  for (const field of fields) {
    const key = shown(field.key)
    if (!Object.hasOwn(answer, field.key)) {
      if (field.required === true) return `field ${key} is required`
      continue
    }
    const value = answer[field.key]
    if (!isKind(field.type, value)) return `field ${key} takes ${TAKES[field.type]}`
    if (isOutsideOptions(field, value)) return `field ${key} takes one of its options`
  }
  return undefined
}
