# Kael

Super agent for video and automation.

## Orientation Docs

- `AGENTS.md`: Core instructions for any agent.
- `docs/core/START-HERE.md`: Quick onboarding index.
- `docs/planning/PROJECT-STATUS.md`: Phases, deliverables, and checklist per commit.
- `docs/architecture/README.md`: Incremental architecture by phase.
- `docs/ui/UI-GUIDE.md`: Official UI guide (vision, phases, status, and next steps).
- `docs/how-jobs-and-heartbeat-work.md`: Detailed guide for job lifecycle and heartbeat.

## Current Scope

- Local HTTP API (Fastify)
- CLI for chat and jobs operations
- Persistent session with JSONL transcript
- Decoupled engine with modes:
  - `simple` (commands only)
  - `pi` (embedded PI runtime via SDK)
  - `hybrid` (local slash commands + PI conversation with fallback)
- Shell tools in PI:
  - `exec` (shell command with timeout/background support)
  - `process` (list/poll/kill background sessions)
  - Policy and approvals persisted in `~/.kael/exec-approvals.json`
- Operational memory in PI:
  - `memory_search` (search in markdown memory)
  - `memory_get` (read segment by path/lines)
  - `memory_write` (persistence to daily/long_term targets)
- Web research in PI:
  - `web_search` (Search API-first with cited sources)
  - `web_fetch` (URL fetch with text extraction and TTL cache)
  - `web_research` (search + fetch + summary with evidence and confidence)
- Operational planner in PI:
  - `plan_create`
  - `plan_generate`
  - `plan_list`
  - `plan_update_step`
  - `plan_next`
  - `plan_execute_next`
  - `plan_reconcile`
- Async video jobs:
  - `transcode`
  - `convert_hls`
  - `capture_stream`
  - `probe_media`

## Requirements

- Node.js 22+
- ffmpeg and ffprobe in PATH

## Running

```bash
npm install
npm run check
npx tsx src/cli/index.ts init
npm run dev
```

Default server: `http://127.0.0.1:3210`

## Web UI (UI-1)

```bash
# install frontend dependencies
npm --prefix ui install

# start backend (terminal 1)
npm run dev

# start UI (terminal 2)
npm run ui:dev
```

Default UI: `http://127.0.0.1:5173` (proxy to local API at `/api`).

## CLI Commands

```bash
# initialize ~/.kael (or $KAEL_HOME)
npx tsx src/cli/index.ts init

# overwrite global config
npx tsx src/cli/index.ts init --force

# start API
npx tsx src/cli/index.ts server

# chat commands help
npx tsx src/cli/index.ts chat --message "/help"

# list jobs
npx tsx src/cli/index.ts jobs

# cancel job
npx tsx src/cli/index.ts job-cancel --id <jobId>

# list schedules
npx tsx src/cli/index.ts schedules

# create/update schedule by interval
npx tsx src/cli/index.ts schedule-upsert --id heartbeat.main --type heartbeat --interval-ms 30000

# create/update schedule by cron (5 fields)
npx tsx src/cli/index.ts schedule-upsert --id heartbeat.cron --type heartbeat --cron "*/5 * * * *"

# pause/resume schedule
npx tsx src/cli/index.ts schedule-pause --id heartbeat.main
npx tsx src/cli/index.ts schedule-resume --id heartbeat.main

# exec approvals
npx tsx src/cli/index.ts approvals --status open
npx tsx src/cli/index.ts approval-approve --id <approvalId>
npx tsx src/cli/index.ts approval-deny --id <approvalId>
```

## Chat Commands (command engine)

```text
/transcode <input> <output>
/hls <input> <playlist.m3u8> [segmentSeconds]
/capture <streamUrl> <output> [durationSeconds]
/probe <input>
/jobs
/help
```

## Endpoints

