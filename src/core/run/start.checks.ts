import { ToolError } from "../errors"
import type { Policy, Role } from "../role"
import { roleNamed } from "../service/ready"
import type { ToolContext } from "../tool"
import type { StartInput } from "./start.schemas"

/** The tool that starts runs of each policy. */
export const START_TOOL_IDS: Readonly<Record<Policy, string>> = {
  "read-only": "opencode_run_start",
  write: "opencode_run_start_write",
}

/** A call's role as the settings configure it, with its name. */
export type CheckedRole = { name: string; role: Role }

function invalid(message: string): ToolError {
  return new ToolError("invalid_argument", message)
}

/**
 * Checks what the arguments and the settings alone decide, so that a mistake
 * starts no service and sends no request, and returns the role they name: the
 * role must be configured and have the tool's `policy`, the brief must not be
 * blank, and a new session (`directory`) and a continued one (`session`) are
 * not asked for together.
 */
export function checkStart(args: StartInput, policy: Policy, ctx: Pick<ToolContext, "options">): CheckedRole {
  const checked = roleNamed(args.role, ctx)
  if (checked.role.policy !== policy) {
    throw invalid(
      `Role "${checked.name}" has the policy ${checked.role.policy}; start it with ${START_TOOL_IDS[checked.role.policy]}.`,
    )
  }
  if (args.brief.trim() === "") throw invalid("brief must not be blank.")
  if (args.directory !== undefined && args.session !== undefined) {
    throw invalid("Give directory for a new session, or session to continue one, not both.")
  }
  return checked
}
