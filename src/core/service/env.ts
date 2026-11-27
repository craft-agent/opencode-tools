/** The variables a service the tools start is given, when set: what finds the person's programs and configuration, and nothing else. */
export const SERVICE_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TERM",
  "TMPDIR",
  "TZ",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
] as const

/** The part of an environment a started service is given: the `SERVICE_ENV` names that hold a non-empty value, in that order. */
export function serviceEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const given: Record<string, string> = {}
  for (const name of SERVICE_ENV) {
    const value = env[name]
    if (typeof value === "string" && value !== "") given[name] = value
  }
  return given
}
