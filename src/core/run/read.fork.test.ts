import { describe, expect, test } from "bun:test"
import type { FakeSession } from "../service/testing"
import { RUN, interruptRun, liveRun, steerTo } from "./control.testing"
import { SOURCE } from "./fork.testing"
import { boundRun, readRun, runSetup } from "./read.testing"

const MESSAGE = "Use the other module."

/** Makes the session a fork of `SOURCE`, as the service reports one. */
function forked(session: FakeSession): FakeSession {
  session.fork = { sessionID: SOURCE, boundary: { type: "through", messageID: "msg_boundary" } }
  return session
}

describe("a run that is a fork", () => {
  test("says of which session in `get` and `wait`, and reads as a session that holds no turn", async () => {
    const { service, ctx } = runSetup()
    forked(boundRun(service, "ses_fork"))
    boundRun(service, "ses_plain")
    for (const method of ["get", "wait"]) {
      const fork = await readRun({ method, session: "ses_fork" }, ctx)
      expect(fork).toMatchObject({ session: "ses_fork", forked_from: SOURCE, state: "unknown" })
      expect(fork.message).toBeString()
      expect(await readRun({ method, session: "ses_plain" }, ctx)).not.toHaveProperty("forked_from")
    }
  })

  test("holds no turn though a report of its source waits in its inbox, while a prompt just admitted is a turn about to begin", async () => {
    const { service, ctx } = runSetup()
    const fork = forked(boundRun(service, "ses_fork"))
    const waiting = { sessionID: fork.id, time: { created: service.clock.now } }
    const report = { type: "synthetic", payload: { text: "Subagent cancelled" }, delivery: "steer" } as const
    fork.inbox.push({ ...waiting, ...report, id: "msg_copied" })
    expect(await readRun({ method: "get", session: fork.id }, ctx)).toMatchObject({ state: "unknown" })

    fork.inbox.push({ ...waiting, id: "msg_brief", type: "user", payload: { text: "Go on." }, delivery: "queue" })
    expect(await readRun({ method: "get", session: fork.id }, ctx)).toMatchObject({ state: "running" })
  })

  test("is listed with the session it was copied from, and another run without", async () => {
    const { service, ctx } = runSetup()
    forked(boundRun(service, "ses_fork"))
    boundRun(service, "ses_plain")
    const { runs } = await readRun({ method: "list" }, ctx)
    const byId = new Map(runs!.map((run) => [run.session, run]))
    expect(byId.get("ses_fork")?.forked_from).toBe(SOURCE)
    expect(byId.get("ses_plain")).not.toHaveProperty("forked_from")
  })

  test("is a fork in the run a steer or an interrupt returns, and a copy in no other way", async () => {
    const live = liveRun()
    forked(live.run)
    expect((await steerTo(MESSAGE, live.ctx)).run).toMatchObject({ forked_from: SOURCE })
    expect((await interruptRun(live.ctx)).run).toMatchObject({ forked_from: SOURCE })
    const plain = liveRun()
    expect((await steerTo(MESSAGE, plain.ctx, RUN)).run).not.toHaveProperty("forked_from")
  })
})
