import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { UNREADABLE_REPLY } from "./errors"
import { activeOf, admittedOf, infoOf, sessionOf, sessionsOf } from "./reply"

function unreadable(read: () => unknown): void {
  try {
    read()
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError)
    expect((error as ToolError).code).toBe("upstream_error")
    expect((error as ToolError).message).toBe(UNREADABLE_REPLY)
    return
  }
  throw new Error("expected the reply to be unreadable")
}

const session = {
  id: "ses_1",
  projectID: "prj_1",
  location: { directory: "/work/tree" },
  time: { created: 1, updated: 2 },
  cost: 0,
}
const rule = { action: "edit", resource: "*", effect: "deny" } as const

describe("infoOf", () => {
  test("gives the version and the scratch directory", () => {
    expect(infoOf({ version: "1.2.3", paths: { tmp: "/tmp/x" }, pid: 1 })).toEqual({ version: "1.2.3", tmp: "/tmp/x" })
  })

  test("leaves the scratch directory out when there is none or it is empty", () => {
    for (const reply of [{ version: "1" }, { version: "1", paths: {} }, { version: "1", paths: { tmp: "" } }]) {
      expect(Object.keys(infoOf(reply))).toEqual(["version"])
    }
    expect(Object.keys(infoOf({ version: "1", paths: { tmp: 5 } }))).toEqual(["version"])
  })

  test("refuses a reply without a text version", () => {
    for (const reply of [{}, { version: 1 }, null, "1.0", []]) unreadable(() => infoOf(reply))
  })
})

describe("sessionOf", () => {
  test("reads the fields it keeps and leaves the rest out", () => {
    expect(sessionOf(session)).toEqual({
      id: "ses_1",
      projectID: "prj_1",
      directory: "/work/tree",
      time: { created: 1, updated: 2 },
    })
  })

  test("reads every optional field", () => {
    const full = {
      ...session,
      parentID: "ses_0",
      agent: "plan",
      model: { providerID: "acme", id: "m1", variant: "low" },
      permissions: [rule],
      metadata: { "opencode-tools": { v: 1, branch: null } },
      time: { created: 1, updated: 2, busy: 3, idle: 4 },
      title: "A title",
      outcome: "failed",
    }
    expect(sessionOf(full)).toEqual({
      id: "ses_1",
      parentID: "ses_0",
      projectID: "prj_1",
      agent: "plan",
      model: { providerID: "acme", id: "m1", variant: "low" },
      permissions: [rule],
      metadata: { "opencode-tools": { v: 1, branch: null } },
      directory: "/work/tree",
      time: { created: 1, updated: 2, busy: 3, idle: 4 },
      title: "A title",
      outcome: "failed",
    })
  })

  test("refuses a session of the wrong shape", () => {
    const bad: unknown[] = [
      null,
      {},
      { ...session, id: "" },
      { ...session, location: undefined },
      { ...session, location: {} },
      { ...session, time: { created: 1 } },
      { ...session, permissions: "deny" },
      { ...session, permissions: [{ action: "edit", resource: "*" }] },
      { ...session, permissions: [{ ...rule, effect: "none" }] },
      { ...session, metadata: [] },
      { ...session, outcome: "done" },
    ]
    for (const reply of bad) unreadable(() => sessionOf(reply))
  })
})

describe("sessionsOf", () => {
  test("gives every session of the page", () => {
    const reply = { data: [session, { ...session, id: "ses_2" }], cursor: { next: "c" } }
    expect(sessionsOf(reply).map((entry) => entry.id)).toEqual(["ses_1", "ses_2"])
    expect(sessionsOf({ data: [], cursor: {} })).toEqual([])
  })

  test("refuses a page with one bad row, or no list", () => {
    unreadable(() => sessionsOf({ data: [session, { ...session, id: "" }] }))
    unreadable(() => sessionsOf({ data: [session, { ...session, location: undefined }] }))
    for (const reply of [{}, { data: null }, [], null]) unreadable(() => sessionsOf(reply))
  })
})

describe("activeOf", () => {
  test("gives the ids of the running sessions", () => {
    expect(activeOf({ ses_1: { type: "running" }, ses_2: { type: "running" } })).toEqual(new Set(["ses_1", "ses_2"]))
    expect(activeOf({})).toEqual(new Set())
  })

  test("refuses what is not an object", () => {
    for (const reply of [null, undefined, [], "ses_1"]) unreadable(() => activeOf(reply))
  })
})

describe("admittedOf", () => {
  test("gives the id of the inbox item", () => {
    expect(admittedOf({ id: "msg_1", sessionID: "ses_1", type: "user" })).toBe("msg_1")
  })

  test("refuses an item without a usable id", () => {
    for (const reply of [{}, { id: "" }, { id: 5 }, null, "msg_1"]) unreadable(() => admittedOf(reply))
  })
})
