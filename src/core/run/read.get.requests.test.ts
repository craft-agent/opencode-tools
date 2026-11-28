import { describe, expect, test } from "bun:test"
import { fakeAsk, fakeChild, fakeEnd, fakeQuestion, fakeReply, fakeRetry, fakeSession } from "../service/testing"
import { MAX_RESOURCES, MAX_WAITING_ON, MAX_WAITING_TEXT } from "./read.schemas"
import { boundRun, callsOf, readRun, runSetup } from "./read.testing"

const ID = "ses_run"

function begun(setup: ReturnType<typeof runSetup>) {
  return boundRun(setup.service, ID, { busy: setup.service.clock.now, active: true })
}

const get = (ctx: Parameters<typeof readRun>[1]) => readRun({ method: "get", session: ID }, ctx)

describe("get: what a run waits on", () => {
  test("lists a permission request with its action and resources, and a question with its title", async () => {
    const setup = runSetup()
    begun(setup)
    const request = fakeAsk(setup.service, ID, { action: "bash", resources: ["git push", "make"] })
    const form = fakeQuestion(setup.service, ID, "Which branch?")
    expect(await get(setup.ctx)).toMatchObject({
      state: "waiting",
      waiting_on: [
        { kind: "permission", id: request.id, session: ID, action: "bash", resources: ["git push", "make"] },
        { kind: "question", id: form.id, session: ID, title: "Which branch?" },
      ],
    })
    expect((await get(setup.ctx)).waiting_on![1]).not.toHaveProperty("resources")
    expect((await get(setup.ctx)).waiting_on![0]).not.toHaveProperty("title")
  })

  test("names the subagent's session under a request it asked, the run's own first", async () => {
    const setup = runSetup()
    begun(setup)
    const child = fakeChild(setup.service, ID)
    fakeQuestion(setup.service, child.id, "Child asks")
    fakeAsk(setup.service, ID, { action: "edit", resources: ["a"] })
    const sessions = (await get(setup.ctx)).waiting_on!.map((entry) => entry.session)
    expect(sessions).toEqual([ID, child.id])
  })

  test("keeps the first MAX_WAITING_ON and counts them all in waiting_total", async () => {
    const setup = runSetup()
    begun(setup)
    for (let index = 0; index < MAX_WAITING_ON + 2; index += 1) {
      fakeAsk(setup.service, ID, { action: `bash ${index}`, resources: [] })
    }
    const result = await get(setup.ctx)
    expect(result.waiting_on).toHaveLength(MAX_WAITING_ON)
    expect(result.waiting_total).toBe(MAX_WAITING_ON + 2)
    expect(result.waiting_on![0]).toMatchObject({ action: "bash 0" })
  })

  test("leaves waiting_total out when everything is listed", async () => {
    const setup = runSetup()
    begun(setup)
    for (let index = 0; index < MAX_WAITING_ON; index += 1) {
      fakeAsk(setup.service, ID, { action: "bash", resources: [] })
    }
    const result = await get(setup.ctx)
    expect(result.waiting_on).toHaveLength(MAX_WAITING_ON)
    expect(result).not.toHaveProperty("waiting_total")
  })

  test("cuts every text to MAX_WAITING_TEXT and the resources to MAX_RESOURCES, as one clean line", async () => {
    const setup = runSetup()
    begun(setup)
    const command = `echo "a\u0000b"\ncat /${"x".repeat(MAX_WAITING_TEXT)}`
    fakeAsk(setup.service, ID, {
      action: "y".repeat(MAX_WAITING_TEXT + 50),
      resources: Array.from({ length: MAX_RESOURCES + 3 }, () => command),
    })
    fakeQuestion(setup.service, ID, "z".repeat(MAX_WAITING_TEXT + 50))
    const [permission, question] = (await get(setup.ctx)).waiting_on!
    expect([...permission!.action!]).toHaveLength(MAX_WAITING_TEXT)
    expect(permission!.action).toEndWith("…")
    expect(permission!.resources).toHaveLength(MAX_RESOURCES)
    expect(permission!.resources![0]).toStartWith('echo "a b" cat /xxx')
    expect([...permission!.resources![0]!]).toHaveLength(MAX_WAITING_TEXT)
    expect([...question!.title!]).toHaveLength(MAX_WAITING_TEXT)
  })

  test("reads the pending lists of the run's own session and of each active subagent", async () => {
    const setup = runSetup()
    begun(setup)
    const child = fakeChild(setup.service, ID)
    await get(setup.ctx)
    const calls = callsOf(setup.service).filter((call) => /\/(permission|form)$/.test(call))
    expect(calls.sort()).toEqual(
      [
        `GET /api/session/${ID}/form`,
        `GET /api/session/${ID}/permission`,
        `GET /api/session/${child.id}/form`,
        `GET /api/session/${child.id}/permission`,
      ].sort(),
    )
  })
})