- `GET /health`
- `POST /chat` (optional: `?includeMessages=true` to include `user` and `assistant` objects)
- `GET /sessions/:sessionKey/messages`
- `GET /plans`
- `GET /plans/:planId`
- `POST /plans`
- `POST /plans/generate`
- `POST /plans/:planId/steps/:stepIndex`
- `POST /plans/:planId/execute-next`
- `POST /plans/:planId/cancel`
- `POST /plans/reconcile`
- `POST /jobs/transcode`
- `POST /jobs/hls`
- `POST /jobs/capture`
- `POST /jobs/probe`
- `GET /jobs`
- `GET /jobs/:jobId`
- `GET /jobs/:jobId/log`
- `POST /jobs/:jobId/cancel`
- `GET /exec/approvals`
- `POST /exec/approvals/:approvalId/approve`
- `POST /exec/approvals/:approvalId/deny`
- `GET /schedules`
- `GET /schedules/:scheduleId`
- `POST /schedules`
- `POST /schedules/:scheduleId/pause`
- `POST /schedules/:scheduleId/resume`

### Error Contract (standardized)

API errors follow this format:

```json
{
  "ok": false,
  "error": {
    "status": 400,
    "code": "BAD_REQUEST",
    "message": "message is required",
    "details": null,
    "requestId": "req-1"
  }
}
```

Current codes: `BAD_REQUEST`, `NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `INTERNAL_ERROR`.

### Idempotency (Phase 3)

To prevent duplicates on client retries, send header `x-idempotency-key` in:

- `POST /chat`
- `POST /jobs/transcode`
- `POST /jobs/hls`
- `POST /jobs/capture`
- `POST /jobs/probe`

If same key and same payload are repeated within TTL, API returns cached response with header `x-idempotency-replayed: true`.
If same key is reused with different payload, API returns `409`.

## Environment Configuration

- `KAEL_PORT` (default: `3210`)
- `KAEL_HOST` (default: `127.0.0.1`)
- `KAEL_DATA_DIR` (default: `./.kael-data`)
- `KAEL_ENGINE_MODE` (`simple`, `pi`, `hybrid`; default: `simple`)
- `KAEL_CONTEXT_MAX_MESSAGES` (context window for engine; default: `24`)
- `KAEL_CONTEXT_MAX_CHARS` (char limit of window; default: `12000`)
- `KAEL_PI_PROVIDER` (default: `openai`)
- `KAEL_PI_API_KEY` (optional; can be used to resolve provider credential)
- `KAEL_PI_MODEL` (default: `gpt-4o-mini`)
- `KAEL_PI_TIMEOUT_MS` (default: `45000`)
- `KAEL_PI_RETRY_ATTEMPTS` (default: `3`)
- `KAEL_PI_RETRY_BASE_MS` (default: `300`)
- `KAEL_PI_RETRY_MAX_MS` (default: `3000`)
- `KAEL_PI_RETRY_JITTER_MS` (default: `250`)
- `KAEL_SOUL_PATH` (optional; explicit path to `SOUL.md`)
- `KAEL_IDEMPOTENCY_ENABLED` (default: `true`)
- `KAEL_IDEMPOTENCY_TTL_MS` (default: `600000`)
- `KAEL_HEARTBEAT_ENABLED` (default: `true`)
- `KAEL_HEARTBEAT_INTERVAL_MS` (default: `30000`)
- `KAEL_PLANNER_RECONCILE_ENABLED` (default: `true`)
- `KAEL_PLANNER_RECONCILE_INTERVAL_MS` (default: `5000`)
- `KAEL_SCHEDULER_TICK_MS` (default: `1000`)
- `KAEL_SAFE_PATHS_ENABLED` (default: `true`)
- `KAEL_ALLOWED_PATHS` (default: `<cwd>,<dataDir>,/tmp`)
- `KAEL_MAX_JOB_ARGS` (default: `24`)
- `KAEL_MAX_CONCURRENT_JOBS` (default: `2`)
- `KAEL_JOB_TIMEOUT_MS` (default: `3600000`)
- `KAEL_JOB_KILL_GRACE_MS` (default: `3000`)
- `KAEL_EXEC_WORKSPACE_ROOT` (default: `<cwd>`)
- `KAEL_EXEC_TIMEOUT_MS` (default: `60000`)
- `KAEL_EXEC_MAX_TIMEOUT_MS` (default: `900000`)
- `KAEL_EXEC_MAX_OUTPUT_CHARS` (default: `120000`)
- `KAEL_EXEC_APPROVAL_WAIT_MS` (default: `120000`)
- `KAEL_EXEC_SECURITY` (`deny`, `allowlist`, `full`; default: `allowlist`)
- `KAEL_EXEC_ASK` (`off`, `on-miss`, `always`; default: `on-miss`)
- `KAEL_EXEC_ALLOWLIST` (csv; default includes `ls,cat,pwd,echo,grep,find,curl,ffmpeg,ffprobe,vlc`)
- `KAEL_RESEARCH_ENABLED` (`true|false`; default: `false`)
- `KAEL_RESEARCH_PROVIDER` (default: `tavily`)
- `KAEL_RESEARCH_API_KEY` (required when research enabled)
- `KAEL_RESEARCH_MAX_RESULTS` (default: `5`)
- `KAEL_RESEARCH_MAX_RESULTS_LIMIT` (default: `10`)
- `KAEL_RESEARCH_TIMEOUT_MS` (default: `12000`)
- `KAEL_RESEARCH_FETCH_MAX_CHARS` (default: `12000`)
- `KAEL_RESEARCH_FETCH_CACHE_TTL_MS` (default: `600000`)
- `KAEL_RESEARCH_FETCH_MAX_REDIRECTS` (default: `3`)
- `KAEL_RESEARCH_FETCH_MAX_RESPONSE_BYTES` (default: `2000000`)

### PI Runtime

Kael runs embedded PI via SDK using npm dependencies:
- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-ai`

