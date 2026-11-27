# Tool conventions

The rules every tool in this package follows, so tools read alike across
domains and harnesses. Each rule carries the reason it was chosen; a change
to a rule changes this file first, with its reason.

## Names

- **Tool IDs are `<prefix>_<domain>_<verb>`**: `<prefix>_note_read` and
  `<prefix>_note_create` for a `note` domain. The prefix is `toolPrefix` in
  `src/project.ts`; it keeps a name unambiguous where a harness lists every
  tool in one namespace. When the domain has a well-known command line,
  follow its word order, so a name maps to a command anyone can look up.
- **Each part starts with a lowercase letter**, followed by lowercase
  letters and digits, as in `<prefix>_ipv6_read`. Every harness accepts
  letters, digits and `_` in a tool name; some refuse a name that starts with
  a digit, which a part's first letter rules out.
- **The same ID in every entry point.** Permission rules and skills are
  written once, and an ID is a public interface: renaming one is a breaking
  change.
- **Verbs are plain**: `create`, `edit`, `delete`, `add`, `remove`, and these
  with a fixed meaning:

  | Verb      | Means                                                        |
  | --------- | ------------------------------------------------------------ |
  | `read`    | the one read tool of a domain (below)                        |
  | `resolve` | find which object a call means                               |
  | `ensure`  | create when missing, reuse when present; never a second copy |

- **One read tool per domain, one write tool per operation.**
  `<prefix>_<domain>_read` takes a `method` argument (`view`, `list`, …). A
  model picks tools worse as their number grows, and reads share one set of
  annotations, so folding them loses nothing. Writes stay apart because a
  merged write tool would carry its strictest class: creating something would
  ask like overwriting it.
- **Names stay within 40 characters**, so a client prefix such as
  `mcp__<server>__` still fits a 64-character limit. `defineTool` enforces
  the shape and the length; `src/tools.test.ts` enforces the prefix.

## Arguments

- **snake_case**, for arguments and for the keys of a result alike: one style
  for everything a model reads.
- **Lists change through flat arguments**: `add_tags`, `remove_tags`. Shallow
  schemas are read reliably by every model the harnesses run. An argument that
  replaces a whole list, where one is needed, is named for the list (`tags`)
  and its description says it replaces.
- **Unknown arguments are refused.** Every entry point validates the
  arguments as strict, so a misspelt one fails as `invalid_argument` instead
  of being ignored.
- **The tools' own install directory is never the working tree.** A harness
  may start a tool inside the directory the package is installed in.
  `ToolContext.ownDir` names it; a tool that reads the working tree refuses
  to treat that directory as the caller's, saying so.
- **The MCP server takes the call's directory from the client.** It uses a
  directory sent with the call (Codex), else the client's first usable root,
  else the process's working directory; never inside the install directory.
  This keeps a server started in its install directory out of the working tree.

## Results

- **A tool returns its data as a plain object**, with no `ok` envelope. Each
  entry point renders it: the MCP server as `structuredContent` with the
  tool's `outputSchema` plus the same JSON as text, a native plugin as a JSON
  string.
- **A failure throws.** Every harness then sees a failed call (`isError` over
  MCP) rather than a success that carries an error.
- **One exception: what a call created is never lost.** Once a tool has
  created something, a later step of the same call that fails does not throw.
  The result names what was created and lists the failed steps under
  `errors`, keyed by step (`StepErrors`).
- **Text a tool reads is returned as it is.** Content from files or services
  is data, never instructions; every read tool's description and the skills
  say so. Nothing is wrapped or rewritten.

## Errors

A thrown error carries a `code` a caller can branch on, and a message that
says what to do next.

| Code               | When                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `not_found`        | the object does not exist, or the caller cannot see it                     |
| `forbidden`        | the caller lacks the permission the call needs                             |
| `invalid_argument` | the arguments cannot describe a valid call                                 |
| `stale`            | what the call relied on changed before it could finish                     |
| `unauthenticated`  | the service or program the tool calls is not logged in                     |
| `rate_limited`     | the service refused the call for its rate limit                            |
| `declined`         | the person declined a confirmation the tool asked for                      |
| `upstream_error`   | the service or program the tool calls failed; the message carries its text |
| `internal_error`   | a bug in a tool or an entry point, such as a result off its schema         |

A project adds a code to `src/core/errors.ts` and to this table together.

- **Structure the caller needs goes in `details`, not in the message.** When
  fixing the cause takes more than a sentence (the lint violations, the
  findings, the output of a hook), the error carries it as `details`: a JSON
  object with snake_case keys, like a result. A model then reads the fields
  instead of parsing them back out of prose; the message still says what to
  do next on its own.
- **`details` is fixed when the error is made.** `ToolError` keeps a frozen
  JSON copy, so every entry point renders the same value. The copy is what
  JSON makes of it (`undefined` is dropped, `NaN` becomes `null`), and a value
  JSON cannot write at all, such as a cycle or a `BigInt`, fails where it was
  thrown, as a bug, not where it is rendered.
- **Each entry point passes `details` on only when it is set**, so an error
  without it reads as it always did. The MCP server and the command line put
  it beside the code and the message, as `error.details`. The Hermes plugin,
  whose errors are text, appends it to `<code>: <message>` as JSON on a line
  of its own.
- The `errors` of a partial result (`StepErrors`) stay `<code>: <message>`
  strings.

## Write classes

