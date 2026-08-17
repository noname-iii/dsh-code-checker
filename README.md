# dsh-code-checker · Comprehensive Code Check Plugin

A plugin for **DeepSeek Harness**. After the AI writes code / builds a project, this plugin runs a **three-step comprehensive check** and reports every problem straight back to the AI so it can fix them, until it returns **"没有问题" (No problems)**. Optional GUI dashboard included, plus a standalone CLI and an MCP server for **Trae, Qoder, Cursor, Claude Desktop** and any other platform.

See [README.zh.md](README.zh.md) for the full documentation (中文).

## What it does

1. **Build & run check** — detect the project type (Node/Python/Rust/Go/C++/Java/.NET/static web/Electron/desktop exe), install deps, run ALL build commands, start a run probe, and collect every error. Any error → report the specific error info to the AI immediately (with file:line locations where available) and list ALL collected errors at once (later steps are skipped).
2. **Feature completeness** — extract ALL of the user's requirements from the prompt/context, then verify each one against the implementation (heuristic keyword/structure checks + optional LLM deep analysis). Missing features are collected and reported **all at once**; step 3 runs only when step 1 and step 2 both pass.
3. **Real user simulation** — operate the software like a real user (keyboard, mouse clicks/drags): web apps (and any GUI project such as a DSH plugin panel) via HTTP probes + Playwright, Windows desktop apps via UIA with real input events, CLIs via driven commands — following the user's described features (or README.md). **Any project with a GUI (user interface) MUST run the GUI simulation when steps 1–2 pass** — a GUI project never falls back to CLI simulation. Freezes, unresponsiveness, errors and crashes are recorded and reported to the AI. If clean → return "没有问题" and let the AI continue.

**Triggers (inside Harness) — two methods, both active**:

1. **Appended system-prompt section (primary; append-only, nothing existing is ever deleted or modified)**. The plugin registers a systemPrompt.section (order 180, inside the tool-guidance band) telling the AI to *call check_project after finishing code and keep fixing per the report until it returns "没有问题"*. Configurable via promptSection / promptSectionText; removed automatically when the plugin unloads.
2. **Turn-stopping auto-check with fix-recheck loop (fallback)**. Even if the AI forgets to call check_project, the plugin runs the three-step check itself at the turn-stopping checkpoint after coding turns and steers the report back to the AI (with a "fix and re-verify" instruction). New coding activity from the fix triggers the next auto-check, forming an automatic check → report → fix → re-check loop until clean, capped per user prompt (default 6) to avoid loops.

Plus the /check slash command, the check_project model tool, the GUI dashboard at http://127.0.0.1:3080/code-checker/, and **OS-level approval notifications**: when a session needs user action (e.g. deciding whether to run a command), the plugin pops a system notification on Windows/macOS/Linux showing which session, the specific command, and the run/don't-run options — while always handing the actual decision back to the Harness approval UI (`notifyApprovals: false` to disable).

## Download

> **Latest release: v0.3.0** — published on GitHub Releases with an offline tarball asset `dsh-code-checker-0.3.0.tgz`: https://github.com/noname-iii/dsh-code-checker/releases/latest

    git clone https://github.com/noname-iii/dsh-code-checker dsh-code-checker
    cd dsh-code-checker

or install straight from GitHub / npm / the release tarball as a dsh bundle:

    dsh plugin --profile web add github:noname-iii/dsh-code-checker
    dsh plugin --profile web add dsh-code-checker                     # npm package
    dsh plugin --profile web add ./dsh-code-checker-0.3.0.tgz         # offline (release asset)

The repository ships prebuilt lib/ artifacts — no dependencies or TypeScript needed to use it. Cloning/downloading to any directory works as-is.

## Install (DeepSeek Harness)

Recommended: install as a bundle, then start:

    dsh plugin --profile web add "<plugin-dir>"
    dsh web

