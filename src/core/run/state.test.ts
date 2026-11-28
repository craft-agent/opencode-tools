import { describe, expect, test } from "bun:test"
import {
  INTERRUPTED_MESSAGE,
  NO_TURN_MESSAGE,
  SETTLING_MS,
  needsInbox,
  runState,
  turnEnded,
  type StateFacts,
} from "./state"

const NOW = 10_000_000
const SECOND = 1000

/** The facts of a run that is not active and has nothing pending; `session` and the rest change what a test is about. */
function facts(overrides: Partial<Omit<StateFacts, "session">> & { session?: StateFacts["session"] } = {}): StateFacts {
  return { session: { time: { created: 0, updated: 0 } }, now: NOW, waiting: false, active: false, ...overrides }
}

/** A session whose newest turn ended `agoMs` ago with `outcome`, started a second before. */
function ended(outcome: "succeeded" | "failed" | "interrupted", agoMs = 5 * SECOND): StateFacts["session"] {
  return { outcome, time: { created: 0, updated: 0, busy: NOW - agoMs - SECOND, idle: NOW - agoMs } }
}

describe("a turn that ended", () => {
  test("gives its outcome as the state", () => {
    expect(runState(facts({ session: ended("succeeded") })).state).toBe("completed")
    expect(runState(facts({ session: ended("failed") })).state).toBe("failed")
    expect(runState(facts({ session: ended("interrupted") })).state).toBe("interrupted")
  })

  test("says nothing more than the state", () => {
    expect(runState(facts({ session: ended("interrupted") }))).toEqual({ state: "interrupted" })
    expect(runState(facts({ session: ended("succeeded") }))).toEqual({ state: "completed" })
  })

  test("is ended when its idle time equals its busy time, or when it was never busy", () => {
    const time = { created: 0, updated: 0, busy: NOW - SECOND, idle: NOW - SECOND }
    expect(runState(facts({ session: { outcome: "succeeded", time } })).state).toBe("completed")
    const neverBusy = { created: 0, updated: 0, idle: NOW - SECOND }
    expect(runState(facts({ session: { outcome: "failed", time: neverBusy } })).state).toBe("failed")
  })

  test("stays as it ended however long ago", () => {
    expect(runState(facts({ session: ended("succeeded", 30 * 24 * 60 * 60 * SECOND) })).state).toBe("completed")
  })

  test("is not ended without the outcome the service writes with its end", () => {
    const time = { created: 0, updated: 0, busy: NOW - SECOND, idle: NOW - SECOND }
    expect(turnEnded({ time })).toBe(false)
    expect(runState(facts({ session: { time } })).state).toBe("running")
  })
})

describe("precedence", () => {
  test("a pending request wins over a session that is active", () => {
    expect(runState(facts({ waiting: true, active: true })).state).toBe("waiting")
  })

  test("a pending request wins over an outcome, since a subagent may ask after its parent's turn ended", () => {
    expect(runState(facts({ waiting: true, session: ended("succeeded") })).state).toBe("waiting")
  })

  test("a session that is active wins over the outcome of the turn before, which the next turn keeps", () => {
    const previous = {
      ...ended("failed"),
      time: { created: 0, updated: 0, busy: NOW - SECOND, idle: NOW - 60 * SECOND },
    }
    expect(runState(facts({ active: true, session: previous })).state).toBe("running")
  })

  test("a session that is active wins over its own end, written a moment before it left the active set", () => {
    expect(runState(facts({ active: true, session: ended("succeeded", SECOND) })).state).toBe("running")
  })

  test("a subagent that is active after its parent's turn ended keeps the run running", () => {
    expect(runState(facts({ active: true, session: ended("succeeded", 120 * SECOND) }))).toEqual({ state: "running" })
  })
})

describe("a turn with no end", () => {
  const busyAgo = (agoMs: number): StateFacts["session"] => ({
    outcome: "succeeded",
    time: { created: 0, updated: 0, busy: NOW - agoMs, idle: NOW - agoMs - 60 * SECOND },
  })

  test("is running while its busy time is under SETTLING_MS old", () => {
    expect(runState(facts({ session: busyAgo(SETTLING_MS - 1) })).state).toBe("running")
    expect(runState(facts({ session: busyAgo(0) })).state).toBe("running")
  })

  test("is interrupted from SETTLING_MS on, with what OpenCode does about it", () => {
    expect(runState(facts({ session: busyAgo(SETTLING_MS) }))).toEqual({
      state: "interrupted",
      resumes: true,
      message: INTERRUPTED_MESSAGE,
    })
    expect(runState(facts({ session: busyAgo(SETTLING_MS + 1) })).state).toBe("interrupted")
  })

  test("with no idle time at all is read the same way", () => {
    const time = (agoMs: number) => ({ created: 0, updated: 0, busy: NOW - agoMs })
    expect(runState(facts({ session: { time: time(SETTLING_MS - 1) } })).state).toBe("running")
    expect(runState(facts({ session: { time: time(SETTLING_MS) } })).state).toBe("interrupted")
  })

  test("counts the newest inbox item as a sign of the turn", () => {
    const session = busyAgo(5 * 60 * SECOND)
    expect(runState(facts({ session, inboxCreated: NOW - (SETTLING_MS - 1) })).state).toBe("running")
    expect(runState(facts({ session, inboxCreated: NOW - SETTLING_MS })).state).toBe("interrupted")
  })

  test("is not made younger by an inbox item older than its busy time", () => {
    expect(runState(facts({ session: busyAgo(SETTLING_MS), inboxCreated: NOW - 10 * 60 * SECOND })).state).toBe(
      "interrupted",
    )
  })

  test("is running when its newest sign is in the future", () => {
    expect(runState(facts({ session: busyAgo(-5 * SECOND) })).state).toBe("running")
  })
})

describe("a session that was never busy", () => {
  const never: StateFacts["session"] = { time: { created: 0, updated: 0 } }

  test("is running while a prompt it has not taken up is under SETTLING_MS old", () => {
    expect(runState(facts({ session: never, inboxCreated: NOW - (SETTLING_MS - 1) })).state).toBe("running")
  })

  test("is unknown from SETTLING_MS on, or with an empty inbox, and says it holds no turn", () => {
    const unknown = { state: "unknown" as const, message: NO_TURN_MESSAGE }
    expect(runState(facts({ session: never, inboxCreated: NOW - SETTLING_MS }))).toEqual(unknown)
    expect(runState(facts({ session: never }))).toEqual(unknown)
  })
})

describe("needsInbox", () => {
  test("is false where something else settles the state", () => {
    const session = ended("succeeded")
    expect(needsInbox({ session, waiting: false, active: false })).toBe(false)
    expect(needsInbox({ session: { time: { created: 0, updated: 0 } }, waiting: true, active: false })).toBe(false)
    expect(needsInbox({ session: { time: { created: 0, updated: 0 } }, waiting: false, active: true })).toBe(false)
  })

  test("is true for a session that is not active and whose turn has no end, or that was never busy", () => {
    expect(needsInbox({ session: { time: { created: 0, updated: 0, busy: 1 } }, waiting: false, active: false })).toBe(
      true,
    )
    expect(needsInbox({ session: { time: { created: 0, updated: 0 } }, waiting: false, active: false })).toBe(true)
  })
})