Every tool belongs to one class, and the class sets its MCP annotations.
`openWorldHint` is `true` for every tool.

| Class             | Examples                              | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
| ----------------- | ------------------------------------- | -------------- | ----------------- | ---------------- |
| read              | view, list, resolve                   | `true`         | —                 | `true`           |
| add               | create, add                           | `false`        | `false`           | `false`          |
| idempotent change | ensure, adding a tag                  | `false`        | `false`           | `true`           |
| overwrite         | editing a body or title, removing one | `false`        | `true`            | `true`           |
| administrative    | delete, visibility, publishing        | `false`        | `true`            | `false`          |

- **Overwriting counts as destructive**: it loses what was there, and
  harnesses that confirm only destructive tools should still ask before it.
- **A tool takes the strictest class its arguments can reach.**
- **The harness confirms writes.** Every MCP client asks before it runs a
  write tool, so the tool does not ask again by default. Administrative tools
  also carry `_meta["anthropic/requiresUserInteraction"]: true`, which makes
  Claude Code ask even under an allow rule.
- **A native plugin asks the harness's own permission before every non-read
  call**, since the tools a native plugin adds pass through no harness
  approval of their own.
- **It asks for everything the call writes to.** A write tool's `targets`
  resolver names what the call writes to, as the permission rules name it
  (a path, an account, a record). Anything it cannot tell, every tool
  without a resolver, and a target holding `*` or `?` (which a harness would
  store as a pattern) is `*`, and `*` is never stored. An "always" answer then
  covers only what it named, never a write somewhere else.
- **It shows what the call carries, where the tool can say.** Targets are
  ids, so they cannot tell one kind of target from another, and the person
  decides on the text, the file or the kind of target as much as on where it
  goes. A write tool's `describe` says it. An MCP client draws the call's
  arguments in its own prompt, so the MCP server adds nothing.
- **Every native plugin's prompt has one shape**, so a person reads every
  tool's prompt the same way:

  ```text
  About to create "todo.md"

  --- Details ---

  Target: /work/tree/notes/todo.md
  Size: 42 bytes

  --- Note text ---

  # Todo
  ```

  The headline says what the agent is about to do, as its next step; the
  Details name each target on a `Target` line, then the tool's facts; the
  last section is the text the call carries, under the tool's own label. A
  section with nothing to show is left out, so a tool without `describe`
  shows its intent and its targets, and one whose targets cannot be told
  shows its intent alone. The harness names the tool beside the prompt, so
  the prompt does not repeat its id.

- **A write tool states its intent.** Besides its title, which names the
  tool wherever tools are listed, a write tool gives an `intent`: a fixed
  phrase in the headline's tone that carries no value (`About to create a
note`). The prompt shows it wherever no headline can stand: a tool without
  `describe`, a headline that is dropped, and one that gives way to keep the
  targets within the budget. A tool without an intent shows its title there.

- **The tool's words are fixed; what the call carries is data.** A model
  chooses the arguments and nothing else, and a prompt is only as good as the
  person's trust in its lines. The headline is the tool's intent, or a
  template the tool picks (`About to create {file}`) whose values the entry
  point quotes, so where the tool's words end and the call's data begins is
  always visible. A value comes from what the tool resolved, never from a
  model's account of it (the record's real name, not the name the model
  gave). The text section holds what the call writes, as it is, never a
  summary of it; a summary the tool can compute is a fact (`Size`, `Lines`).
- **Facts are short and ordered by what they decide.** A label is a noun of
  one or two words, in English like the tool's title, and a value carries
  its unit (`42 bytes`). A value with a unit or other words of the tool's is
  a template the tool picks with the values it holds (`{bytes} bytes` with
  `bytes: 42`), so the unit is the tool's word and the number the call's
  data; the tool picks the English form for the count (`{bytes} byte` for
  one), and numbers are shown as written, without digit grouping. A plain
  string value has no words of the tool's. The fact that changes the person's answer comes
  first (the kind of target, whether it overwrites); amounts come last. A
  fact never repeats the headline or a target. `src/core/facts.ts` holds the
  facts every package can use (`sizeFact`); a package adds its own beside its
  tools in the same form and lists them in its section below.
- **The head of the prompt comes first and fits; the text comes last.** Some
  harnesses cut a prompt from its end at a few hundred characters, so the
  headline, the targets and the facts are kept within the budget of where the
  prompt is shown, and the text is what is cut. A headline that would push a
  target past the cut gives way to the intent, since the targets are what an
  "always" answer stores. Facts that do not fit are counted on a notice
  line, which stays even when the head alone fills the budget: a person
  must know that something was left out. The facts a description drops past
  its eighth are counted on the same line, `(+N more)` after the facts, in
  every prompt, budget or none. A description keeps a
  headline template of 120 characters with values of 80, its first eight
  facts with labels of 40 characters and values of 200 (a value template of
  200 with at most eight values, the filled value cut to 200), and a text label of
  40 with a text of 2000; anything longer is cut with `…`. Nothing in the text
  can come before the facts, since the text is the last section.
- **A cut text says how much it leaves out.** A `…` also ends many ordinary
  messages, so it alone cannot tell a person that the text goes on, or how
  far. A text cut at its 2000 characters is followed by a notice line,
  `(+N more characters)`, and a fact's value cut at its 200 by the same
  notice after it on its line, where the line still fits the budget; a value
  the budget cuts further ends in `…` alone, since what it drops is no longer
  counted in the tool's characters. N counts the code points left out of what
  the tool gave, the unit the cut counts (`(+1 more character)` for one), and
  the notice is the plugin's own words, translated like the facts' notice.
  Only the head counts towards the budget, so the text's notice is lost
  wherever the harness cuts the text, which then shows its own end mark.
- **Characters other people wrote are shown, never obeyed.** A target's name
  or a file's name can hold control, bidi and invisible characters that
  forge a line of the prompt or hide part of a value; each is shown as
  `<U+XXXX>`, and a quote inside a headline value as `\"`. Where the prompt
  renders markup, everything but the plugin's own section lines is escaped,
  so a name cannot draw a link or a mention. The budget and the escaping are
  those of the surface the harness names. A surface the harness shows as
  written, such as its own clients, gets neither. A surface it names that the
  plugin does not know is one the harness does not cut, so it gets no budget,
  but it may render markup the plugin cannot tell, so it gets the strictest
  escaping of all: an escape shown as written reads as a stray backslash,
  while a name left unescaped can draw a link or a mention. A prompt whose
  surface cannot be told gets the strictest budget and escaping of all.