describe("get: what comes from the session is data", () => {
  test("a title is cleaned on to one line and cut", async () => {
    const setup = runSetup()
    begun(setup).title = `Fix\u0000 the\nbug\u202e ${"t".repeat(300)}`
    const { title } = await get(setup.ctx)
    expect(title).toStartWith("Fix  the bug  ttt")
    expect([...title!]).toHaveLength(100)
    expect(title).toEndWith("…")
  })

  test("a title that is blank once cleaned is left out", async () => {
    const setup = runSetup()
    begun(setup).title = "\u0000\n"
    expect(await get(setup.ctx)).not.toHaveProperty("title")
  })

  test("a reply keeps its line breaks and tabs, and loses what moves or reorders text", async () => {
    const setup = runSetup()
    begun(setup)
    fakeReply(setup.service, ID, "one\r\ntwo\tthree\u0000four\u202efive\u2028six")
    fakeEnd(setup.service, ID, "succeeded")
    expect((await get(setup.ctx)).result).toBe("one\ntwo\tthree four five six")
  })
})

describe("get: the retry", () => {
  const retry = { attempt: 1, at: 5000, error: { type: "provider.overloaded", message: "try\u0000 later" } }

  test("is given while the run is running, with its error cleaned", async () => {
    const setup = runSetup()
    begun(setup)
    fakeReply(setup.service, ID, "step")
    fakeRetry(setup.service, ID, retry)
    expect((await get(setup.ctx)).retry).toEqual({
      attempt: 1,
      at: 5000,
      error: { type: "provider.overloaded", message: "try  later" },
    })
  })

  test("is read from a subagent's newest assistant message too", async () => {
    const setup = runSetup()
    begun(setup)
    const child = fakeChild(setup.service, ID)
    fakeRetry(setup.service, child.id, { ...retry, attempt: 2 })
    expect((await get(setup.ctx)).retry).toMatchObject({ attempt: 2 })
  })

  test("is the one a wait would hand back when the run has several", async () => {
    const setup = runSetup()
    begun(setup)
    const child = fakeChild(setup.service, ID)
    fakeRetry(setup.service, ID, { ...retry, attempt: 1, at: 9000 })
    fakeRetry(setup.service, child.id, { ...retry, attempt: 3, at: 100 })
    expect((await get(setup.ctx)).retry).toMatchObject({ attempt: 3 })
  })

  test("is left out when the run is not running, or its newest assistant message has none", async () => {
    const setup = runSetup()
    begun(setup)
    fakeRetry(setup.service, ID, retry)
    fakeEnd(setup.service, ID, "failed", { type: "provider.overloaded", message: "gave up" })
    expect(await get(setup.ctx)).not.toHaveProperty("retry")

    const other = runSetup()
    begun(other)
    fakeReply(other.service, ID, "no retry here")
    expect(await get(other.ctx)).not.toHaveProperty("retry")
    expect(fakeSession(other.service, ID).messages).toHaveLength(1)
  })
})
