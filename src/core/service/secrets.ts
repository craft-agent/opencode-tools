import { Buffer } from "node:buffer"
import type { ServiceEndpoint } from "../runtime"

/** A shorter text is left out, so an ordinary word is never blanked. */
const MIN_SECRET_LENGTH = 4
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const REPLACEMENT_CHARACTER = "\ufffd"
/** Text with no control or format character in it. */
const PRINTABLE = /^[^\p{C}]+$/u
const CREDENTIAL = /^\S+ (\S+)$/
const USER_SEPARATOR = ":"

/** What a header value of the form `<scheme> <token>` hides: the token, and a token that is base64 of printable text, as that text and its part after the first `:`. */
function credentialParts(value: string): string[] {
  const token = CREDENTIAL.exec(value)?.[1]
  if (token === undefined) return []
  const parts = [token]
  if (!BASE64.test(token)) return parts
  const decoded = Buffer.from(token, "base64").toString("utf8")
  if (decoded.includes(REPLACEMENT_CHARACTER) || !PRINTABLE.test(decoded)) return parts
  parts.push(decoded)
  const colon = decoded.indexOf(USER_SEPARATOR)
  if (colon !== -1) parts.push(decoded.slice(colon + 1))
  return parts
}

/**
 * What must never reach a message: the endpoint's address and its host, every
 * header value, and what each hides (a Basic credential's token, its decoded
 * text and the password after the first `:`). Texts shorter than four
 * characters are left out.
 */
export function secretsOf(endpoint: ServiceEndpoint): string[] {
  const secrets = [endpoint.url]
  try {
    secrets.push(new URL(endpoint.url).host)
  } catch {
    // An address that is no URL has no host to hide.
  }
  for (const value of Object.values(endpoint.headers ?? {})) secrets.push(value, ...credentialParts(value))
  return secrets.filter((secret) => secret.length >= MIN_SECRET_LENGTH)
}
