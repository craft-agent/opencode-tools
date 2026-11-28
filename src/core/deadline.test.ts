import { describe, expect, test } from "bun:test"
import { DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS, WAIT_SECONDS_OPTION, startDeadline, waitSecondsOf } from "./deadline"
import { ToolError } from "./errors"
import { createFakeService, fakeRuntime } from "./service/testing"
import type { ToolOptions } from "./tool"

const MS_PER_SECOND = 1000

function waiting(value: unknown): ToolOptions {
  return { [WAIT_SECONDS_OPTION]: value } as unknown as ToolOptions
}

function started(seconds: number) {
  const runtime = fakeRuntime(createFakeService())
  return { runtime, deadline: startDeadline({ runtime, options: waiting(seconds) }) }
}

describe("waitSecondsOf", () => {
  test("is the default when the option is unset", () => {
    expect(DEFAULT_WAIT_SECONDS).toBe(50)
    expect(waitSecondsOf(undefined)).toBe(DEFAULT_WAIT_SECONDS)
    expect(waitSecondsOf({})).toBe(DEFAULT_WAIT_SECONDS)
  })

  test("is the option's value when it is a number", () => {
    expect(waitSecondsOf(waiting(5))).toBe(5)
    expect(waitSecondsOf(waiting(MAX_WAIT_SECONDS))).toBe(MAX_WAIT_SECONDS)
  })

  test("does not check bounds", () => {
    expect(waitSecondsOf(waiting(0))).toBe(0)
    expect(waitSecondsOf(waiting(100_000))).toBe(100_000)
  })

  test.each([["30"], [true], [["30"]], [{}], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "ignores %p, which is not a finite number",
    (value) => {
      expect(waitSecondsOf(waiting(value))).toBe(DEFAULT_WAIT_SECONDS)
    },
  )
})

describe("startDeadline", () => {
  test("gives the call the default time without options", () => {
    const runtime = fakeRuntime(createFakeService())
    const deadline = startDeadline({ runtime })
    expect(deadline.seconds).toBe(DEFAULT_WAIT_SECONDS)
    expect(deadline.remaining()).toBe(DEFAULT_WAIT_SECONDS * MS_PER_SECOND)
  })

  test("counts what is left on the runtime's clock, and stops at zero", () => {
    const { runtime, deadline } = started(5)
    expect(deadline.seconds).toBe(5)
    expect(deadline.remaining()).toBe(5000)
    runtime.clock.now += 1200
    expect(deadline.remaining()).toBe(3800)
    runtime.clock.now += 3800
    expect(deadline.remaining()).toBe(0)
    runtime.clock.now += 10_000
    expect(deadline.remaining()).toBe(0)
  })

  test("counts from the start, not from when it is asked", () => {
    const runtime = fakeRuntime(createFakeService())
    runtime.clock.now += 777
    const deadline = startDeadline({ runtime, options: waiting(2) })
    runtime.clock.now += 500
    expect(deadline.remaining()).toBe(1500)
  })

  test("within is the smaller of the limit and what is left", () => {
    const { runtime, deadline } = started(5)
    expect(deadline.within(1000)).toBe(1000)
    expect(deadline.within(60_000)).toBe(5000)
    runtime.clock.now += 4500
    expect(deadline.within(1000)).toBe(500)
    runtime.clock.now += 1000
    expect(deadline.within(1000)).toBe(0)
  })

  test("ended is an upstream_error that says what the call waited for", () => {
    const error = started(5).deadline.ended("the OpenCode service to start")
    expect(error).toBeInstanceOf(ToolError)
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The call's time of 5 seconds ended while it waited for the OpenCode service to start.")
  })

  test("ended says one second in the singular", () => {
    expect(started(1).deadline.ended("a reply").message).toBe(
      "The call's time of 1 second ended while it waited for a reply.",
    )
  })
})
