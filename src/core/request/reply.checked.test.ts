import { describe, expect, test } from "bun:test"
import { failure } from "../service/read.testing"
import { SESSION_NOT_FOUND } from "../service/errors"
import { fakeQuestion, fakeSession } from "../service/testing"
import type { ReplyInput } from "./reply.schemas"
import { planReplies } from "./reply.plan"
import { approve, askShell, permissionPending, reject, replySetup, replyTo, writesOf } from "./reply.testing"
import { MAX_APPROVAL_TEXT } from "./text"
import { RUN } from "./request.testing"
import { boundRun } from "../run/read.testing"

const TOGETHER = (length: number) =>
  `The approvals of this call hold ${length} characters of text together, and a prompt shows ${MAX_APPROVAL_TEXT}. Answer them in separate calls.`

describe("the approvals' text of one call", () => {
  const pending = (lengths: number[]) =>
    lengths.map((length, index) => permissionPending({ id: `req_${index}`, text: "t".repeat(length) }))
  const approvals = (lengths: number[]) =>
    lengths.map((length, index) => approve(`req_${index}`, "t".repeat(length))) as ReplyInput[]

  test("is at most what a prompt shows: exactly the limit passes, one more is refused", () => {
    expect(planReplies(approvals([MAX_APPROVAL_TEXT]), pending([MAX_APPROVAL_TEXT]))).toHaveLength(1)
    expect(() => planReplies(approvals([MAX_APPROVAL_TEXT + 1]), pending([MAX_APPROVAL_TEXT + 1]))).toThrow(
      TOGETHER(MAX_APPROVAL_TEXT + 1),
    )
  })

  test("counts a blank line between two approvals, and one gap for each pair", () => {
    const fits = [1000, 998]
    expect(planReplies(approvals(fits), pending(fits))).toHaveLength(2)
    const over = [1000, 999]
    expect(() => planReplies(approvals(over), pending(over))).toThrow(TOGETHER(2001))
    const three = [660, 660, 676]
    expect(planReplies(approvals(three), pending(three))).toHaveLength(3)
    const threeOver = [660, 660, 677]
    expect(() => planReplies(approvals(threeOver), pending(threeOver))).toThrow(TOGETHER(2001))
  })

  test("counts code points, not UTF-16 units, and the texts of approvals only", () => {
    const emoji = "😀".repeat(MAX_APPROVAL_TEXT)
    const plan = planReplies([approve("req_0", emoji), reject("req_1", "x".repeat(2000))] as ReplyInput[], [
      permissionPending({ id: "req_0", text: emoji }),
      permissionPending({ id: "req_1", text: "t".repeat(9000) }),
    ])
    expect(plan).toHaveLength(2)
  })

  test("is checked after every reply has passed its own checks", () => {
    const lengths = [MAX_APPROVAL_TEXT, 1]
    const replies = [...approvals(lengths), reject("req_9")]
    expect(() => planReplies(replies, pending(lengths))).toThrow('Request "req_9" is not pending in this run.')
  })
})

describe("a call with one reply that cannot pass", () => {
  test("sends nothing, though the others were good", async () => {
    const { service, ctx } = replySetup()
    const good = askShell(service, "echo hi")
    const other = askShell(service, "npx cowsay hi")
    const bad = askShell(service, "git switch -c topic")
    const cases: [unknown[], string][] = [
      [
        [approve(good.id, "echo hi"), approve(other.id, "npx cowsay hi"), approve(bad.id, "echo other")],
        "not the request's",
      ],
      [[reject(good.id), approve(other.id, "npx cowsay hi"), reject("req_missing")], "not pending"],
      [[approve(good.id, "echo hi"), reject(good.id)], "named twice"],
      [[approve(good.id, "echo hi"), { request: other.id, decision: "reject" }], "carries a `reason`"],
    ]
    for (const [replies, words] of cases) {
      const error = await failure(replyTo(replies as never, ctx))
      expect(error.message).toContain(words)
      expect(writesOf(service)).toEqual([])
    }
    expect(fakeSession(service, RUN).answers).toEqual([])
    expect(fakeSession(service, RUN).pending).toHaveLength(3)
  })

  test("sends nothing when a later reply is a question answered with a wrong value", async () => {
    const { service, ctx } = replySetup()
    const asked = askShell(service, "echo hi")
    const form = fakeQuestion(service, RUN, "Which branch?", [{ key: "branch", type: "string", required: true }])
    const error = await failure(
      replyTo([approve(asked.id, "echo hi"), { request: form.id, decision: "answer", answer: { branch: 1 } }], ctx),
    )
    expect(error.message).toBe(
      `The answer to question "${form.id}" does not fit its fields: field "branch" takes a text`,
    )
    expect(writesOf(service)).toEqual([])
  })
})

describe("the session", () => {
  test("is not found for another caller's, a person's own or a missing one, with nothing read of it", async () => {
    const { service, ctx } = replySetup()
    boundRun(service, "ses_theirs", { caller: "someone-else", active: true })
    boundRun(service, "ses_person").metadata = undefined
    for (const session of ["ses_theirs", "ses_person", "ses_none"]) {
      const error = await failure(replyTo([reject("req_1")], ctx, session))
      expect([error.code, error.message]).toEqual(["not_found", SESSION_NOT_FOUND])
    }
    expect(writesOf(service)).toEqual([])
    expect(service.requests.filter((request) => /ses_theirs\/(permission|form)/.test(request.path))).toEqual([])
  })
})