Or mount without installing: edit examples/web-overlay.yml, replace <插件绝对路径> with the absolute path to this plugin (Windows requires the file:///D:/... form; macOS/Linux use a plain absolute path), then:

    pnpm dsh web --patch "<plugin-dir>/examples/web-overlay.yml"

## Usage

| How | Action |
|---|---|
| Automatic | Just let the AI write code / run commands — the check runs when the turn stops |
| Slash command | Type /check in the chat (optionally /check <dir> <extra requirements>) |
| Model tool | Ask the AI to call check_project |
| GUI | Open http://127.0.0.1:3080/code-checker/ |

## Configuration

Override by row id in your profile's cordis.patch.yml (all fields have defaults, see src/config.ts):

    - id: code-checker
      config:
        autoCheck: true
        maxAutoChecksPerPrompt: 6
        installDeps: true
        buildTimeoutMs: 180000
        runProbeMs: 8000
        simulate: true
        useLlm: true
        reportToAi: steer   # steer | inject | none
        gui: true
        language: zh
        cleanMessage: 没有问题
        notifyApprovals: true   # OS notification when a session needs user action

## Security

- Zero runtime dependencies (only `node:*` builtins) — minimal supply-chain surface.
- No network egress: checks run locally; reports go only to the current session's AI (optional step 2/3 LLM analysis reuses your session's own model).
- The approval notifier only OBSERVES `approval/request` and delegates with `next()` — it never auto-approves a command.
- Build/run commands and OS notification commands are invoked via argument arrays (no shell interpolation); notification text is escaped and truncated.

## Other platforms (Trae / Qoder / Cursor / Claude Desktop)

Standalone CLI:

    node <plugin-dir>/lib/cli/index.js check <project-dir> --requirements requirements.txt --json
    # exit code 0 = no problems, 1 = problems found, 2 = usage error

MCP server (native IDE integration — replace <plugin-dir>):

    {
      "mcpServers": {
        "code-checker": {
          "command": "node",
          "args": ["<plugin-dir>/lib/cli/index.js", "mcp"]
        }
      }
    }

Tools exposed: check_project, detect_project.

## try_it_out — verify your download in one minute

    powershell -ExecutionPolicy Bypass -File try_it_out/run-tests.ps1   # Windows
    bash try_it_out/run-tests.sh                                        # macOS / Linux

Runs the checker against 5 sample projects (healthy / broken build with multiple errors / missing features / step-3 simulation failure / static web) and reports pass/fail. Details: [try_it_out/README.md](try_it_out/README.md).

## Architecture (what every file does)

