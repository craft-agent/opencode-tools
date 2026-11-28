/**
 * Test support for the tests of the instruction tools: a run, idle or in
 * flight, the entries its session holds, and the three tools as the entry
 * points call them. Imported by tests only; it uses no test runner's API.
 */
import type { JsonValue } from "../errors"
import { RUN } from "../run/control.testing"
import { boundRun, runSetup, type RunSetup } from "../run/read.testing"
import { fakeSession, type FakeService } from "../service/testing"
import { invoke, type ToolContext } from "../tool"
import { KEY_PREFIX } from "./key"
import { opencodeInstructionRead } from "./read.tool"
import type { InstructionReadOutput } from "./read.schemas"
import type { RemoveOutput } from "./remove.schemas"
import { opencodeInstructionRemove } from "./remove.tool"
import type { SetOutput } from "./set.schemas"
import { opencodeInstructionSet } from "./set.tool"

/** The run's session in the tests. */
export { RUN }

/** The key of an entry of the package named `name`. */
export function keyOf(name: string): string {
  return `${KEY_PREFIX}${name}`
}

/** The `runSetup` options, and a run bound to the test's caller whose session is idle. */
export function idleRun(options: Parameters<typeof runSetup>[0] = {}): RunSetup {
  const setup = runSetup(options)
  boundRun(setup.service, RUN)
  return setup
}

/** Puts entries on the run's session as the service holds them, in the order given. */
export function holdEntries(service: FakeService, entries: Record<string, JsonValue>): void {
  Object.assign(fakeSession(service, RUN).entries, entries)
}

/** The entries the run's session holds. */
export function heldEntries(service: FakeService): Record<string, JsonValue> {
  return fakeSession(service, RUN).entries
}

/** `count` entries of the package, `a0` to `a<count - 1>`, each with a text of its own. */
export function manyEntries(count: number): Record<string, JsonValue> {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [keyOf(`a${index}`), `text ${index}`]))
}

/** Calls `opencode_instruction_read` as the entry points do, for the run's session unless another is given. */
export function readEntries(
  args: Record<string, unknown>,
  ctx: ToolContext,
  session = RUN,
): Promise<InstructionReadOutput> {
  return invoke(opencodeInstructionRead, { session, ...args }, ctx)
}

/** Calls `opencode_instruction_set` as the entry points do, for the run's session unless another is given. */
export function setEntryOf(key: string, value: string, ctx: ToolContext, session = RUN): Promise<SetOutput> {
  return invoke(opencodeInstructionSet, { session, key, value }, ctx)
}

/** Calls `opencode_instruction_remove` as the entry points do, for the run's session unless another is given. */
export function removeEntryOf(key: string, ctx: ToolContext, session = RUN): Promise<RemoveOutput> {
  return invoke(opencodeInstructionRemove, { session, key }, ctx)
}

/** What the service receives to put the entry `key` on the run's session, as `writesOf` lists it. */
export function putOf(key: string): string {
  return `PUT /api/experimental/session/${RUN}/instructions/entries/${key}`
}

/** What the service receives to remove the entry `key` from the run's session, as `writesOf` lists it. */
export function deleteOf(key: string): string {
  return `DELETE /api/experimental/session/${RUN}/instructions/entries/${key}`
}
