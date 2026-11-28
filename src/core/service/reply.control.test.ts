import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { UNREADABLE_REPLY } from "./errors"
import { inboxOf, interruptedOf, jobsOf } from "./reply.control"

function unreadable(read: () => unknown): void {
  const error = (() => {
    try {
      read()
    } catch (thrown) {
      return thrown
    }
  })()
  expect(error).toBeInstanceOf(ToolError)
  expect(error).toMatchObject({ code: "upstream_error", message: UNREADABLE_REPLY })
}

describe("interruptedOf", () => {
  test("reads whether the session was stopped", () => {
    expect(interruptedOf({ interrupted: true })).toBe(true)
    expect(interruptedOf({ interrupted: false, extra: 1 })).toBe(false)
  })

  test("refuses a reply that does not say it, or says it as another kind", () => {
    for (const reply of [{}, { interrupted: "yes" }, { data: { interrupted: true } }, null, "ok"]) {
      unreadable(() => interruptedOf(reply))
    }
  })
})

describe("inboxOf", () => {
  test("reads the id, the type and the delivery of each item, and nothing else", () => {
    const rows = [
      { id: "msg_1", type: "user", delivery: "steer", sessionID: "ses_1", payload: { text: "hi" } },
      { id: "msg_2", type: "synthetic", delivery: "queue" },
    ]
    expect(inboxOf(rows)).toEqual(rows)
    expect(inboxOf([])).toEqual([])
  })

  test("refuses an item without an id, a type or a delivery, and a reply that is not a list", () => {
    for (const reply of [
      [{ type: "user", delivery: "steer" }],
      [{ id: "", type: "user", delivery: "steer" }],
      [{ id: "msg_1", delivery: "steer" }],
      [{ id: "msg_1", type: "user" }],
      { data: [] },
    ]) {
      unreadable(() => inboxOf(reply))
    }
  })
})

describe("jobsOf", () => {
  test("reads the kind, the id, the session and the status of each job", () => {
    const rows = [
      { kind: "shell", id: "job_1", sessionID: "ses_1", status: "running", command: "pnpm dev" },
      { kind: "subagent", id: "job_2", sessionID: "ses_1", status: "running", childSessionID: "ses_2" },
    ]
    expect(jobsOf(rows)).toEqual(rows)
    expect(jobsOf([])).toEqual([])
  })

  test("refuses a job without one of them, and a reply that is not a list", () => {
    for (const reply of [
      [{ id: "job_1", sessionID: "ses_1", status: "running" }],
      [{ kind: "shell", sessionID: "ses_1", status: "running" }],
      [{ kind: "shell", id: "job_1", status: "running" }],
      [{ kind: "shell", id: "job_1", sessionID: "ses_1" }],
      { data: [] },
    ]) {
      unreadable(() => jobsOf(reply))
    }
  })
})