- **A description never stands between a call and its approval.** A tool
  without `describe`, a `describe` that fails, returns another shape or takes
  longer than 10 s gives the prompt it would have given without one. The
  approval is asked either way, and the targets are never lost with the
  description.
- **A call no answer may let run is refused before anyone is asked.** Some
  calls are out of reach whatever the person would say, such as one naming
  an object the settings keep away from the agent; a prompt for it would
  show what it names and invite an "allow" that cannot be honored. A tool
  that can tell such a call from its arguments and settings gives a `gate`
  (see "The core contract"). Every entry point runs it before the approval
  and again before `execute`, so a refusal is the call's result, as an
  error, and no prompt is drawn: the Hermes plugin asks nothing and blocks
  the call. Unlike `targets` and `describe`, a gate
  fails closed: one that cannot tell fails the call with `internal_error`.
  Where the question itself cannot be resolved (the Hermes plugin's `target`
  fails or times out), the person is asked as before, and the run refuses
  the call after the answer. An MCP client draws its own prompt before the server sees the call, so
  there the refusal comes after the client's question, never after the run.
- **A call runs on what its prompt showed.** What a person approves is what
  was true when the prompt was drawn; between the answer and the run, a file
  the call reads can be rewritten or a target can change kind. So a native
  plugin pins the prompt of every call whose tool has `describe`: the
  targets and the description, before translation, as one hash. The hash
  takes the description whole, before the budgets above cut it: a text past
  its 2000 characters, a value past its cut and the facts past the eighth
  are what the call carries too, so a change there is a change of the call
  even where the prompt could not show it. Right
  before the call runs, the entry point resolves both again, and a call
  whose hash differs, or whose description can no longer be told, fails with
  `stale` without running; the person is asked again on the next call. A
  call whose prompt showed no description pins nothing and runs as before,
  and so does every call of a tool without `describe`. A `describe` may also
  give `pins`, values the prompt does not show that the call must still find
  unchanged (a file's hash, beside a size that can stay the same); they go
  into the hash and nowhere else. A `describe` therefore gives the same
  answer for the same state: a value that changes on every call, such as the
  time, makes every call `stale`. The check narrows the gap between the
  answer and the run to the moment before `execute`; a tool that must close
  it entirely still checks inside `execute`. An MCP client draws the call's
  arguments, not a description, so the MCP server pins nothing.
- **The prompt speaks the language set for the harness.** A native plugin
  draws its prompt in the language of the `language` setting, else in the
  harness's own display language where it has one (Hermes's
  `display.language`), else in English. No harness tells a plugin who
  approves a call, so this is the language set where the plugin runs, not
  each person's. The server's locale (`LANG`) is never read: it is the
  machine's, and a person reading English on a machine set to another
  language would see the prompt change. A tag matches its own table, else
  the one of its first subtag (`ja-JP` and `ja_JP` are `ja`; `zh-Hant` can
  have its own), and a language the package has no words for falls back to
  English without a word. An MCP client draws its own prompt,
  so the MCP server takes no `language`.
- **Translations are tables keyed by the English words.** The plugin's own
  words (`Details`, `Target`, `(+N more)`) and a tool's (its title, its
  intent, its headline templates, its fact labels, its value templates and its text
  label) are written in
  English in the code. Per language, a package gives one table from those
  English words to their translation (`src/words.ts`), and the entry point
  looks each word up as it draws the prompt, so a tool's code does not change.
  A translated template must hold the same placeholders as the English one
  and keep within its limits, or the English one is used, so a translation
  cannot move the line between the tool's words and the call's data. Values
  are the call's data and are never translated: a value template is looked
  up and its values filled in after (`{bytes} バイト`), and a plain string
  value stays as the tool wrote it. A translation is marked like every other
  piece of the prompt.
- **`confirm: "elicitation"` adds the tool's own form** for administrative
  tools, where the client offers form-mode elicitation. It is for people who
  switch the client's approvals off: the tool states what will happen in plain
  words and stops on anything but an accept. Where the client does not offer
  elicitation the setting adds nothing, and the harness's approval is then the
  only confirmation.
- **Annotations are hints, not a boundary.** The `read_only` setting
  (below) is what keeps writes out.

## Toolsets and settings

Every entry point takes the same settings:

- **Toolsets**: one per domain, listed in `src/project.ts` with the ones on by
  default. A small default keeps the model's choice sharp.
