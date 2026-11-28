import type { ToolSpec } from "./core"
import { opencodeInstructionRead } from "./core/instruction/read.tool"
import { opencodeInstructionRemove } from "./core/instruction/remove.tool"
import { opencodeInstructionSet } from "./core/instruction/set.tool"
import { opencodeRequestRead } from "./core/request/read.tool"
import { opencodeRequestReply } from "./core/request/reply.tool"
import { opencodeRunFork } from "./core/run/fork.tool"
import { opencodeRunRead } from "./core/run/read.tool"
import { opencodeRunInterrupt } from "./core/run/interrupt.tool"
import { opencodeRunStart, opencodeRunStartWrite } from "./core/run/start.tool"
import { opencodeRunSteer } from "./core/run/steer.tool"
import { opencodeServiceRead } from "./core/service/read"

/** Every tool spec of the package; entry points register their tools from this list. */
export const ALL_TOOLS: ToolSpec[] = [
  opencodeServiceRead,
  opencodeRunRead,
  opencodeRunStart,
  opencodeRunStartWrite,
  opencodeRunSteer,
  opencodeRunInterrupt,
  opencodeRunFork,
  opencodeRequestRead,
  opencodeRequestReply,
  opencodeInstructionRead,
  opencodeInstructionSet,
  opencodeInstructionRemove,
]
