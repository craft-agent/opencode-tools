import { describe, expect, test } from "bun:test"
import { UNREADABLE_REPLY } from "./errors"
import { CWD, failure, modelLike, read, setup, variantsOf, type ReadSetup } from "./read.testing"

const JSON_HEADERS = { "content-type": "application/json" }

function check(setting: ReadSetup, role = "plan") {
  return read({ method: "ready", role }, setting.ctx)
}

function replyOf(setting: ReadSetup, path: string, body: string) {
  setting.service.failNext(path, new Response(body, { headers: JSON_HEADERS }))
}

async function unreadable(path: string, bodies: string[]) {
  for (const body of bodies) {
    const setting = setup()
    replyOf(setting, path, body)
    const error = await failure(check(setting))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(UNREADABLE_REPLY)
  }
}

describe("ready: a reply of the wrong shape is upstream_error", () => {
  test.each(["/api/agent", "/api/model"])("%s with no data, null data or a body that is not an object", (path) =>
    unreadable(path, ["{}", '{"data":null}', "[]"]),
  )

  test("the version control state with no data, null data, data without a branch or a body that is not an object", () =>
    unreadable("/api/vcs", ["{}", '{"data":null}', '{"data":{"provider":"git"}}', "[]"]))

  test("a default model that is data without an id is no model: the call fails and is never ready", () =>
    unreadable("/api/model/default", ['{"data":{}}', '{"data":5}', '{"data":{"providerID":"acme"}}', "[]"]))

  test("a default of null or none, and fields it does not read, are accepted", async () => {
    const own = setup({ state: { defaultModel: null } })
    replyOf(own, "/api/model/default", JSON.stringify({ location: { directory: CWD }, data: null, extra: true }))
    expect((await check(own)).findings!.map((finding) => finding.code)).toEqual(["no_model"])
    const absent = setup()
    replyOf(absent, "/api/model/default", JSON.stringify({ location: { directory: CWD }, extra: true }))
    expect((await check(absent)).findings!.map((finding) => finding.code)).toEqual(["no_model"])
  })
})

describe("ready: a role's model whose id holds a slash", () => {
  const models = [modelLike("group/model-1", { variants: variantsOf("high") }), modelLike("model-2")]

  test("is found as OpenCode reads it: the first slash ends the provider", async () => {
    const setting = setup({
      state: { models },
      roles: { r: { agent: "plan", policy: "write", model: "acme/group/model-1#high" } },
    })
    const result = await check(setting, "r")
    expect(result.ready).toBe(true)
    expect(result.summary).toContain("model acme/group/model-1#high,")
  })

  test("is unavailable when the service lacks it, written as it was", async () => {
    const setting = setup({
      state: { models },
      roles: { r: { agent: "plan", policy: "write", model: "acme/group/other" } },
    })
    const [finding] = (await check(setting, "r")).findings!
    expect(finding!.code).toBe("model_unavailable")
    expect(finding!.message).toContain("model acme/group/other is not a model")
  })

  test("a provider that holds a # is read before the slash", async () => {
    const setting = setup({
      state: { models: [modelLike("model-1", { providerID: "team#blue" })] },
      roles: { r: { agent: "plan", policy: "write", model: "team#blue/model-1" } },
    })
    expect((await check(setting, "r")).summary).toContain("model team#blue/model-1,")
  })
})