- **`read_only`** registers no write tool, and wins over every other setting.
- **`tools` / `exclude_tools`** add or remove single tools; an exclusion wins
  over an inclusion.
- **`confirm`** is `harness` (the default) or `elicitation`; it says who asks
  before an administrative tool acts (see "Write classes"). The default leaves
  the question to the harness, whose approval every user already knows.
- **`language`** is the language of a native plugin's approval prompt (see
  "Write classes"); unset, the prompt follows the harness's display language
  or stays in English.
- **`emoji`** maps a toolset name to the emoji the Hermes plugin shows beside
  it, merged over the package's `TOOLSET_EMOJI`; `""` shows no emoji for that
  toolset, and no other entry point shows an emoji. A value that is not a
  mapping, an entry whose value is not a string, and a name that is no toolset
  are ignored rather than refused: the setting only changes what is shown, so a
  typo must not take every tool away.
- **`require_plugins`** names the Hermes plugins the Hermes plugin's writes
  depend on, such as a guard whose `pre_tool_call` block keeps writes from
  running unattended. Hermes drops a plugin that fails to import or register
  and loads the rest, and treats a manifest's `requires_plugins` as advisory,
  so a guard can vanish with nothing to say so. While any named plugin is not
  loaded (`ctx.has_plugin` says no, or cannot be asked), every call of a tool
  that is not a read is refused before its approval is asked, so neither YOLO,
  an approvals mode of `off` nor a remembered answer lets it run, and again
  before it runs. The refusal is `forbidden` with `details.reason`
  `missing_plugin` and `details.plugins` the names missing. Reads run as
  before. The check runs on every call, not at registration, since the order
  in which Hermes loads two plugins is not the plugins' to fix. Unset or
  empty, nothing is checked. A value that is not a list of names is refused,
  like a wrong `read_only`, and the plugin then registers nothing: ignoring it
  would loosen what the person asked for. No other entry point has it.
- **Options** are the package's own settings, the ones the tools themselves
  read, listed in `options` in `src/project.ts` (and `OPTIONS` in the Hermes
  plugin's `project.py`), each mapping a snake_case name to its type (`text`,
  `boolean`, `number`, `list`, `path` or `paths`) or a declaration with
  `{ type, integer, min, max }`. `integer: true` requires a whole `number`;
  `min` and `max` bound a `number` or count the items of a `list` or `paths`.
  Only `type` is required. Its flag is the name with `_` as `-` (a
  `boolean` flag takes no value), its variable is `<envPrefix>_<NAME>`
  uppercased, and its setting in the Hermes plugin's configuration is the name
  itself. A flag wins over its variable, a setting over its variable, and a
  blank text or path or
  empty list counts as unset. A `path` is trimmed; `~` alone or followed by
  `/` (or the platform separator) stands for the home directory: `HOME` when
  it is absolute, else the account's.
  The expanded path must be absolute and reaches the tool normalized, without
  a filesystem check. A `paths` value is a list of such paths, comma-separated
  in a flag or variable and a list in the Hermes plugin's configuration; items
  are
  trimmed and blank items dropped, and none left counts as unset. Bounds
  check only a value that is given, after blanks are dropped; unset stays
  unset. Refused values are `invalid_argument`, naming the flag or variable
  and what it must be. A package should not have to check a directory
  or a limit again inside its tool. They reach a tool as `context.options`,
  keyed by name, and one that is not given is absent: a neutral default means
  unset, and the tool then does nothing extra. A tool reads an option when it
  runs, so a change applies on the next call.
- **`unattended`** says that no person can answer a question, as in a
  scheduled job, CI or a headless run; **`grants_dir`** is the `path` where
  grants and their use are kept. See "Writes no one is there to approve".

## Writes no one is there to approve

When no person can answer, a harness either refuses a write or, with its
approvals skipped, runs it with no limit at all; a host's allow rule names a
tool and at most its targets, with no expiry, no count and nothing about what
the call carries. So a person delegates, in advance, a bounded set of writes,
and every entry point checks them the same way.

- **The person decides what to delegate; the package keeps only its
  guarantees.** A person who cannot delegate a write still runs it
  unattended through the host, with no bound and no record, so a rule that
  narrows what can be delegated protects nothing and only pushes the person
  there. The package limits a grant only where the mechanism needs it: the
  expiry ceiling, that only a person's answer creates a grant, and the
  signatures, the log and the lock. Everything else (which tool, which
  targets, which bounds, how many calls) is the person's choice, shown whole
  on the consent screen.

- **A setting says that no one can be asked.** No harness tells a plugin or
  an MCP server that its questions will go unanswered, and the modes that
  skip approvals are the ones with no person in the loop, so nothing is
  inferred from them. `unattended` says it. Off, the default, nothing changes
  and grants are not read. On, a read runs as before and a write runs only
  under a live grant that covers it.
- **Every write tool can be granted; a tool may add what a grant can
  bound.** A grant over any write tool limits its targets, its rate and its
  expiry. `bounds` adds more, naming each bound with its kind: `max` (a whole
  number the call must stay at or under, such as a text's length in
  characters), `allow` (whether the call may do one thing, such as attach a
  file), `oneOf` (the values the call may use, such as DNS record types) or
  `prefix` (the paths the call's values must sit under, such as the folders
  a file may be written to, for a set of values no tool could list ahead; the
  tool declares the one character its paths split at, such as `/`).
  `measure(args, context)` gives the call's value for each: a number, a
  boolean, or one or more of the declared values or paths. A path is matched
  as the string `measure` gives, so the tool gives it in the one form its
  target reads (relative parts resolved, case and suffixes settled); the
  package reads nothing into it. A tool declares at most six bounds and a
  grant's values must fit a fact (200 characters), so the consent screen
  shows every one. A bound is a fact about the call, computed the same way
  every time, never the model's account of it, and it is checked whole, never
  cut to a budget as a prompt's facts are.
