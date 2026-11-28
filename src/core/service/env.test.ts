import { describe, expect, test } from "bun:test"
import { SERVICE_ENV, serviceEnv } from "./env"

describe("serviceEnv", () => {
  test("keeps only the named variables that are set, in the list's order", () => {
    const env = { TZ: "UTC", HOME: "/home/x", PATH: "/bin", ACME_API_KEY: "secret", HARNESS_SESSION: "1" }
    const given = serviceEnv(env)
    expect(given).toEqual({ PATH: "/bin", HOME: "/home/x", TZ: "UTC" })
    expect(Object.keys(given)).toEqual(["PATH", "HOME", "TZ"])
  })

  test("leaves out variables that are unset or empty", () => {
    expect(serviceEnv({ PATH: "", HOME: undefined, USER: "x" })).toEqual({ USER: "x" })
  })

  test("gives nothing for an empty environment", () => {
    expect(serviceEnv({})).toEqual({})
  })

  test("names every variable once", () => {
    expect(new Set(SERVICE_ENV).size).toBe(SERVICE_ENV.length)
  })
})
