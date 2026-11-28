import { cut } from "../describe"
import { cleaned } from "../service/errors"
import { UNSAFE_CHARACTERS } from "../text"

/** A text the service sent, which is data: on one line, without anything that moves or reorders text, and cut to `limit` code points, with `…` where it was. */
export function lineOf(text: string, limit: number): string {
  return cut(cleaned(text), limit)
}

/** An error the service sent, as a result carries it. */
export function errorOf(error: { type: string; message: string }): { type: string; message: string } {
  return { type: cleaned(error.type), message: cleaned(error.message) }
}

/** A text of several lines the service sent, which is data: line breaks and tabs stay, every other character that moves or reorders text becomes a space. */
export function multilineOf(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(UNSAFE_CHARACTERS, (character) => (character === "\n" || character === "\t" ? character : " "))
}

/**
 * `multilineOf` the text, cut to `limit` code points, with `cut` saying so:
 * the text is returned as it is, and a mark inside it would be taken for its
 * own.
 */
export function blockOf(text: string, limit: number): { text: string; cut: boolean } {
  const clean = multilineOf(text)
  const points = [...clean]
  return points.length > limit ? { text: points.slice(0, limit).join(""), cut: true } : { text: clean, cut: false }
}