- **A grant** names one tool, its targets, a value for the bounds the person
  limits, a rate in calls per hour or none, and an expiry of at most 90 days.
  Its targets are names, or `*` alone for any target, the call's included when
  it cannot be told; a pattern beside or inside a name is refused. Its paths
  for a `prefix` are compared as given: one that is blank, holds `*` or `?`
  or ends in the separator is refused, since a pattern grants more than it
  names and a trailing separator covers nothing the person was shown (so the
  separator alone cannot be granted). A call is covered when its
  tool matches, every target it resolves is among the grant's (or the
  grant's is `*`), every bound the grant sets is met by the measured value
  (at or under a `max`, `false` or allowed for an `allow`, every value among
  a `oneOf`'s, every value one of a `prefix`'s paths or under one, the
  separator right after it, so `a/b` covers `a/b/c` but never `a/bc`, which
  only shares its characters), the grant has not expired, and, when it sets
  a rate, fewer calls than the rate ran under it in the last 60 minutes. A
  bound the grant leaves out is no limit, and the consent screen says so; a
  measure that fails or returns another shape covers nothing under a grant
  that sets a bound. Where several grants cover a call, one that names its
  targets is used before a `*` one, then the one with the fewest targets,
  then the one that sets the most bounds, then the one that expires first.
  A call counts against its grant's rate whether it succeeds or fails, and
  every call is logged whether the grant sets a rate or not.
- **Grants restrict; the host still allows.** `invoke` checks the grant
  after the gate and before `execute`, so the MCP server and the command
  line's `run` enforce it too, and the Hermes plugin's `target` checks it
  before it asks, refusing without a question.
  The harness's own permission still decides whether the call reaches the
  package at all (an allow rule, an allowed-tools list, an approve mode), so
  a grant means the same in every harness and never lets a call through
  that the host would stop.
- **A refusal says why.** It is `forbidden`, with `details.reason`.
  `person_only` (a tool only a person's own answer may run), `no_key` and
  `tampered` (a grant or the log fails its MAC) refuse every call. Otherwise
  each grant that names the tool is checked in order, `expired`, `target` (a
  target outside the grant, or one that cannot be told, under a grant that
  names its targets), `bound` (named in
  `details.bound`) and `rate`, and the reason is the one of the grant that
  passed the most checks; `no_grant` when none names the tool. The message
  says what a person would change: a new grant, or waiting for the rate.
- **A person delegates; the agent only asks.** `<prefix>_grant_create`
  takes the tool, the targets, the bounds, the rate, the days it lasts and a
  reason. It is administrative, and its prompt is the consent screen: the
  headline names the tool (and says it may write anywhere under `*`), the
  facts the rate (or no limit), the expiry and every bound the tool declares
  (`no limit` for one left out), named targets stand as targets (a prompt
  shows no target line for `*`, so the headline carries it) and the reason
  as text, and the pin makes the
  grant exactly what the prompt showed. Widening or extending one is a new
  grant. `<prefix>_grant_read` lists the grants and their use, and
  `<prefix>_grant_revoke` removes one. They form the `grants` toolset, off by
  default.
- **Only a person's answer creates a grant.** A grant that the agent could
  give itself would bound nothing. `grant_create` is marked person-only: it is
  refused while `unattended` is on, no grant ever covers a person-only tool
  nor can one be created for it, and every
  entry point keeps a standing answer from covering it: the MCP server marks it
  `requiresUserInteraction` and asks through form elicitation where the
  client offers it, whatever `confirm` says, and the Hermes plugin gives each
  call a rule key of its own. A harness run with every approval skipped asks
  about nothing, and no package can tell; the README says so for each
  harness. Revoking only narrows, so `grant_revoke` runs while `unattended`
  is on without a grant.
- **Grants and their use are signed with a key the host supplies.** The
  variable `<envPrefix>_GRANT_KEY` (at least 32 characters; a variable only,
  never a flag or a setting, so it stays out of configuration files)
  keys an HMAC-SHA256 over each grant and over a chained log of every call
  made under one: the grant, the tool, the targets, the measured values, a
  digest of the arguments, when it started and how it ended. A grant or a
  log edited outside the package fails its MAC, and nothing runs under any
  grant until a person revokes the grant that fails (`grant_read` marks it)
  or, for the log, clears the directory. Without the
  key, while `unattended` is on, no write runs and no grant can be created.
  The files are written under a lock and replaced whole, since several
  processes may run calls at once. An earlier copy put back whole, MACs
  included, is not detected; the expiry bounds what it can bring back.

## Skills

- **A skill names the toolset it documents**, under `metadata` in its
  frontmatter:

  ```yaml
  metadata:
    toolset: notes
  ```

  The Agent Skills format allows no other top-level key, and its validators
  refuse one. The value is a plain or quoted one-line scalar; any other form
  reads as no link. A folder's name never links a skill, so every entry point
  reads the link the same way without knowing the package's toolsets.

- **A native plugin registers a linked skill only when its toolset is on**:
  when the settings register at least one tool of that toolset, from the same
  selection the tools come from. A skill that describes tools the model does
  not have invites calls that fail. So `read_only`, `tools` and
  `exclude_tools` count too: a toolset whose every tool is left out takes its
  skill with it. A skill with no link is always registered.
- **Plugins that install the skill folder whole cannot follow the settings**:
  Claude Code, Codex, Grok Build and Antigravity load every skill, since the
  settings reach only the MCP server.
- **Every linked skill names one of the package's toolsets**; a test checks
  it, since a misspelt link would hide the skill wherever it is filtered.
- **A skill that works across toolsets names the one it cannot work without.**
  The link holds one toolset, and a skill linked to none would be registered
  with every tool it describes turned off. Its body says which steps to skip
  when another toolset's tools are missing, and it leans only on toolsets that
  are on by default, since the plugins that install the skill folder whole
  list it whatever the settings select.

## The core contract

- A tool spec declares its ID, description, argument schema, output schema,
  toolset and write class; every entry point derives the same metadata from
  it. A write tool also declares `targets(args, context)`, which names what
  the call writes to.
- Any tool, read or write, may declare `gate(args, context)`, which throws a
  `ToolError` (usually `not_found`, worded as for an object that does not
  exist) for a call no approval may let run, and returns otherwise. `invoke`
  runs it after the arguments are checked and before `execute`; the entry
  points also run it before they ask (see "Write classes"). It is cheap, it
  reads only what it needs to decide, and its message says no more about
  the target than the arguments already do.
- A write tool may declare `bounds` and `measure(args, context)`, which say
  what a grant over it can limit beyond its targets, rate and expiry, and
  what this call's values are (see "Writes
  no one is there to approve"). `defineTool` refuses a `measure` without
  `bounds`, a bound of an unknown kind, a `oneOf` with no values, a `prefix`
  whose separator is not one character (or is blank, `*` or `?`) and more
  than six bounds.
- `execute(args, context)` gets the working directory, an abort signal, an
  optional `ownDir` (the directory the tools are installed in, never the
  working tree), the values of the package's own settings as `options` (see
  "Toolsets and settings"; `gate`, `describe` and `targets` get them too) and
  an optional `confirm(request) => Promise<boolean>` hook.
  Nothing in it names a harness. An entry point supplies `confirm` when the
  `elicitation` setting is on; without it the harness's approval stands, and a
  tool that needs a confirmation treats a missing hook as the harness having
  approved the call.
