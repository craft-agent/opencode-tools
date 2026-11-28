import { blockOf } from "../run/read.text"
import { NOTE_KEY } from "../run/note"
import type { InstructionEntry } from "../service/reply.instruction"
import { valueText } from "./entries"
import type { EntryOut } from "./read.schemas"

/** An entry as a result carries it: its value as data, line breaks kept, cut to `valueLimit` characters. */
export function entryOut(entry: InstructionEntry, valueLimit: number): EntryOut {
  const { text, json } = valueText(entry.value)
  const value = blockOf(text, valueLimit)
  return {
    key: entry.key,
    value: value.text,
    ...(value.cut && { value_truncated: true as const }),
    ...(json && { json: true as const }),
    ...(entry.key === NOTE_KEY && { read_only: true as const }),
  }
}
