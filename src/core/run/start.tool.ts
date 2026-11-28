import { DEFAULT_WAIT_SECONDS, WAIT_SECONDS_OPTION, startDeadline } from "../deadline"
import { realOrGiven } from "../paths"
import type { Policy, Role } from "../role"
import { withService } from "../service/connect"
import { directoryOf } from "../service/directory"
import { roleNamed } from "../service/ready"
import { defineTool, type ToolSpec } from "../tool"
import { ownedSession } from "./owned"
import { startRun } from "./start"
import { START_TOOL_IDS, checkStart } from "./start.checks"
import { MAX_BRIEF, startInput, startOutput } from "./start.schemas"

/** The role's own model as written, else what a run without one gets. */
const MODEL_UNNAMED = "the agent's, else the service's default"
/** What a continued session whose role names no model keeps. */
const MODEL_KEPT = "the session's own"
/** The `Session` fact of a new session. */
const SESSION_NEW = "new"

/** The model fact: what the role says, or what stands where it names none. */
function modelFact(role: Role, session: string | undefined): string {
  return role.model ?? (session === undefined ? MODEL_UNNAMED : MODEL_KEPT)
}

function descriptionOf(policy: Policy): string {
  const other = START_TOOL_IDS[policy === "write" ? "read-only" : "write"]
  return (
    `Start an OpenCode run under a role whose policy is \`${policy}\`, or continue one, and send it a brief. ` +
    "`role` is a role the person configured; `opencode_service_read` method `status` lists them, and a role of the other policy starts with " +
    `\`${other}\`. ` +
    `\`brief\` is the message that starts the run, 1 to ${MAX_BRIEF} characters. ` +
    "`directory` starts a new session there: an absolute path, the top level of a Git worktree, and the call's working directory when left out. " +
    "`session` continues the session of an earlier start instead, which takes the role's agent and ruleset and its model when the role names one; give one of the two, not both. " +
    (policy === "write"
      ? "The run may edit files inside its worktree, and starts only while no other session is running there. "
      : "The run has no edit tools and is denied the git commands that write; it keeps its shell. ") +
    "The call returns once the brief is admitted and does not wait for the turn: `opencode_run_read` waits for it and reads the result. " +
    "A session that is running is refused: a start needs it idle. " +
    "The session is read back before any brief is sent, and nothing is sent when it differs from what was set up. " +
    "`state` is `running` once the brief is admitted. It is `unknown` when its admission could not be confirmed: the brief may have been taken, so read the session before anything else, and send nothing again. " +
    "`note` says where the operating note went: an instruction entry of the session, or the head of the brief. " +
    "The call starts the service when it is not running; `service_started` says when it did. " +
    `A call ends within the \`${WAIT_SECONDS_OPTION}\` setting of its start, ${DEFAULT_WAIT_SECONDS} seconds unless set.`
  )
}

/** The start tool of `policy`: the same code for both, which differ in the roles they take and in their write class. */
function startToolOf(policy: Policy): ToolSpec<typeof startInput, typeof startOutput> {
  const write = policy === "write"
  return defineTool({
    id: START_TOOL_IDS[policy],
    title: write ? "Start an OpenCode write run" : "Start an OpenCode run",
    intent: write ? "About to start or continue a write run" : "About to start or continue a read-only run",
    description: descriptionOf(policy),
    toolset: "run",
    class: write ? "overwrite" : "add",
    async targets(args, ctx) {
      const { session: sessionID } = args
      if (sessionID === undefined) return [await realOrGiven(await directoryOf(args, ctx))]
      return withService(
        ctx,
        async (service) => [(await ownedSession(service, sessionID, ctx.caller)).session.directory],
        { deadline: startDeadline(ctx) },
      )
    },
    gate(args, ctx) {
      checkStart(args, policy, ctx)
    },
    describe(args, ctx) {
      const { name, role } = roleNamed(args.role, ctx)
      return {
        facts: [
          { label: "Role", value: name },
          { label: "Agent", value: role.agent },
          { label: "Policy", value: role.policy },
          { label: "Model", value: modelFact(role, args.session) },
          { label: "Session", value: args.session ?? SESSION_NEW },
        ],
        text: { label: "Brief", body: args.brief },
      }
    },
    bounds: {
      role: {
        kind: "prefix",
        separator: "/",
        description: "The roles a run may start under; a role's name cannot hold `/`, so each entry matches one role.",
      },
      brief_length: { kind: "max", description: "The most characters of the brief." },
    },
    measure: (args) => ({ role: args.role, brief_length: [...args.brief].length }),
    input: startInput,
    output: startOutput,
    execute: (args, ctx) => startRun(args, ctx, policy),
  })
}

/** Starts or continues a run under a role whose policy is `read-only`. */
export const opencodeRunStart = startToolOf("read-only")

/** Starts or continues a run under a role whose policy is `write`. */
export const opencodeRunStartWrite = startToolOf("write")
