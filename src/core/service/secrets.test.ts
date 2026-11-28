import { describe, expect, test } from "bun:test"
import { secretsOf } from "./secrets"

const basic = (userAndPassword: string) => `Basic ${Buffer.from(userAndPassword).toString("base64")}`

describe("secretsOf", () => {
  test("names the address, its host, every header value and what a Basic credential hides", () => {
    const header = basic("acme:s3cretpw")
    const token = header.slice("Basic ".length)
    const secrets = secretsOf({
      url: "http://127.0.0.1:4096",
      headers: { authorization: header, "x-other": "value-1" },
    })
    expect(secrets).toEqual([
      "http://127.0.0.1:4096",
      "127.0.0.1:4096",
      header,
      token,
      "acme:s3cretpw",
      "s3cretpw",
      "value-1",
    ])
  })

  test("keeps a token that is not base64 of printable text, and no decoded part", () => {
    expect(secretsOf({ url: "http://service.test", headers: { authorization: "Bearer not-base64!" } })).toEqual([
      "http://service.test",
      "service.test",
      "Bearer not-base64!",
      "not-base64!",
    ])
    expect(secretsOf({ url: "http://service.test", headers: { authorization: "Basic fake" } })).toEqual([
      "http://service.test",
      "service.test",
      "Basic fake",
      "fake",
    ])
  })

  test("gives a decoded text without a colon whole, and no part after it", () => {
    const header = basic("justsecret")
    expect(secretsOf({ url: "http://service.test", headers: { authorization: header } })).toContain("justsecret")
  })

  test("leaves out texts shorter than four characters", () => {
    expect(secretsOf({ url: "x", headers: { a: "abc", b: "Basic ab:c", c: "Basic xyz" } })).toEqual([
      "Basic ab:c",
      "ab:c",
      "Basic xyz",
    ])
    expect(secretsOf({ url: "http://a", headers: { authorization: basic("u:pw") } })).toContain("http://a")
    expect(secretsOf({ url: "http://a", headers: { authorization: basic("u:pw") } })).not.toContain("pw")
  })

  test("copes with an address that is not a URL, and with no headers", () => {
    expect(secretsOf({ url: "not a url" })).toEqual(["not a url"])
    expect(secretsOf({ url: "http://service.test" })).toEqual(["http://service.test", "service.test"])
  })
})