See the [中文 README](README.zh.md#项目架构每个文件的作用) for the annotated tree, or browse the repository: every source file carries a header comment (文件作用) explaining its role and per-line Chinese comments explaining each statement.

Short version:

- **src/** — Harness plugin layer: apply() entry (index.ts), config schema (config.ts), session tracker + turn-stopping auto-check (tracker.ts), ctx.shell/ctx.llm adapters (runner.ts), report delivery (feedback.ts), /check command (commands.ts), check_project tool (tool.ts), GUI dashboard + report store (gui.ts).
- **engine/** — framework-agnostic check engine: types, filesystem utilities, project detection, requirement extraction, step 1 (build & run), step 2 (completeness), step 3 (user simulation), report rendering, and the runCheck() orchestrator.
- **cli/** — standalone CLI + MCP stdio server for any platform (child_process adapters, OpenAI-compatible analyzer).
- **simulators/** — web-playwright.mjs (browser automation), windows-uia.ps1 (Windows desktop automation), static-server.mjs (dependency-free static server).
- **scripts/** — build.mjs (build/typecheck, skips when lib/ is fresh), gen-tsconfig.mjs (generates local type paths for development), selfcheck.mjs (full self-check).
- **tests/** — engine + harness-layer unit tests (node --test).
- **try_it_out/** — user test area: 5 sample projects + one-click runners.
- **examples/** — web / headless --patch overlay templates.
- **cordis.patch.yml / package.json** — bundle manifest and npm metadata (files whitelist decides what ships).
- **需求.txt** — this plugin's own requirements document (used by the self-check).

## Development (rebuild from source)

Users do NOT need this — lib/ ships prebuilt. Developers only:

    node scripts/gen-tsconfig.mjs          # generate local type paths (needs a deepseek-harness checkout nearby; do not commit the generated file)
    node scripts/build.mjs --typecheck     # typecheck
    node scripts/build.mjs                 # build lib/ (skipped when fresh; --force to rebuild)
    node scripts/selfcheck.mjs             # full self-check (typecheck + build + tests + requirement audit + sample simulations)

## Self-check

As requested, the plugin verifies itself: tsc typecheck + build (step 1), feature-by-feature verification against 需求.txt (step 2), and real simulations over the try_it_out samples plus a live "AI writes code → auto check → report back to AI" round-trip in a real Harness headless session (step 3). The session log shows the steered message: source plugin: dsh-code-checker, content "没有问题".

## LLM — what is it, and do I need an API key?

The LLM is the plugin's optional deep-analysis layer (steps 2 & 3 only; step 1 and the actual simulation execution never use it):

- Step 2: an LLM judges each requirement as implemented/partial/missing with evidence and fix suggestions (more accurate than the heuristic fallback).
- Step 3: an LLM can draft the simulation plan (which button to click, what to type, what to expect).

**API key by usage scenario:**

1. **Inside DeepSeek Harness — no extra key needed.** The plugin reuses the model and credentials of your current session via ctx.llm (agent options, falling back to the system default model). Zero configuration.
2. **Standalone CLI / MCP (Trae, Qoder, …) — key optional.** Everything works out of the box with the heuristic mode; set CODE_CHECK_LLM_BASE_URL / CODE_CHECK_LLM_API_KEY / CODE_CHECK_LLM_MODEL (any OpenAI-compatible endpoint) only if you want deep analysis.
3. **No LLM at all**: set useLlm: false in the config, or pass --no-llm to the CLI — zero tokens, zero keys.

> With useLlm enabled (default), each auto-check consumes a small amount of session-model tokens (one verdict request, possibly one plan request).

## FAQ

- **AI wrote code but no auto-check ran?** First confirm the plugin actually loaded: bundle installs take effect on the NEXT `dsh web` start (the plugin layer list is read at boot — a running instance never hot-loads a newly installed bundle). After restart you should see `[dsh-code-checker] dsh-code-checker loaded…` in the console and the dashboard at /code-checker/. Then all conditions must hold: the turn contained coding tool calls (write/edit/bash/pwsh/run_code, …) reaching minCodingCalls; the session is a top-level agent; autoCheck is true; auto-checks since the last user message are below maxAutoChecksPerPrompt. Check dsh --profile web --dump-config for the code-checker row and watch for [dsh-code-checker] logs.
- **How long does a check take?** Step 1 is bounded by buildTimeoutMs (180s) and runProbeMs (8s); simulations have their own timeouts. The auto-check runs inside the turn-stopping checkpoint, so the turn boundary waits briefly (usually seconds to ~1 minute).
- **Can it loop forever (check → fix → check)?** No — two guards: a re-check only fires when new coding activity happened since the last check (the AI fixing code re-arms the check; talking without coding does not), and at most maxAutoChecksPerPrompt (default 6) auto-checks run per user message; a new user message resets the counter. Model-initiated check_project calls are not capped.
- **Where do I see reports?** They are steered back to the AI, listed in the GUI at http://127.0.0.1:3080/code-checker/, and logged to the console.
- **No Playwright installed?** Web simulation falls back to HTTP probes; the other steps are unaffected.
- **Desktop simulation?** Windows only (UIA + real input events); other platforms skip with an explanation.
- **Unknown project type?** The engine runs generic static checks and notes the unknown type in the report.
- **Token cost?** Only with useLlm enabled; disable it for zero LLM cost.
- **Uninstall / disable?** dsh plugin --profile web remove dsh-code-checker removes the bundle; enabled: false or removing the row disables it; autoCheck: false keeps /check and check_project available.
- **Not working after install?** Verify the row with dsh --profile web --dump-config | findstr code-checker, restart dsh web, check console logs, and confirm the session cwd is the project you expect (the check targets the session cwd).
- **Already installed — do I need to re-download?** Usually not: the plugin has zero runtime dependencies, so a git pull (clone installs) or re-running `dsh plugin add` with the new version updates in place; the release tarball is only for offline machines. Compare package.json's `version` against https://github.com/noname-iii/dsh-code-checker/releases/latest, and restart dsh web after updating.
- **Quick sanity check?** Run try_it_out/run-tests.ps1 (or .sh): healthy → "没有问题", broken build → error report, missing features → all missing features listed at once.
- **Port conflicts?** The web simulation only probes local loopback ports (5173/3000/8080/4173, …) and never binds them.
- **Heuristic vs LLM verdicts?** LLM wins when available (heuristic as fallback/corroboration); heuristic-only mode is intentionally conservative and may treat a feature merely mentioned in comments/strings as implemented.

## Known boundaries

- The run probe judges "can run" by staying alive for the probe window; combine with step 3 for long tasks.
- Heuristic requirement checks are for fast screening; useLlm (default on) gives more accurate verdicts via the session model.
- Desktop simulation requires Windows (UIA + real mouse/keyboard). Web simulation is full browser automation where Playwright is installed, otherwise it falls back to HTTP probes.
- Auto-check counts per user message and stops after maxAutoChecksPerPrompt until the next user input, preventing fix-check loops.

## License

MIT
