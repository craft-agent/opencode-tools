import { describe, expect, test } from "bun:test"
import { connectService } from "../service/connect"
import { createFakeService, fakeRuntime, type FakeService } from "../service/testing"
import { rosterOf } from "./roster"
import { seedSession } from "./start.testing"
import { MAX_ACTIVE_READ } from "./tree"

const DIRECTORY = "/work/acme"

async function rosterFor(seed: (service: FakeService) => void) {
  const service = createFakeService()
  seed(service)
  const connected = await connectService({ runtime: fakeRuntime(service) })
  return { service, connected }
}

const seeded = (service: FakeService, id: string, parentID?: string, active = true) =>
  seedSession(service, { id, directory: DIRECTORY, active, ...(parentID !== undefined && { parentID }) })

const reads = (service: FakeService) =>
  service.requests.filter((request) => /\/api\/session\/ses_/.test(request.path)).map((request) => request.path)

describe("membersOf", () => {
  test("is the run's own session when it is active, then its active subagents at any depth", async () => {
    const { connected } = await rosterFor((service) => {
      seeded(service, "ses_child", "ses_root")
      seeded(service, "ses_root")
      seeded(service, "ses_grandchild", "ses_child")
      seeded(service, "ses_stranger")
      seeded(service, "ses_other_child", "ses_stranger")
    })
    const roster = rosterOf(connected)
    await roster.refresh()
    expect(await roster.membersOf("ses_root")).toEqual(["ses_root", "ses_child", "ses_grandchild"])
    expect(await roster.membersOf("ses_stranger")).toEqual(["ses_stranger", "ses_other_child"])
    expect(await roster.membersOf("ses_none")).toEqual([])
  })

  test("is the active subagents alone when the run's own session is not active", async () => {
    const { connected } = await rosterFor((service) => {
      seeded(service, "ses_root", undefined, false)
      seeded(service, "ses_child", "ses_root")
    })
    const roster = rosterOf(connected)
    await roster.refresh()
    expect(await roster.membersOf("ses_root")).toEqual(["ses_child"])
  })

  test("follows a parent that is not active through the service, once", async () => {
    const { service, connected } = await rosterFor((service) => {
      seeded(service, "ses_root", undefined, false)
      seeded(service, "ses_middle", "ses_root", false)
      seeded(service, "ses_leaf", "ses_middle")
    })
    const roster = rosterOf(connected)
    await roster.refresh()
    expect(await roster.membersOf("ses_root")).toEqual(["ses_leaf"])
    expect(await roster.membersOf("ses_root")).toEqual(["ses_leaf"])
    expect(reads(service).sort()).toEqual(["/api/session/ses_leaf", "/api/session/ses_middle", "/api/session/ses_root"])
  })

  test("counts the run's own session active even where it is past the sessions that are read", async () => {
    const { connected } = await rosterFor((service) => {
      for (let index = 0; index < MAX_ACTIVE_READ; index += 1) seeded(service, `ses_a${index}`)
      seeded(service, "ses_root")
    })
    const roster = rosterOf(connected)
    await roster.refresh()
    expect(await roster.membersOf("ses_root")).toEqual(["ses_root"])
  })
})

describe("entryOf", () => {
  test("is a session as the roster read it, the ones it was given and its ancestors included, and nothing for another", async () => {
    const { service, connected } = await rosterFor((service) => {
      seeded(service, "ses_root", undefined, false)
      seeded(service, "ses_middle", "ses_root", false)
      seeded(service, "ses_leaf", "ses_middle")
      seeded(service, "ses_idle", undefined, false)
    })
    const given = { id: "ses_given", projectID: "p", directory: DIRECTORY, time: { created: 0, updated: 0 } }
    const roster = rosterOf(connected, [given])
    expect(roster.entryOf("ses_leaf")).toBeUndefined()
    await roster.refresh()
    await roster.membersOf("ses_root")
    expect(roster.entryOf("ses_leaf")).toMatchObject({ id: "ses_leaf", parentID: "ses_middle", directory: DIRECTORY })
    expect(roster.entryOf("ses_middle")).toMatchObject({ id: "ses_middle" })
    expect(roster.entryOf("ses_given")).toBe(given)
    expect(roster.entryOf("ses_idle")).toBeUndefined()
    expect(roster.entryOf("ses_none")).toBeUndefined()
    const before = reads(service).length
    roster.entryOf("ses_leaf")
    expect(reads(service)).toHaveLength(before)
  })
})

describe("refresh", () => {
  test("reads each session of the active set once, however many times it is refreshed", async () => {
    const { service, connected } = await rosterFor((service) => {
      seeded(service, "ses_a")
      seeded(service, "ses_b")
    })
    const roster = rosterOf(connected)
    await roster.refresh()
    await roster.refresh()
    seeded(service, "ses_c")
    await roster.refresh()
    expect(reads(service).sort()).toEqual(["/api/session/ses_a", "/api/session/ses_b", "/api/session/ses_c"])
    expect(service.requests.filter((request) => request.path.endsWith("/session/active"))).toHaveLength(3)
  })

  test("does not read the sessions it is given", async () => {
    const { service, connected } = await rosterFor((service) => {
      seeded(service, "ses_a")
    })
    const entry = {
      id: "ses_a",
      projectID: "p",
      directory: DIRECTORY,
      time: { created: 0, updated: 0 },
    }
    const roster = rosterOf(connected, [entry])
    await roster.refresh()
    expect(await roster.membersOf("ses_a")).toEqual(["ses_a"])
    expect(reads(service)).toEqual([])
  })

  test("reads no more than MAX_ACTIVE_READ sessions of the active set", async () => {
    const { service, connected } = await rosterFor((service) => {
      for (let index = 0; index < MAX_ACTIVE_READ + 10; index += 1) seeded(service, `ses_${index}`)
    })
    await rosterOf(connected).refresh()
    expect(reads(service)).toHaveLength(MAX_ACTIVE_READ)
  })

  test("leaves out a session that vanished, and sees the active set as it is now", async () => {
    const { service, connected } = await rosterFor((service) => {
      seeded(service, "ses_root")
    })
    service.state.active.push("ses_gone")
    const roster = rosterOf(connected)
    await roster.refresh()
    expect(await roster.membersOf("ses_root")).toEqual(["ses_root"])
    service.state.active = []
    await roster.refresh()
    expect(await roster.membersOf("ses_root")).toEqual([])
  })
})
