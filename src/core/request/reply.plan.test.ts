import { describe, expect, test } from "bun:test"
import type { ToolError } from "../errors"
import type { Pending } from "./pending"
import { inSendingOrder, planReplies } from "./reply.plan"
import type { ReplyInput } from "./reply.schemas"
import { answer, approve, permissionPending, questionPending, reject } from "./reply.testing"
import { REJECT_ONLY_WORDS } from "./verdict"

const PERMISSION = permissionPending({ id: "req_1", text: "echo hi" })
const QUESTION = questionPending({ id: "form_1" })

/** The error `planReplies` throws for these replies. */
function refused(replies: unknown[], pending: Pending[] = [PERMISSION, QUESTION]): ToolError {
  try {
    planReplies(replies as ReplyInput[], pending)
  } catch (error) {
    return error as ToolError
  }
  throw new Error("The plan passed")
}

function expectRefusal(error: ToolError, code: string, message: string, details?: Record<string, string>) {
  expect([error.code, error.message]).toEqual([code, message])
  expect(error.details).toEqual(details)
}

describe("planReplies: what a call refuses", () => {
  test("a request named twice", () => {
    expectRefusal(
      refused([reject("req_1"), reject("req_1")]),
      "invalid_argument",
      'Request "req_1" is named twice; a request is answered once.',
    )
  })

  test("a request that is not pending in the run, worded the same for any id", () => {
    expectRefusal(refused([approve("req_9", "x")]), "not_found", 'Request "req_9" is not pending in this run.')
  })

  test("an approval, or a rejection, of a question that is the other's kind", () => {
    expectRefusal(
      refused([approve("form_1", "echo hi")]),
      "invalid_argument",
      'Request "form_1" is a question: answer it with `answer`, or decline it with `reject`.',
    )
    expectRefusal(
      refused([answer("req_1", { x: "y" })]),
      "invalid_argument",
      'Request "req_1" is a permission request: answer it `once` or `reject`.',
    )
  })

  test("a property the decision does not take", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ request: "req_1", decision: "once", text: "echo hi", reason: "r" }, "once` takes no `reason"],
      [{ request: "req_1", decision: "once", text: "echo hi", answer: {} }, "once` takes no `answer"],
      [{ request: "req_1", decision: "reject", reason: "r", text: "echo hi" }, "reject` takes no `text"],
      [{ request: "req_1", decision: "reject", reason: "r", answer: { a: "b" } }, "reject` takes no `answer"],
      [{ request: "form_1", decision: "answer", answer: { branch: "main" }, text: "t" }, "answer` takes no `text"],
      [{ request: "form_1", decision: "answer", answer: { branch: "main" }, reason: "r" }, "answer` takes no `reason"],
    ]
    for (const [reply, words] of cases) {
      expectRefusal(refused([reply]), "invalid_argument", `A reply that says \`${words}\`.`)
    }
  })

  test("an approval without its text, but not one whose text is empty", () => {
    expectRefusal(
      refused([{ request: "req_1", decision: "once" }]),
      "invalid_argument",
      'An approval of request "req_1" repeats its `text`, as the read gave it.',
    )
    expect(
      planReplies([approve("req_1", "")] as ReplyInput[], [permissionPending({ id: "req_1", text: "" })]),
    ).toHaveLength(1)
  })

  test("a rejection without a reason, or with a blank one, and a declined question in the same words", () => {
    const words = (id: string) =>
      `A rejection of request "${id}" carries a \`reason\`: without one the service ends the run's turn.`
    for (const reply of [
      { request: "req_1", decision: "reject" },
      { request: "req_1", decision: "reject", reason: " \n\t " },
      { request: "req_1", decision: "reject", reason: "" },
    ]) {
      expectRefusal(refused([reply]), "invalid_argument", words("req_1"))
    }
    expectRefusal(
      refused([{ request: "form_1", decision: "reject", reason: "  " }]),
      "invalid_argument",
      words("form_1"),
    )
  })

  test("an approval of a request that can only be rejected, for each reason", () => {
    for (const [reason, words] of Object.entries(REJECT_ONLY_WORDS)) {
      const pending = permissionPending({ id: "req_1", rejectOnly: reason as keyof typeof REJECT_ONLY_WORDS })
      expectRefusal(
        refused([approve("req_1", "echo hi")], [pending]),
        "forbidden",
        `Request "req_1" can only be rejected: ${words}`,
        { reason: "reject_only" },
      )
    }
  })

  test("an answer to a question that can only be declined", () => {
    const pending = questionPending({ id: "form_1", declineOnly: "It has a link to visit, which no tool has visited." })
    expectRefusal(
      refused([answer("form_1", { branch: "main" })], [pending]),
      "forbidden",
      'Question "form_1" can only be declined: It has a link to visit, which no tool has visited.',
      { reason: "decline_only" },
    )
  })

  test("an approval whose text is not the request's, down to a character", () => {
    for (const text of ["echo hi ", "echo  hi", "ECHO hi", "echo hi\n", ""]) {
      expectRefusal(
        refused([approve("req_1", text)]),
        "invalid_argument",
        'The `text` given for request "req_1" is not the request\'s. Read it again and repeat it exactly.',
        { reason: "text_mismatch" },
      )
    }
  })

  test("an answer that is missing or has no key", () => {
    for (const reply of [
      { request: "form_1", decision: "answer" },
      { request: "form_1", decision: "answer", answer: {} },
    ]) {
      expectRefusal(
        refused([reply]),
        "invalid_argument",
        'An answer to question "form_1" gives a value for at least one field.',
      )
    }
  })

  test("an answer the fields do not allow, with the problem", () => {
    expectRefusal(
      refused([answer("form_1", { branch: "other" })]),
      "invalid_argument",
      'The answer to question "form_1" does not fit its fields: field "branch" takes one of its options',
      { reason: "answer" },
    )
    expectRefusal(
      refused([answer("form_1", { nope: "x" })]),
      "invalid_argument",
      'The answer to question "form_1" does not fit its fields: it has no field "nope"',
      { reason: "answer" },
    )
  })

  test("a request id is quoted, so that nothing in it moves a message", () => {
    expect(refused([approve("a\nb", "x")]).message).toBe('Request "a\\nb" is not pending in this run.')
  })
})

