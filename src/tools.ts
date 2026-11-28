import type { ToolSpec } from "./core"
import { opencodeRunRead } from "./core/run/read.tool"
import { opencodeRunStart, opencodeRunStartWrite } from "./core/run/start.tool"
import { opencodeServiceRead } from "./core/service/read"

/** Every tool spec of the package; entry points register their tools from this list. */
export const ALL_TOOLS: ToolSpec[] = [opencodeServiceRead, opencodeRunRead, opencodeRunStart, opencodeRunStartWrite]