- `src/core/` uses only the `node:*` modules and plain dependencies, never a
  runtime's own globals (`Bun.spawn`, `Bun.file`, …), so the same code runs on
  Node and on Bun. It knows no project either: names, prefixes and toolsets
  come from `src/project.ts` through the entry points.

## Programs a tool runs

- **Every program a tool runs goes through one runner** built on `exec`, with
  an explicit environment: what the program needs to find itself and
  authenticate is passed through, and nothing else, so a stray variable
  cannot redirect a call. Prompts and colors are switched off, so nothing
  waits on a person and output parses the same everywhere.
- **Every variable the tools read besides the settings is named in
  `toolVariables` in `src/project.ts`**, whether a tool reads it itself or
  passes it through to a program. Codex gives a plugin's server only a few
  basic variables (`PATH`, `HOME` and the like) and those its manifest names,
  and `pnpm run manifests` writes that list from the settings and
  `toolVariables`: a variable left out is set everywhere but in Codex.
- **Every call has a time limit**, and a call that is stopped, by that limit
  or by cancellation, has its child process killed: `SIGTERM`, then `SIGKILL`
  after two seconds. A hung program neither holds a harness forever nor
  outlives its call.
- **The runner maps the program's failures to the error codes above.**

## Tests

- Tests sit beside the code they test (`*.test.ts`) and run on `bun test`;
  CI also starts the built MCP server and command line under Node and lists
  their tools, so a runtime-only API cannot slip in unnoticed.
- No test reaches a real service. A tool that runs a program is tested
  against a fake of that program on `PATH`.
- A test file stays within about 300 lines, split by topic
  (`<name>.<topic>.test.ts`), so one commit can carry a change and its test.

## The OpenCode tools