No dependency on `pi` binary in PATH.

If alternative transports (local process/HTTP) are needed in future, the recommendation is to create a separate adapter and keep main `PiEngineAdapter` clean (SDK-only).

Note: Kael now loads `.env` automatically at app bootstrap.
Note: In PI mode (`pi`/`hybrid`), Kael mounts `system prompt` with `docs/core/SOUL.md` automatically (or `KAEL_SOUL_PATH`, if set).
Note: Kael applies multi-turn context window before calling PI (via `TurnOrchestrator`).
Note: Scheduler supports `intervalMs` and simple cron expression (5 fields, with `*`, `*/n` and exact values).
Note: `KAEL_ENGINE_MODE=pi|hybrid` requires `KAEL_PI_API_KEY`; invalid configs fail at startup with clear message.
Note: Shell commands outside allowlist may return `approval-pending`; control file is at `~/.kael/exec-approvals.json`.
Note: Operational memory is stored in `MEMORY.md` and `memory/YYYY-MM-DD.md` at `KAEL_EXEC_WORKSPACE_ROOT`.

## Logging & Observability

- JSON logs to `stdout`.
- HTTP events include `requestId`, route, status, and duration.
- Scheduler events include `scheduleId`, type, `durationMs`, and execution status.
- `GET /health` includes `uptimeSec` and aggregated session/job/schedule metrics.
- `GET /health` includes `metrics.runtimeJobs` (`activeJobs`, `queuedJobs`, `maxConcurrentJobs`).

## Job Execution Security

- Input/output path validation before spawn.
- Block paths outside allowed roots (when `KAEL_SAFE_PATHS_ENABLED=true`).
- Stream URL validation (`http`, `https`, `rtsp`, `rtmp`, `udp`).
- Custom arg limit and critical flag blocking in user args (`-i`, `-y`).
- Concurrency control via internal queue (`KAEL_MAX_CONCURRENT_JOBS`).
- Per-job timeout with controlled cancellation (`SIGTERM` followed by `SIGKILL` after grace period, if needed).

## E2E Test Coverage (jobs)

- `src/api/jobs.e2e.test.ts` covers:
  - security validation (path outside allowlist)
  - timeout with failure and timeout log
  - queued and running job cancellation via API

## Global Config (~/.kael)

The `init` command creates global home with:

- `~/.kael/config.json`
- `~/.kael/data`
- `~/.kael/logs`

Configuration priority order:

1. Environment variables (`KAEL_*`)
2. Global config (`~/.kael/config.json`)
3. Project local fallback
