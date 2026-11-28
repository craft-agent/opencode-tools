import { describe, expect, test } from "bun:test"
import { UNREADABLE_REPLY } from "./errors"
import { MAX_ID, MAX_NAME, MAX_VARIANTS } from "./schemas"
import { failure, modelLike, read, setup, variantsOf } from "./read.testing"
import type { FakeServiceState } from "./testing"

const JSON_HEADERS = { "content-type": "application/json" }
const PROVIDERS: FakeServiceState["providers"] = [
  { id: "acme", name: "Acme", activation: "enabled", package: "acme-sdk" },
  { id: "globex", name: "Globex", activation: "enabled", package: "globex-sdk" },
]

describe("the size a result keeps", () => {
  const withModels = (models: ReturnType<typeof modelLike>[]) => setup({ state: { providers: PROVIDERS, models } }).ctx

  test("a model whose variants were cut makes the result truncated", async () => {
    const ids = Array.from({ length: MAX_VARIANTS + 1 }, (_, index) => `v${index}`)
    const result = await read(
      { method: "models", provider: "acme" },
      withModels([modelLike("cut", { variants: variantsOf(...ids) })]),
    )
    expect(result.models![0]!.variants).toEqual(ids.slice(0, MAX_VARIANTS))
    expect(result).toMatchObject({ total: 1, truncated: true })
    const exact = await read(
      { method: "models", provider: "acme" },
      withModels([modelLike("exact", { variants: variantsOf(...ids.slice(0, MAX_VARIANTS)) })]),
    )
    expect(exact.truncated).toBe(false)
  })

  test("a variant whose id is too long is left out of the variants, and the result is truncated", async () => {
    const result = await read(
      { method: "models", provider: "acme" },
      withModels([modelLike("m", { variants: variantsOf("low", "v".repeat(MAX_ID + 1), "high") })]),
    )
    expect(result.models![0]!.variants).toEqual(["low", "high"])
    expect(result.truncated).toBe(true)
  })

  test("a model whose id is too long is left out and counted", async () => {
    const result = await read(
      { method: "models", provider: "acme" },
      withModels([modelLike("a"), modelLike("x".repeat(MAX_ID + 1)), modelLike("b")]),
    )
    expect(result.models!.map((model) => model.id)).toEqual(["a", "b"])
    expect(result).toMatchObject({ total: 3, truncated: true })
  })

  test("a provider whose id is too long is left out and counted", async () => {
    const long = { ...PROVIDERS[0]!, id: "p".repeat(MAX_ID + 1) }
    const { ctx } = setup({ state: { providers: [PROVIDERS[0]!, long, PROVIDERS[1]!], models: [] } })
    const result = await read({ method: "providers" }, ctx)
    expect(result.providers!.map((provider) => provider.id)).toEqual(["acme", "globex"])
    expect(result).toMatchObject({ total: 3, truncated: true })
  })

  test("stops at the character budget, in order", async () => {
    const heavy = Array.from({ length: 80 }, (_, index) =>
      modelLike(`model-${index}`, {
        name: "n".repeat(MAX_NAME + 50),
        variants: variantsOf(...Array.from({ length: MAX_VARIANTS }, (__, v) => `variant-${v}-${"x".repeat(60)}`)),
      }),
    )
    const result = await read({ method: "models", provider: "acme" }, withModels(heavy))
    expect(result.models!.length).toBeGreaterThan(0)
    expect(result.models!.length).toBeLessThan(80)
    expect(result.models!.map((model) => model.id)).toEqual(heavy.slice(0, result.models!.length).map((m) => m.id))
    expect(result).toMatchObject({ total: 80, truncated: true })
  })

  test("a provider argument of the longest id a result can return is accepted, a longer one is not", async () => {
    const id = "p".repeat(MAX_ID)
    const { ctx } = setup({
      state: { providers: [{ ...PROVIDERS[0]!, id }], models: [modelLike("m", { providerID: id })] },
    })
    expect((await read({ method: "models", provider: id }, ctx)).models).toHaveLength(1)
    expect((await failure(read({ method: "models", provider: `${id}p` }, ctx))).code).toBe("invalid_argument")
  })
})

describe("a reply of the wrong shape", () => {
  const state = { providers: PROVIDERS, models: [modelLike("model-1")] }

  test.each([
    ["no data", "{}"],
    ["null data", '{"data":null}'],
  ])("%s in the providers or the models is upstream_error", async (_name, body) => {
    for (const method of ["providers", "models"] as const) {
      for (const path of ["/api/provider", "/api/model"]) {
        const { ctx, service } = setup({ state })
        service.failNext(path, new Response(body, { headers: JSON_HEADERS }))
        const error = await failure(read({ method, ...(method === "models" && { provider: "acme" }) }, ctx))
        expect(error.code).toBe("upstream_error")
        expect(error.message).toBe(UNREADABLE_REPLY)
      }
    }
  })

  test("a model without variants is upstream_error", async () => {
    const { ctx, service } = setup({ state })
    const body = JSON.stringify({ data: [{ id: "m", providerID: "acme", name: "M", status: "active" }] })
    service.failNext("/api/model", new Response(body, { headers: JSON_HEADERS }))
    expect((await failure(read({ method: "models", provider: "acme" }, ctx))).message).toBe(UNREADABLE_REPLY)
  })
})