The rules below are opencode-tools' own, on top of everything above; where one
changes a rule above, it says so. The discussion behind them is on
[#2](https://github.com/craft-agent/opencode-tools/issues/2).

### Scope

- **The tools drive OpenCode sessions from another harness.** An agent starts
  a session under a role, follows it, steers it, answers what it asks and
  reads what it did, through the person's own OpenCode service.
- **Not from OpenCode itself.** The package has no OpenCode plugin, and a run
  is denied the package's own tools. A run that could start runs would need
  rules against the chain, and inside OpenCode one session already hands work
  to another through its subagents.
- **It knows no particular setup.** No profile, model, provider account, path
  or tool of another package appears in code, defaults, messages, examples,
  tests or skills. The one default that names anything is the two roles
  below, which are OpenCode's own agents.
- **A consumer's workflow is not the package's.** Tying a run to an issue,
  keeping a person's approval beside it, a job's phases and progress file,
  saving a reply as a report and estimating what a model's funding still
  holds are one consumer's way of working. A consumer builds them from the
  general parts here: a session's instruction entries, the notes and an
  output directory.

### Terms

The settings, messages, README, skills and code use one vocabulary:

| Term           | Means                                                                      |
| -------------- | -------------------------------------------------------------------------- |
| run            | a session the tools started and bound to a caller, with its subagents      |
| turn           | one brief of a run and the work that follows, until the session is idle    |
| caller         | whoever a call is made for: an opaque text the entry point supplies        |
| role           | a name for an OpenCode agent and a policy, with an optional model and note |
| policy         | what a run may change: `read-only` or `write`                              |
| ruleset        | the permission rules the package gives a run's session                     |
| request        | what a run is paused on: a permission request or a question                |
| brief          | the message that starts or continues a run                                 |
| operating note | the instruction every run carries about how it is being driven             |

### The service

- **The service is reached through OpenCode's own client**,
  `@opencode/client`. It is typed against the API the service publishes, and
  finding the service and authenticating to it stay OpenCode's contract
  rather than a file layout or a command's output the package would have to
  track.
- **A missing service is started with a minimal environment.** A service
  keeps its starter's environment for every session it later serves, a
  person's own included. So the tools give it only what finds the person's
  programs and configuration, and never the harness's own variables.
- **OpenCode 2.4.2 is the minimum version.** Below it every tool fails as
  `upstream_error`, naming the version found and the minimum. Above it nothing
  is refused by version, and a tool whose route is missing fails alone: the
  service publishes no API version to gate on, and refusing every version not
  yet seen would break the tools at each OpenCode release.
- **Stable routes only, with one exception.** The instruction entries exist
  only as an experimental route. Where the service refuses it, the operating
  note goes at the head of the brief, and the instruction tools fail as
  `upstream_error`.
- **The README lists the versions the tools are tested against.**

### Domains and names

- **Six domains, one toolset each**:

  | Domain        | Covers                                                              | Tools                                                                                                                                      |
  | ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
  | `service`     | what the service offers, and whether a directory is ready for a run | `opencode_service_read`                                                                                                                    |
  | `run`         | starting, following, steering, stopping and copying a run           | `opencode_run_read`, `opencode_run_start`, `opencode_run_start_write`, `opencode_run_steer`, `opencode_run_interrupt`, `opencode_run_fork` |
  | `request`     | what a run is paused on, and answering it                           | `opencode_request_read`, `opencode_request_reply`                                                                                          |
  | `instruction` | the instruction entries a session keeps across turns                | `opencode_instruction_read`, `opencode_instruction_set`, `opencode_instruction_remove`                                                     |
  | `worktree`    | a worktree of its own for a write run                               | named with the domain's first tool                                                                                                         |
  | `history`     | sessions and token usage over a period                              | `opencode_history_read`                                                                                                                    |

- **On by default: `service`, `run` and `request`**, what commissioning a run
  needs. `instruction`, `worktree` and `history` are opt-in.
- **A role is the `role` argument of a start tool, never a tool of its own.**
  Tool ids are fixed when the package is built, and the manifests list them;
  roles are a person's configuration.
- **Two tools start a run, split by the role's policy.** `opencode_run_start`
  takes a role whose policy is `read-only`, and `opencode_run_start_write` one
  whose policy is `write`; each refuses the other's roles as
  `invalid_argument`, naming the tool to use. One tool for both would carry
  the write run's class, so a person could not let read-only runs start
  unasked and still be asked for each write run.
- **Waiting is a read.** `wait` is a method of `opencode_run_read`: it blocks
  and changes nothing.

### Write classes of run operations

| Operation                                | Class     | Why                                                                       |
| ---------------------------------------- | --------- | ------------------------------------------------------------------------- |
| Every domain's read, waiting included    | read      | changes nothing                                                           |
| Starting or continuing a read-only run   | add       | adds a session or a turn; its ruleset denies every edit                   |
| Steering a turn                          | add       | adds a message to a turn that is already running                          |
| Forking a session                        | add       | adds a session; the one it copies stays as it is                          |
| Starting or continuing a write run       | overwrite | the run changes files in its worktree                                     |
| Interrupting a turn                      | overwrite | the turn's work in flight is lost; interrupting twice is the same as once |
| Answering a request                      | overwrite | an approval lets a command run that may not be undone                     |
| Setting or removing an instruction entry | overwrite | replaces or removes what the session was told                             |

- **`read_only` leaves no run to start.** Starting a run creates a session
  and spends a model's usage, so it is a write whatever the run's own policy;
  with `read_only` on, the tools read the caller's runs and nothing else.
- **Every write names its run's worktree directory as its target.** An answer
  a person gives for a worktree then covers the later calls there, a
  continued session and its forks included, and nowhere else. A session id
  would make a person answer again for each fork.
- **A start's prompt shows what will run.** Its facts are the role, the
  agent, the policy, the model and whether the session is new; its text is
  the brief.
- **An answer's prompt shows what it approves.** Its text is the whole command
  or tool call of each request, never a first line: in a compound command the
  part that needs approval is often the last.
- **A grant can bound a start by role**, and a brief by its length.

### The caller

- **The tool context gains `caller`, an opaque text.** A session belongs to
  the caller that started it, and only an entry point can say who that is.
  This adds to the context under "The core contract": `src/core/` still knows
  no harness, and compares a caller only for equality.
- **Each entry point supplies it.** The Hermes plugin takes it from the
  conversation a call belongs to. The MCP server takes the `caller` setting,
  else the client's name from its initialization. The command line takes the
  `caller` setting, else `cli`.
- **A harness that cannot tell its conversations apart is one caller.** An MCP
  server over standard input serves one client and is told nothing of its
  conversations, so every conversation of that client shares its runs.
- **A session of another caller, or of none, is out of reach.** It is not
  listed, and reading, steering or answering it fails as `not_found`, worded
  as for a session that does not exist. A session with no binding is a
  person's own.
- **The binding is cooperation, not protection.** It keeps callers that use
  the tools apart. Any process that can reach the service can act on every
  session, and nothing in the package says otherwise.

### Names in shared spaces

- **The session metadata key is `opencode-tools`**, the package's name, so it
  cannot collide with another plugin's key and says whose it is. It holds `v`
  (1), `caller`, `role`, `repository` and `branch`; a domain that binds more
  adds its fields here first.
- **An instruction entry the package owns is `opencode-tools.<name>`.**
  `opencode-tools.note` is the operating note, which a caller can read and
  can neither set nor remove.

### Roles

- **`roles` maps a name to `agent`, `policy` and, optionally, `model` and
  `note`.** A name is `[a-z][a-z0-9_]{0,23}`; `agent` is a primary agent the
  service lists; `model` is written as OpenCode writes one,
  `<provider>/<model>` with an optional `#<variant>`.
- **With no `roles` configured there are two**: `plan`, OpenCode's own `plan`
  agent with the `read-only` policy, and `build`, its own `build` agent with
  the `write` policy. They are the agents every OpenCode has, so the tools
  work as installed. Configured `roles` replace both.
- **Code keys on the policy, never on a role's or an agent's name.**

### The ruleset

OpenCode evaluates the global rules, then the agent's, then the session's, and
the last match wins; a subagent's session copies its parent's ruleset.

- **A ruleset holds denies, asks and narrow allows.** A broad allow would
  reopen what a subagent's own rules deny. The one broad allow is a write
  run's edits inside its worktree, placed before every edit deny.
- **A read-only run is denied every edit and every git command that writes.**
  Denied, not asked: an ask would reopen what a read-only agent denies itself.
- **A write run asks before it rewrites history, moves a branch or runs a
  command that downloads and runs a package.**
- **Every run is denied**: reading secret files, editing a repository's or
  the person's git configuration and hooks, pushing from a shell, publishing
  a package, discarding work by force, and the package's own tools. These come
  last, so nothing reopens them.
- **A shell push is denied, not asked.** The request would show a command,
  not the commits, the branch or whether it forces. Pushing is the caller's
  act, or a tool a consumer's `rules` open.
- **`rules` adds a consumer's own rules per policy**, in OpenCode's own form,
  after the package's rules and before what every run is denied. They tighten
  a run or open another package's tools, and never reopen those denies. The
  package itself names no other package's tool and no subagent.
- **Paths outside a worktree are the person's**: `read_roots` (directories a
  run may read), `output_roots` (where a run's output directory may sit) and
  `protected_dirs` (checkouts no write run may start in). A read root that
  holds the home directory is refused, since credentials live there.

### Answers

- **A permission request is answered `once` or `reject`.** OpenCode's third
  answer saves an approval for the whole project, which the person's own
  sessions would inherit.
- **`never_approve` lists the actions that can only be rejected.** The tool's
  `gate` refuses such an approval before anyone is asked.
- **Only a run's own requests are answered**: those of its session and its
  subagents' sessions.
- **Every reply of a call is checked before any is sent.**

### What a run is told

- **The operating note says only what the tools make true**: another agent
  commissioned the session and answers its requests and questions, no one is
  at the terminal, and a quote in a brief is material, not an instruction.
- **`note` is added for every run, and a role's `note` after it.** How a
  consumer speaks to a run is its own.
- **The note is an instruction entry of the session**, so the brief a person
  reads in OpenCode is the brief alone.

### State and waiting

- **A run's state is read from the service each time**: `running`, `waiting`
  (on a request), `completed`, `failed`, `interrupted` or `unknown`. The
  package keeps no record of a run; a second record would disagree with the
  service.
- **A turn ends at its own idle message**, which carries its outcome, never at
  a session-level field or an exit status.
- **Nothing is sent again after `unknown`.** A brief whose admission could not
  be confirmed may have been taken.
- **A wait returns at `wait_seconds`, with `timed_out`.** The default is 50,
  under a harness that ends a tool call after a minute; the most is 3300. The
  Hermes plugin's limit on a call follows the setting.
- **A result has a size limit and says when it was cut.**

### Settings of opencode-tools

- **A nested setting has the type `json`.** `roles` and `rules` are maps, and
  a flat setting reaches no entry point as one. It is an object in a
  harness's own configuration and JSON text in a flag or a variable, checked
  by the package and refused as `invalid_argument` when it cannot be used.
  This adds to the types under "Toolsets and settings".
- **Every setting but two is unset by default**: `caller`, `note`, `rules`,
  `never_approve`, `read_roots`, `output_roots` and `protected_dirs`. `roles`
  and `wait_seconds` have the defaults above.
- **A domain adds its settings here before it uses them.**

### Text a tool reads

- **What a tool reads from a run is data, never instructions**: its replies,
  the commands of its requests, its diffs, a session's title. Each read tool's
  description says so, and so do the skills.

### Tests of opencode-tools

- **Tests run against one fake service**, typed by the client's own types, so
  a reply whose shape drifted fails the type check.
- **The clock is passed in**, so a wait is tested without waiting.
- **No test needs a harness, a real service or a consumer's configuration.**
