import { afterEach, describe, expect, test } from "bun:test"
import { KEY_PREFIX } from "../instruction/key"
import { removeEntryOf, readEntries, setEntryOf } from "../instruction/instruction.testing"
import { failure } from "../service/read.testing"
import { fakeChild, fakeEnd, fakeJob, fakeReply, fakeSession, fakeStep } from "../service/testing"
import { interruptRun, steerTo, writesOf } from "./control.testing"
import { cleanup } from "./git.testing"
import { NOTHING_ROLLED_BACK } from "./interrupt.stop"
import { NOTE_KEY } from "./note"
import { readRun } from "./read.testing"
import { requestsTo, startReadOnly, startSetup, startWrite } from "./start.testing"

afterEach(cleanup)

const KEY = `${KEY_PREFIX}tests`

describe("a run that is driven", () => {
  test("a steer reaches the turn in flight, and a steer to the run once it has ended is refused", async () => {
    const { service, ctx } = await startSetup()
    const { session } = await startWrite({ role: "build", brief: "Make the change." }, ctx)

    const steered = await steerTo("Use the other module.", ctx, session)
    expect(steered).toMatchObject({ when: "next_step", run: { state: "running" } })
    expect(requestsTo(service, "/prompt").at(-1)!.body).toMatchObject({ delivery: "steer", resume: false })

    fakeStep(service, session)
    expect(fakeSession(service, session).messages.at(-1)).toMatchObject({
      type: "user",
      text: "Use the other module.",
    })

    fakeReply(service, session, "Done.")
    fakeEnd(service, session, "succeeded")
    const refused = await failure(steerTo("Too late.", ctx, session))
    expect([refused.code, refused.details]).toEqual(["invalid_argument", { reason: "not_running" }])
    expect(requestsTo(service, "/prompt")).toHaveLength(2)
  })

  test("an interrupt stops a subagent and a background command before the run, withdraws what it had not read, and the run stays stopped", async () => {
    const { service, ctx } = await startSetup()
    const { session } = await startWrite({ role: "build", brief: "Make the change." }, ctx)
    const child = fakeChild(service, session)
    const job = fakeJob(service, session, "pnpm dev")
    await steerTo("Use the other module.", ctx, session)

    const stopped = await interruptRun(ctx, session)
    expect(stopped).toMatchObject({
      stopped: { sessions: [child.id, session], commands: 1 },
      withdrawn: 1,
      timed_out: false,
      message: NOTHING_ROLLED_BACK,
      run: { state: "interrupted" },
    })

    const writes = writesOf(service)
    const own = writes.indexOf(`POST /api/session/${session}/interrupt`)
    expect(own).toBeGreaterThan(-1)
    expect(writes.indexOf(`POST /api/session/${child.id}/interrupt`)).toBeLessThan(own)
    expect(writes.findIndex((write) => write.includes(job.id))).toBeLessThan(own)

    expect(service.state.active).toEqual([])
    expect(service.state.jobs).toEqual([])
    expect(fakeSession(service, session).inbox.every((item) => item.type === "synthetic")).toBe(true)

    expect(await interruptRun(ctx, session)).toMatchObject({
      stopped: { sessions: [], commands: 0 },
      withdrawn: 0,
      run: { state: "interrupted" },
    })
  })

  test("a session that planned is copied and built on, and the plan stays as it was", async () => {
    const { service, ctx } = await startSetup()
    const plan = await startReadOnly({ role: "plan", brief: "Plan the fix." }, ctx)
    fakeReply(service, plan.session, "The plan.")
    fakeEnd(service, plan.session, "succeeded")

    const copy = await startWrite({ role: "build", session: plan.session, fork: true, brief: "Build it." }, ctx)
    expect(copy).toMatchObject({ new: true, forked_from: plan.session, policy: "write" })
    expect(copy.session).not.toBe(plan.session)

    expect(await readRun({ method: "get", session: copy.session }, ctx)).toMatchObject({
      forked_from: plan.session,
      role: "build",
    })
    const kept = await readRun({ method: "get", session: plan.session }, ctx)
    expect(kept).toMatchObject({ role: "plan", state: "completed" })
    expect(kept).not.toHaveProperty("forked_from")
    expect(fakeSession(service, plan.session).prompts).toHaveLength(1)
  })

  test("a standing instruction is set on a run, read back, and removed", async () => {
    const { service, ctx } = await startSetup()
    const { session } = await startWrite({ role: "build", brief: "Make the change." }, ctx)
    const put = `PUT /api/experimental/session/${session}/instructions/entries/${KEY}`

    expect(await setEntryOf(KEY, "Run the tests.", ctx, session)).toMatchObject({
      changed: true,
      replaced: false,
      when: "next_step",
    })
    const listed = await readEntries({ method: "list" }, ctx, session)
    expect(listed).toMatchObject({
      entries: [
        { key: NOTE_KEY, read_only: true },
        { key: KEY, value: "Run the tests." },
      ],
      others: 0,
    })

    expect(await setEntryOf(KEY, "Run the tests.", ctx, session)).toMatchObject({ changed: false })
    expect(writesOf(service).filter((write) => write === put)).toHaveLength(1)

    expect(await removeEntryOf(KEY, ctx, session)).toMatchObject({ removed: true })
    const after = await readEntries({ method: "list" }, ctx, session)
    expect(after.entries?.map((entry) => entry.key)).toEqual([NOTE_KEY])

    const reserved = await failure(setEntryOf(NOTE_KEY, "Mine.", ctx, session))
    expect(reserved.code).toBe("forbidden")
  })
})
