import { z } from "zod"
import { read } from "./reply"

const entry = z.looseObject({ key: z.string().min(1), value: z.json() })

/** An instruction entry of a session: its key and its value, which is any JSON. */
export type InstructionEntry = z.output<typeof entry>

/** The entries of an `experimental.session.instructions.entry.list` reply, in the order the service gives them. */
export function entriesOf(reply: unknown): InstructionEntry[] {
  return read(z.array(entry), reply)
}
