import { describe, expect, test } from "bun:test"
import { connectService } from "../service/connect"
import type { SessionEntry } from "../service/reply"
import { createFakeService, fakeRuntime } from "../service/testing"
import { MAX_ACTIVE_READ, MAX_DEPTH, activeSessions, inRun } from "./tree"
import { seedSession } from "./start.testing"

const DIRECTORY = "/work/acme"

function entry(id: string, parentID?: string): SessionEntry {
  return { id, projectID: "p", directory: DIRECTORY, time: { created: 0, updated: 0 }, ...(parentID && { parentID }) }
}

/** A lookup over a chain of sessions `s0` (the entry) to `s<length - 1>`, each the next's child, counting its calls. */
function chain(length: number) {
  const entries = new Map(
    Array.from({ length }, (_, index) => [
      `s${index}`,
      entry(`s${index}`, index + 1 < length ? `s${index + 1}` : undefined),
    ]),
  )
  const asked: string[] = []
  return {
    first: entries.get("s0")!,
    asked,
    lookup: async (id: string) => {
      asked.push(id)
      return entries.get(id)
    },
  }
}

describe("activeSessions", () => {
  async function connection(count: number) {
    const service = createFakeService()
    for (let index = 0; index < count; index += 1) {
      seedSession(service, { id: `ses_${index}`, directory: DIRECTORY, active: true })
    }
    return { service, connected: await connectService({ runtime: fakeRuntime(service) }) }
  }

  test("reads each session the service runs", async () => {
    const { connected } = await connection(3)
    expect((await activeSessions(connected)).map((session) => session.id)).toEqual(["ses_0", "ses_1", "ses_2"])
  })

  test("leaves out a session that vanished meanwhile", async () => {
    const { service, connected } = await connection(2)
    service.state.active.push("ses_gone")
    expect((await activeSessions(connected)).map((session) => session.id)).toEqual(["ses_0", "ses_1"])
  })

  test("reads no more than MAX_ACTIVE_READ", async () => {
    const { service, connected } = await connection(MAX_ACTIVE_READ + 10)
    expect(await activeSessions(connected)).toHaveLength(MAX_ACTIVE_READ)
    const reads = service.requests.filter((request) => /\/api\/session\/ses_/.test(request.path))
    expect(reads).toHaveLength(MAX_ACTIVE_READ)
  })

  test("is empty when nothing runs", async () => {
    const { connected } = await connection(0)
    expect(await activeSessions(connected)).toEqual([])
  })
})

describe("inRun", () => {
  test("is the root itself, with no lookup", async () => {
    const { first, lookup, asked } = chain(1)
    expect(await inRun(first, "s0", lookup)).toBe(true)
    expect(asked).toEqual([])
  })

  test("follows the parents to the root", async () => {
    const { first, lookup, asked } = chain(4)
    expect(await inRun(first, "s3", lookup)).toBe(true)
    expect(asked).toEqual(["s1", "s2", "s3"])
  })

  test("is not in a run it has no parent in", async () => {
    const { first, lookup } = chain(3)
    expect(await inRun(first, "other", lookup)).toBe(false)
  })

  test("is not in a run when a parent cannot be found", async () => {
    const orphan = entry("child", "gone")
    expect(await inRun(orphan, "gone", async () => undefined)).toBe(false)
  })

  test("follows at most MAX_DEPTH parents", async () => {
    const reachable = chain(MAX_DEPTH + 1)
    expect(await inRun(reachable.first, `s${MAX_DEPTH}`, reachable.lookup)).toBe(true)
    const beyond = chain(MAX_DEPTH + 2)
    expect(await inRun(beyond.first, `s${MAX_DEPTH + 1}`, beyond.lookup)).toBe(false)
    expect(beyond.asked).toHaveLength(MAX_DEPTH)
  })

  test("ends on a chain that loops", async () => {
    const loop = new Map([
      ["a", entry("a", "b")],
      ["b", entry("b", "a")],
    ])
    expect(await inRun(loop.get("a")!, "z", async (id) => loop.get(id))).toBe(false)
  })
})
