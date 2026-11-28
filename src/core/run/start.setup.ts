import { ToolError } from "../errors"
import { VARIANT_DEFAULT } from "../role"
import type { ServiceConnection } from "../service/connect"
import { cleaned } from "../service/errors"
import { sessionOf, type SessionEntry } from "../service/reply"
import type { ModelRef } from "../service/resolve"
import { bindingOf, sameBinding, unmarked, withBinding, type Binding } from "./binding"
import type { Rule } from "./rule"

/** What a start sets a session up with, and so what it reads back from it. */
export type SessionSetup = {
  agent: string
  model: ModelRef
  ruleset: readonly Rule[]
  /** The binding with this call's mark. */
  binding: Binding
  /** The directory the service knows the session by. */
  directory: string
}

/** The parts of a session a start compares, in the order a failure names them. */
const PARTS = ["agent", "model", "ruleset", "binding", "directory"] as const

type Part = (typeof PARTS)[number]

/** A variant as the service reports it: the variant `default` is none. */
function variantOf(variant: string | undefined): string | undefined {
  return variant === VARIANT_DEFAULT ? undefined : variant
}

/** A model as a request carries it: the variant only when it has one. */
function modelInput(model: ModelRef): { providerID: string; id: string; variant?: string } {
  const variant = variantOf(model.variant)
  return { providerID: model.providerID, id: model.id, ...(variant !== undefined && { variant }) }
}

/** Whether two models are the same one: a missing variant and `default` are the same. */
export function sameModel(a: ModelRef | undefined, b: ModelRef): boolean {
  return (
    a !== undefined && a.providerID === b.providerID && a.id === b.id && variantOf(a.variant) === variantOf(b.variant)
  )
}

function sameRuleset(actual: readonly Rule[] | undefined, expected: readonly Rule[]): boolean {
  const rules = actual ?? []
  return (
    rules.length === expected.length &&
    rules.every(
      (rule, index) =>
        rule.action === expected[index]!.action &&
        rule.resource === expected[index]!.resource &&
        rule.effect === expected[index]!.effect,
    )
  )
}

/** The parts of `session` that differ from what a start set up, in `PARTS` order. */
function differencesOf(session: SessionEntry, setup: SessionSetup): Part[] {
  const same: Record<Part, boolean> = {
    agent: session.agent === setup.agent,
    model: sameModel(session.model, setup.model),
    ruleset: sameRuleset(session.permissions, setup.ruleset),
    binding: sameBinding(bindingOf(session.metadata), setup.binding),
    directory: session.directory === setup.directory,
  }
  return PARTS.filter((part) => !same[part])
}

/** Creates the session of a new run, set up as `setup` says, and returns its id. */
export async function createSession(service: ServiceConnection, setup: SessionSetup): Promise<string> {
  const created = await service.client.session.create({
    location: { directory: setup.directory },
    agent: setup.agent,
    model: modelInput(setup.model),
    permissions: setup.ruleset,
    metadata: withBinding(undefined, setup.binding),
  })
  return sessionOf(created).id
}

/** Forks the session `sessionID` and returns the copy, as the service holds it: bound as its source is, mark included, and with no turn of its own. */
export async function forkSession(service: ServiceConnection, sessionID: string): Promise<SessionEntry> {
  return sessionOf(await service.client.session.fork({ sessionID }))
}

/**
 * Sets a session that is continued up again: its agent and its model where
 * they differ, then its ruleset and its binding with a fresh mark. Every other
 * key of its metadata is written back as it was read.
 */
export async function reconfigureSession(
  service: ServiceConnection,
  session: SessionEntry,
  setup: SessionSetup,
): Promise<void> {
  const { client } = service
  if (session.agent !== setup.agent) await client.session.switchAgent({ sessionID: session.id, agent: setup.agent })
  if (!sameModel(session.model, setup.model)) {
    await client.session.switchModel({ sessionID: session.id, model: modelInput(setup.model) })
  }
  await client.session.update({
    sessionID: session.id,
    permissions: setup.ruleset,
    metadata: withBinding(session.metadata, setup.binding),
  })
}

/**
 * Reads the session back and checks it holds what `setup` gave it. A
 * difference fails the start before any brief is sent: as `stale` when a
 * continued session's binding carries another call's mark (that call
 * continued it at the same moment), else as `upstream_error` naming the parts.
 */
export async function readBack(
  service: ServiceConnection,
  sessionID: string,
  setup: SessionSetup,
  continued: boolean,
): Promise<void> {
  const session = sessionOf(await service.client.session.get({ sessionID }))
  const differences = differencesOf(session, setup)
  if (differences.length === 0) return
  const mark = bindingOf(session.metadata)?.starting
  if (continued && mark !== undefined && mark.token !== setup.binding.starting?.token) {
    throw new ToolError("stale", `Another call is continuing session ${cleaned(sessionID)}; try again in a moment.`)
  }
  throw new ToolError(
    "upstream_error",
    `The OpenCode service did not report back the session as it was set up (${differences.join(", ")}); no brief was sent.`,
  )
}

/** Removes the session a start just created or forked, when the start cannot go on. Its own failure is ignored: the start's is the one to report. */
export async function removeSession(service: ServiceConnection, sessionID: string): Promise<void> {
  try {
    await service.client.session.remove({ sessionID })
  } catch {
    // The failure that made the start give up is the one the caller needs.
  }
}

/** Takes a start's mark back from a session it continues, which stays. Its own failure is ignored. */
export async function unmarkSession(
  service: ServiceConnection,
  session: SessionEntry,
  setup: SessionSetup,
): Promise<void> {
  try {
    await service.client.session.update({
      sessionID: session.id,
      metadata: withBinding(session.metadata, unmarked(setup.binding)),
    })
  } catch {
    // The failure that made the start give up is the one the caller needs.
  }
}
