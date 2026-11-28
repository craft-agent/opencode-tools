import { describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import type { ErrorCode } from "../errors"
import { boundRun, DIRECTORY } from "../run/read.testing"
import { SESSION_NOT_FOUND } from "../service/errors"
import { failure } from "../service/read.testing"
import { fakeQuestion, fakeToolAsk } from "../service/testing"
import { ANY_TARGET, writeTargets } from "../targets"
import type { ReplyInput } from "./reply.schemas"
import { answer, approve, askShell, reject, replySetup, writesOf } from "./reply.testing"
import { opencodeRequestReply } from "./reply.tool"
import { RUN } from "./request.testing"

const tool = opencodeRequestReply

describe("targets", () => {
  test("is the run's directory, whatever the replies", async () => {
    const { service, ctx } = replySetup()
    const asked = askShell(service, "echo hi")
    const args = { session: RUN, replies: [reject(asked.id)] }
    expect(await writeTargets(tool, args, ctx)).toEqual([DIRECTORY])
    expect(await writeTargets(tool, { session: RUN, replies: [reject("missing")] }, ctx)).toEqual([DIRECTORY])
    expect(writesOf(service)).toEqual([])
  })

  test("cannot be told for a session that is another caller's, a person's own or missing, which is not found", async () => {
    const { service, ctx } = replySetup()
    boundRun(service, "ses_theirs", { caller: "someone-else" })
    boundRun(service, "ses_person").metadata = undefined
    for (const session of ["ses_theirs", "ses_person", "ses_none"]) {
      const args = { session, replies: [reject("req_1")] }
      const error = await failure(tool.targets!(args, ctx) as Promise<unknown>)
      expect([error.code, error.message]).toEqual(["not_found", SESSION_NOT_FOUND])
      expect(await writeTargets(tool, args, ctx)).toEqual([ANY_TARGET])
    }
  })
})

describe("gate", () => {
  test("refuses an approval of a request that can only be rejected, before anyone is asked", async () => {
    const { service, ctx } = replySetup({}, { never_approve: ["shell"] })
    const asked = askShell(service, "echo hi")
    const error = await failure(
      tool.gate!({ session: RUN, replies: [approve(asked.id, "echo hi")] } as never, ctx) as Promise<unknown>,
    )
    expect([error.code, error.message, error.details]).toEqual([
      "forbidden",
      `Request "${asked.id}" can only be rejected: The \`never_approve\` setting holds its action.`,
      { reason: "reject_only" },
    ])
    expect(writesOf(service)).toEqual([])
  })

  test("lets the rejection of that request through, and sends nothing itself", async () => {
    const { service, ctx } = replySetup({}, { never_approve: ["shell"] })
    const asked = askShell(service, "echo hi")
    await tool.gate!({ session: RUN, replies: [reject(asked.id)] } as never, ctx)
    expect(writesOf(service)).toEqual([])
  })

  test("refuses every call that cannot run, as the plan does", async () => {
    const { service, ctx } = replySetup()
    const asked = askShell(service, "echo hi")
    const cases: [ReplyInput[], ErrorCode, string][] = [
      [[approve(asked.id, "echo ho")], "invalid_argument", "is not the request's"],
      [[reject("missing")], "not_found", "is not pending in this run"],
      [[reject(asked.id), reject(asked.id)], "invalid_argument", "named twice"],
    ]
    for (const [replies, code, words] of cases) {
      const error = await failure(tool.gate!({ session: RUN, replies } as never, ctx) as Promise<unknown>)
      expect(error.code).toBe(code)
      expect(error.message).toContain(words)
    }
  })

  test("refuses a session that is not the caller's as not found", async () => {
    const { service, ctx } = replySetup()
    boundRun(service, "ses_theirs", { caller: "someone-else" })
    const error = await failure(
      tool.gate!({ session: "ses_theirs", replies: [reject("req_1")] } as never, ctx) as Promise<unknown>,
    )
    expect(error.code).toBe("not_found")
  })
})

describe("describe", () => {
  async function mixed() {
    const setup = replySetup()
    const { service } = setup
    const switchBranch = askShell(service, "git switch -c topic")
    const edit = fakeToolAsk(service, RUN, {
      tool: "write",
      input: { file: "a.ts" },
      action: "edit",
      resources: ["a.ts"],
    })
    const tests = askShell(service, "echo hi")
    const branch = fakeQuestion(service, RUN, "Which branch?", [
      {
        key: "branch",
        type: "string",
        options: [
          { value: "main", label: "Main" },
          { value: "dev", label: "Dev" },
        ],
      },
      {
        key: "checks",
        type: "multiselect",
        options: [
          { value: "unit", label: "Unit" },
          { value: "lint", label: "Lint" },
        ],
        custom: true,
      },
    ])
    const other = fakeQuestion(service, RUN, "Another?")
    const args = {
      session: RUN,
      replies: [
        reject(tests.id, "Run\nthe tests first."),
        answer(branch.id, { branch: "dev", checks: ["unit", "mine"] }),
        approve(switchBranch.id, "git switch -c topic"),
        reject(other.id, "No\u202eidea"),
        approve(edit.id, '{"file":"a.ts"}'),
      ],
    }
    return { ...setup, args }
  }

  test("shows the role, the approved actions in sending order, how many are rejected and answered, then the texts", async () => {
    const { ctx, args, service } = await mixed()
    expect(await wholeCallDescription(tool, args, ctx)).toEqual({
      facts: [
        { label: "Role", value: "plan" },
        { label: "Approves", value: "shell, edit" },
        { label: "Rejects", value: "2" },
        { label: "Answers", value: "1" },
      ],
      text: {
        label: "Replies",
        body: [
          "git switch -c topic",
          '{"file":"a.ts"}',
          "Reject shell: Run the tests first.\nReject Another?: No idea\nAnswer Which branch?: branch: dev; checks: unit, mine",
        ].join("\n\n"),
      },
    })
    expect(writesOf(service)).toEqual([])
  })

  test("is the same for the same state", async () => {
    const { ctx, args } = await mixed()
    expect(await tool.describe!(args as never, ctx)).toEqual(await tool.describe!(args as never, ctx))
  })

  test("names only the facts that apply", async () => {
    const { service, ctx } = replySetup()
    const asked = askShell(service, "echo hi")
    const other = askShell(service, "echo ho")
    const approving = await wholeCallDescription(tool, { session: RUN, replies: [approve(asked.id, "echo hi")] }, ctx)
    expect(approving?.facts.map((fact) => fact.label)).toEqual(["Role", "Approves"])
    expect(approving?.text?.body).toBe("echo hi")
    const rejecting = await wholeCallDescription(tool, { session: RUN, replies: [reject(other.id, "No.")] }, ctx)
    expect(rejecting?.facts.map((fact) => fact.label)).toEqual(["Role", "Rejects"])
    expect(rejecting?.text?.body).toBe("Reject shell: No.")
  })

  test("keeps the whole of the approvals, which come first", async () => {
    const { service, ctx } = replySetup()
    const command = `echo ${"x".repeat(1900)}`
    const long = askShell(service, command)
    const other = askShell(service, "echo ho")
    const description = await wholeCallDescription(
      tool,
      { session: RUN, replies: [reject(other.id, "r".repeat(2000)), approve(long.id, command)] },
      ctx,
    )
    expect(description?.text?.body.startsWith(`${command}\n\nReject shell: `)).toBe(true)
  })

  test("is no description for a call that cannot pass, which the gate has already refused", async () => {
    const { service, ctx } = replySetup()
    askShell(service, "echo hi")
    expect(await wholeCallDescription(tool, { session: RUN, replies: [reject("missing")] }, ctx)).toBeUndefined()
    const error = await failure(
      tool.describe!({ session: RUN, replies: [reject("missing")] } as never, ctx) as Promise<unknown>,
    )
    expect(error.code).toBe("not_found")
  })
})
