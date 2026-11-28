import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { UNREADABLE_REPLY } from "./errors"
import { sessionPageOf } from "./reply"
import { diffOf, formsOf, messagesOf, newestInboxOf, permissionsOf } from "./reply.run"

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

const time = { created: 5 }
const page = (...data: unknown[]) => ({ data, cursor: {} })

describe("messagesOf", () => {
  test("reads a user, a synthetic and a system message by their text", () => {
    const rows = ["user", "synthetic", "system"].map((type) => ({
      id: "m",
      type,
      time,
      text: `${type} text`,
      extra: 1,
    }))
    expect(messagesOf(page(...rows))).toEqual([
      { type: "user", created: 5, text: "user text" },
      { type: "synthetic", created: 5, text: "synthetic text" },
      { type: "system", created: 5, text: "system text" },
    ])
  })

  test("reads an assistant message: when it completed, its text parts, its tool parts, its error and its retry", () => {
    const error = { type: "provider.error", message: "no", status: 500 }
    const row = {
      id: "m",
      type: "assistant",
      time: { created: 5, completed: 9 },
      agent: "plan",
      model: { id: "m", providerID: "p" },
      content: [
        { type: "text", text: "one" },
        { type: "reasoning", text: "hidden" },
        { type: "tool", id: "t", name: "bash", state: { status: "completed", input: {} } },
        { type: "text", text: "two" },
      ],
      error,
      retry: { attempt: 2, at: 77, error },
    }
    expect(messagesOf(page(row))).toEqual([
      {
        type: "assistant",
        created: 5,
        completed: 9,
        agent: "plan",
        text: "one\n\ntwo",
        tools: [{ name: "bash", status: "completed" }],
        error: { type: "provider.error", message: "no" },
        retry: { attempt: 2, at: 77, error: { type: "provider.error", message: "no" } },
      },
    ])
  })

  test("reads an assistant message that is still written, with nothing in it", () => {
    const row = { type: "assistant", time, agent: "plan", content: [] }
    expect(messagesOf(page(row))).toEqual([{ type: "assistant", created: 5, agent: "plan" }])
  })

  test("reads an idle message by its outcome and its error", () => {
    const rows = [
      { type: "idle", time, outcome: "failed", error: { type: "t", message: "m" } },
      { type: "idle", time, outcome: "succeeded" },
    ]
    expect(messagesOf(page(...rows))).toEqual([
      { type: "idle", created: 5, outcome: "failed", error: { type: "t", message: "m" } },
      { type: "idle", created: 5, outcome: "succeeded" },
    ])
  })

  test("reads any other message by its type and time alone", () => {
    expect(messagesOf(page({ type: "shell", time, command: "ls" }, { type: "something-new", time }))).toEqual([
      { type: "shell", created: 5 },
      { type: "something-new", created: 5 },
    ])
  })

  test("is upstream_error for a reply, or a message, of another shape", () => {
    const bad: unknown[] = [
      null,
      {},
      { data: {} },
      page({ type: "user" }),
      page({ type: "user", time }),
      page({ type: "user", time: {}, text: "x" }),
      page({ time, text: "x" }),
      page({ type: "assistant", time }),
      page({ type: "assistant", time, agent: "a", content: [{ type: "text" }] }),
      page({ type: "assistant", time, agent: "a", content: [{ type: "tool", name: "x" }] }),
      page({ type: "assistant", time, agent: "a", content: [{}] }),
      page({ type: "assistant", time, agent: "a", content: [], retry: { attempt: 1, at: 2 } }),
      page({ type: "assistant", time, agent: "a", content: [], error: { type: "t" } }),
      page({ type: "idle", time }),
      page({ type: "idle", time, outcome: "done" }),
    ]
    for (const reply of bad) unreadable(() => messagesOf(reply))
  })
})

describe("the other readers", () => {
  test("permissionsOf, formsOf, diffOf read what the handlers use", () => {
    expect(permissionsOf([{ id: "p", sessionID: "s", action: "bash", resources: ["ls"], more: 1 }])).toEqual([
      { id: "p", sessionID: "s", action: "bash", resources: ["ls"], more: 1 },
    ])
    expect(formsOf([{ id: "f", title: "Which?", fields: [] }])).toMatchObject([{ id: "f", title: "Which?" }])
    const file = { file: "a", patch: "p", additions: 1, deletions: 2, status: "added" as const }
    expect(diffOf([file])).toEqual([file])
  })

  test("are upstream_error for a reply of another shape", () => {
    unreadable(() => permissionsOf([{ id: "", action: "bash", resources: [] }]))
    unreadable(() => permissionsOf([{ id: "p", action: "bash", resources: "ls" }]))
    unreadable(() => permissionsOf({ data: [] }))
    unreadable(() => formsOf([{ id: "f" }]))
    unreadable(() => diffOf([{ file: "a", patch: "p", additions: 1, deletions: 0, status: "renamed" }]))
    unreadable(() => diffOf([{ file: "a", additions: 1, deletions: 0, status: "added" }]))
  })

  test("newestInboxOf is when the newest item was created, and nothing for an empty inbox", () => {
    expect(newestInboxOf([])).toBeUndefined()
    expect(newestInboxOf([{ time: { created: 3 } }, { time: { created: 9 } }, { time: { created: 4 } }])).toBe(9)
    unreadable(() => newestInboxOf([{ time: {} }]))
    unreadable(() => newestInboxOf("none"))
  })

  test("sessionPageOf gives the sessions and the cursor of the next page, which the last page has none of", () => {
    const row = { id: "s", projectID: "p", location: { directory: "/d" }, time: { created: 1, updated: 2 } }
    expect(sessionPageOf({ data: [row], cursor: { next: "c1" } })).toMatchObject({
      next: "c1",
      sessions: [{ id: "s" }],
    })
    for (const cursor of [{}, { next: null }, { next: "" }]) {
      expect(sessionPageOf({ data: [row], cursor })).not.toHaveProperty("next")
    }
    unreadable(() => sessionPageOf({ data: [row] }))
    unreadable(() => sessionPageOf({ data: [{ id: "s" }], cursor: {} }))
  })
})
