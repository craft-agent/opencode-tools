import { describe, expect, test } from "bun:test"
import { MAX_LISTED, MAX_NAME, MAX_VARIANTS } from "./schemas"
import { CWD, failure, modelLike, read, setup, variantsOf } from "./read.testing"
import type { FakeServiceState } from "./testing"

const PROVIDERS: FakeServiceState["providers"] = [
  { id: "acme", name: "Acme", activation: "enabled", package: "acme-sdk" },
  { id: "globex", name: "Globex", activation: "enabled", package: "globex-sdk" },
  { id: "unused", name: "Unused", activation: "enabled", package: "unused-sdk" },
]

describe("providers", () => {
  test("lists the providers with the number of their models", async () => {
    const { service, ctx } = setup({
      state: {
        providers: PROVIDERS,
        models: [
          modelLike("model-1"),
          modelLike("model-2"),
          modelLike("model-3", { providerID: "globex" }),
          modelLike("model-4", { providerID: "somewhere-else" }),
        ],
      },
    })
    expect(await read({ method: "providers" }, ctx)).toEqual({
      method: "providers",
      service_started: false,
      directory: CWD,
      providers: [
        { id: "acme", name: "Acme", models: 2 },
        { id: "globex", name: "Globex", models: 1 },
        { id: "unused", name: "Unused", models: 0 },
      ],
      total: 3,
      truncated: false,
    })
    const queried = service.requests.filter((request) => request.path !== "/api/info")
    expect([...new Set(queried.map((request) => request.path))].sort()).toEqual([
      "/api/model",
      "/api/plugin",
      "/api/provider",
    ])
    for (const request of queried) expect(request.query["location[directory]"]).toBe(CWD)
  })

  test("asks about the directory given", async () => {
    const { service, ctx } = setup()
    expect((await read({ method: "providers", directory: "/work/other" }, ctx)).directory).toBe("/work/other")
    expect(service.requests.at(-1)!.query["location[directory]"]).toBe("/work/other")
  })

  test("cuts a long name and keeps the first 100 providers", async () => {
    const providers = Array.from({ length: MAX_LISTED + 1 }, (_, index) => ({
      ...PROVIDERS[0]!,
      id: `p${index}`,
      name: "n".repeat(MAX_NAME + 10),
    }))
    const result = await read({ method: "providers" }, setup({ state: { providers, models: [] } }).ctx)
    expect(result.providers).toHaveLength(MAX_LISTED)
    expect(Array.from(result.providers![0]!.name)).toHaveLength(MAX_NAME)
    expect(result).toMatchObject({ total: MAX_LISTED + 1, truncated: true })
  })
})

describe("models", () => {
  const models = [
    modelLike("model-1", { status: "active" }),
    modelLike("model-2", { status: "beta", variants: variantsOf("low", "high") }),
    modelLike("other", { name: "Fancy Thing" }),
    modelLike("model-3", { providerID: "globex" }),
  ]
  const state = { providers: PROVIDERS, models }

  test("lists the models of the provider in the service's order, with their variants", async () => {
    const { ctx } = setup({ state })
    expect(await read({ method: "models", provider: "acme" }, ctx)).toEqual({
      method: "models",
      service_started: false,
      directory: CWD,
      provider: "acme",
      models: [
        { id: "model-1", name: "Acme model-1", status: "active", variants: [] },
        { id: "model-2", name: "Acme model-2", status: "beta", variants: ["low", "high"] },
        { id: "other", name: "Fancy Thing", status: "active", variants: [] },
      ],
      total: 3,
      truncated: false,
    })
  })

  test("never returns the provider's own model id", async () => {
    const { ctx } = setup({
      state: { providers: PROVIDERS, models: [modelLike("model-1", { modelID: "api-name-1" })] },
    })
    const result = await read({ method: "models", provider: "acme" }, ctx)
    expect(JSON.stringify(result)).not.toContain("api-name-1")
    const filtered = await read({ method: "models", provider: "acme", match: "api-name" }, ctx)
    expect(filtered.models).toEqual([])
  })

  test("match keeps the models whose id or name contains it, whatever its case", async () => {
    const { ctx } = setup({ state })
    const ids = async (match: string) =>
      (await read({ method: "models", provider: "acme", match }, ctx)).models!.map((model) => model.id)
    expect(await ids("MODEL-2")).toEqual(["model-2"])
    expect(await ids("model")).toEqual(["model-1", "model-2"])
    expect(await ids("fancy")).toEqual(["other"])
    expect(await ids("THING")).toEqual(["other"])
    expect(await ids("acme")).toEqual(["model-1", "model-2"])
    expect(await ids("nothing")).toEqual([])
    const none = await read({ method: "models", provider: "acme", match: "nothing" }, ctx)
    expect(none).toMatchObject({ total: 0, truncated: false })
  })

  test("lists at most 20 variants of a model", async () => {
    const ids = Array.from({ length: MAX_VARIANTS + 5 }, (_, index) => `v${index}`)
    const { ctx } = setup({
      state: { providers: PROVIDERS, models: [modelLike("m", { variants: variantsOf(...ids) })] },
    })
    const [model] = (await read({ method: "models", provider: "acme" }, ctx)).models!
    expect(model!.variants).toEqual(ids.slice(0, MAX_VARIANTS))
  })

  test("a provider the service can use with no models gives an empty list", async () => {
    const { ctx } = setup({ state })
    expect(await read({ method: "models", provider: "unused" }, ctx)).toMatchObject({
      provider: "unused",
      models: [],
      total: 0,
      truncated: false,
    })
  })

  test("a provider that is not listed is not_found, named quoted and cut", async () => {
    const { ctx } = setup({ state })
    const error = await failure(read({ method: "models", provider: "nope" }, ctx))
    expect(error.code).toBe("not_found")
    expect(error.message).toBe(`No provider "nope" can be used in ${CWD}; method providers lists those that can.`)
    const long = await failure(read({ method: "models", provider: "p".repeat(60), directory: "/work/other" }, ctx))
    expect(long.message).toBe(
      `No provider "${"p".repeat(40)}" can be used in /work/other; method providers lists those that can.`,
    )
  })

  test("a model of another provider is not listed under this one", async () => {
    const { ctx } = setup({ state })
    const result = await read({ method: "models", provider: "globex" }, ctx)
    expect(result.models!.map((model) => model.id)).toEqual(["model-3"])
  })

  test("keeps the first 100 and counts the matches", async () => {
    const many = Array.from({ length: MAX_LISTED + 1 }, (_, index) => modelLike(`m${index}`))
    const { ctx } = setup({ state: { providers: PROVIDERS, models: many } })
    const all = await read({ method: "models", provider: "acme" }, ctx)
    expect(all.models).toHaveLength(MAX_LISTED)
    expect(all).toMatchObject({ total: MAX_LISTED + 1, truncated: true })
    const some = await read({ method: "models", provider: "acme", match: "m10" }, ctx)
    expect(some.models!.map((model) => model.id)).toEqual(["m10", "m100"])
    expect(some).toMatchObject({ total: 2, truncated: false })
  })
})
