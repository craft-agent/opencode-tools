import type { PermissionRule } from "@opencode/client"
import type { Policy } from "../role"

/** One permission rule of a session, in the service's own form: the action, the resource it matches as text, and the effect. */
export type Rule = PermissionRule

/** The rules a consumer adds to a run's ruleset, by the policy of the run: the `rules` setting. */
export type ConsumerRules = Readonly<Partial<Record<Policy, readonly Rule[]>>>
