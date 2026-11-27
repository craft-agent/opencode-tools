import type { ErrorCode, ErrorDetails } from "../core"

/** The `error` object of a JSON error document: the code, the message, and `details` only when set. */
export function errorBody(
  code: ErrorCode,
  message: string,
  details?: Readonly<ErrorDetails>,
): { code: ErrorCode; message: string; details?: Readonly<ErrorDetails> } {
  return { code, message, ...(details !== undefined && { details }) }
}