describe("planReplies: the order of the checks", () => {
  const pending = [
    permissionPending({ id: "req_1", rejectOnly: "never_approve" }),
    QUESTION,
    permissionPending({ id: "req_2" }),
  ]

  test("goes reply by reply, all the checks of one before the next", () => {
    const first = refused([approve("req_1", "wrong"), reject("req_9")], pending)
    expect(first.details).toEqual({ reason: "reject_only" })
    expect(refused([reject("req_2"), reject("req_2"), reject("req_9")], pending).message).toContain("named twice")
    expect(refused([reject("req_2"), reject("req_9"), reject("req_2")], pending).code).toBe("not_found")
  })

  test("is named twice, then not pending, then kind, then a property, then what is missing, then what the request allows, then the text", () => {
    const steps: [Record<string, unknown>, string][] = [
      [{ request: "req_1", decision: "once", text: "wrong", reason: "r" }, "takes no `reason`"],
      [{ request: "req_1", decision: "once" }, "repeats its `text`"],
      [{ request: "req_1", decision: "once", text: "wrong" }, "can only be rejected"],
      [{ request: "req_2", decision: "once", text: "wrong" }, "is not the request's"],
      [{ request: "form_1", decision: "once", text: "x" }, "is a question"],
      [{ request: "req_2", decision: "answer", text: "x" }, "is a permission request"],
    ]
    for (const [reply, words] of steps) expect(refused([reply], pending).message).toContain(words)
    expect(refused([{ request: "req_9", decision: "once", reason: "x" }], pending).code).toBe("not_found")
    expect(refused([{ request: "form_1", decision: "answer", text: "x" }], pending).message).toContain(
      "takes no `text`",
    )
  })

  test("checks that an answer is given before that the question can be answered, and that before its fit", () => {
    const declineOnly = [questionPending({ id: "form_1", declineOnly: "link" })]
    expect(refused([{ request: "form_1", decision: "answer" }], declineOnly).message).toContain("at least one field")
    expect(refused([answer("form_1", { branch: "other" })], declineOnly).code).toBe("forbidden")
  })

  test("never refuses a rejection for what the request can only be", () => {
    const declineOnly = [questionPending({ id: "form_1", declineOnly: "link" })]
    const plan = planReplies([reject("req_1", "No."), reject("form_1", "Declined.")] as ReplyInput[], [
      ...pending,
      ...declineOnly,
    ])
    expect(plan.map((reply) => [reply.decision, reply.pending.id])).toEqual([
      ["reject", "req_1"],
      ["reject", "form_1"],
    ])
  })
})

describe("planReplies: the plan", () => {
  test("holds the replies as given, resolved against what is pending, the reason trimmed", () => {
    const question = questionPending({ id: "form_1" })
    const plan = planReplies(
      [
        reject("req_1", "  Not now.\n"),
        answer("form_1", { branch: "dev" }),
        approve("req_2", "echo ho"),
      ] as ReplyInput[],
      [PERMISSION, question, permissionPending({ id: "req_2", text: "echo ho" })],
    )
    expect(plan).toEqual([
      { decision: "reject", pending: PERMISSION, reason: "Not now." },
      { decision: "answer", pending: question, answer: { branch: "dev" } },
      { decision: "once", pending: permissionPending({ id: "req_2", text: "echo ho" }) },
    ])
  })

  test("is sent approvals and answers first, then rejections, each as given", () => {
    const pending = ["a", "b", "c", "d"].map((id) => permissionPending({ id, text: id }))
    const plan = planReplies([reject("a"), approve("b", "b"), reject("c"), approve("d", "d")] as ReplyInput[], pending)
    expect(inSendingOrder(plan).map((reply) => reply.pending.id)).toEqual(["b", "d", "a", "c"])
    expect(plan.map((reply) => reply.pending.id)).toEqual(["a", "b", "c", "d"])
  })
})
