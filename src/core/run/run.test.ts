import { afterEach, describe, expect, test } from "bun:test"
import { fakeEnd, fakeReply } from "../service/testing"
import { cleanup } from "./git.testing"
import { afterSleeps, readRun } from "./read.testing"
import { startReadOnly, startSetup, startWrite } from "./start.testing"

afterEach(cleanup)

describe("a run from its start to its result", () => {
  test("a read-only run starts, completes and is read back with its result", async () => {
    const { service, runtime, ctx, directory } = await startSetup()
    const started = await startReadOnly({ role: "plan", brief: "Review the diff." }, ctx)
    expect(started.state).toBe("running")

    expect((await readRun({ method: "get", session: started.session }, ctx)).state).toBe("running")

    // The turn ends while the caller waits.
    afterSleeps(runtime, (sleeps) => {
      if (sleeps !== 2) return
      fakeReply(service, started.session, "Nothing to change.")
      fakeEnd(service, started.session, "succeeded")
    })
    const waited = await readRun({ method: "wait", session: started.session }, ctx)
    expect(waited).toMatchObject({
      method: "wait",
      session: started.session,
      role: "plan",
      directory,
      branch: "main",
      state: "completed",
      result: "Nothing to change.",
      timed_out: false,
    })

    const listed = await readRun({ method: "list" }, ctx)
    expect(listed).toMatchObject({ runs: [{ session: started.session, role: "plan", state: "completed" }] })
  })

  test("the session goes on under a write role, and its new turn is the one read", async () => {
    const { service, ctx } = await startSetup()
    const first = await startReadOnly({ role: "plan", brief: "Plan the fix." }, ctx)
    fakeReply(service, first.session, "The plan.")
    fakeEnd(service, first.session, "succeeded")

    const second = await startWrite({ role: "build", session: first.session, brief: "Apply the plan." }, ctx)
    expect(second).toMatchObject({
      session: first.session,
      new: false,
      role: "build",
      policy: "write",
      state: "running",
    })
    expect((await readRun({ method: "get", session: first.session }, ctx)).state).toBe("running")

    fakeReply(service, first.session, "Applied.")
    fakeEnd(service, first.session, "succeeded")
    expect(await readRun({ method: "get", session: first.session }, ctx)).toMatchObject({
      role: "build",
      state: "completed",
      result: "Applied.",
    })
  })
})
