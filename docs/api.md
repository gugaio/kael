# API Endpoints

```mermaid
flowchart TD
    Start[Client] --> API[API Server]

    subgraph Contexts [API Contexts]
        direction TB
        
        subgraph Health ["Health (system status)"]
            direction LR
            API --> Health[GET /health]
        end

        subgraph Events ["Events (real-time)"]
            direction LR
            API --> EventsStream[GET /events/stream<br/>SSE stream]
            API --> EdgeWs[WS /ws<br/>Clark handshake]
        end

        subgraph Chat ["Chat & Sessions"]
            direction LR
            API --> ChatPOST[POST /chat]
            API --> Sessions[GET /sessions/:sessionKey/messages]
        end

        subgraph Projects ["Projects (project space)"]
            direction LR
            API --> ProjectsGET[GET /projects]
            API --> ProjectGET[GET /projects/:project]
            API --> ProjectDocsGET[GET /projects/:project/documents]
            API --> ProjectDocGET[GET /projects/:project/document]
            API --> ProjectDocPOST[POST /projects/:project/documents]
        end

        subgraph Plans ["Plans (execution)"]
            direction LR
            API --> PlansGET[GET /plans]
            API --> PlanGET[GET /plans/:planId]
            API --> PlanPOST[POST /plans]
            API --> PlanGenerate[POST /plans/generate]
            API --> PlanStep[POST /plans/:planId/steps/:stepIndex]
            API --> PlanExecute[POST /plans/:planId/execute-next]
            API --> PlanCancel[POST /plans/:planId/cancel]
            API --> PlanReconcile[POST /plans/reconcile]
        end

        subgraph Exec ["Exec (shell & approvals)"]
            direction LR
            API --> Approvals[GET /exec/approvals]
            API --> Approve[POST /exec/approvals/:approvalId/approve]
            API --> Deny[POST /exec/approvals/:approvalId/deny]
            API --> ExecSessions[GET /exec/sessions]
            API --> SessionLog[GET /exec/sessions/:sessionId/log]
        end

        subgraph MCP ["MCP (registry & approvals)"]
            direction LR
            API --> McpServers[GET /mcp/servers]
            API --> McpUpsert[POST /mcp/servers]
            API --> McpApprovals[GET /mcp/approvals]
            API --> McpApprove[POST /mcp/approvals/:approvalId/approve]
            API --> McpDeny[POST /mcp/approvals/:approvalId/deny]
        end

        subgraph Jobs ["Jobs (media processing)"]
            direction LR
            API --> JobsGET[GET /jobs]
            API --> JobGET[GET /jobs/:jobId]
            API --> JobLog[GET /jobs/:jobId/log]
            API --> JobCancel[POST /jobs/:jobId/cancel]
            API --> Transcode[POST /jobs/transcode]
            API --> HLS[POST /jobs/hls]
            API --> Capture[POST /jobs/capture]
            API --> Vlc[POST /jobs/vlc]
            API --> Probe[POST /jobs/probe]
            API --> ProbeUrl[POST /jobs/probe-url]
        end

        subgraph Streams ["Streams (clone & serve)"]
            direction LR
            API --> StreamsGET[GET /streams]
            API --> StreamsId[GET /streams/:originId]
            API --> StreamsClone[POST /streams/clone]
            API --> StreamsServe[POST /streams/:originId/serve]
            API --> StreamsStop[POST /streams/:originId/stop]
        end

        subgraph StreamWatch ["Stream Watch (quality monitor)"]
            direction LR
            API --> StreamWatchPOST[POST /streams/watch]
            API --> StreamWatchGET[GET /streams/watch]
            API --> StreamWatchId[GET /streams/watch/:id]
            API --> StreamWatchDEL[DELETE /streams/watch/:id]
        end

        subgraph Schedules ["Schedules (automation)"]
            direction LR
            API --> SchedulesGET[GET /schedules]
            API --> ScheduleGET[GET /schedules/:scheduleId]
            API --> SchedulePOST[POST /schedules]
            API --> SchedulePause[POST /schedules/:scheduleId/pause]
            API --> ScheduleResume[POST /schedules/:scheduleId/resume]
        end
    end

    style API fill:#f9f,stroke:#333,stroke-width:2px
```

## Quick Reference

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check with metrics |

### Events
| Method | Path | Description |
|--------|------|-------------|
| GET | /events/stream | Server-Sent Events stream |
| WS | /ws | Clark handshake endpoint (`client.register`, `client.heartbeat`, `server.registered`) |

### Chat & Sessions
| Method | Path | Description |
|--------|------|-------------|
| POST | /chat | Send chat message (texto + anexos opcionais image/audio em base64) |
| GET | /sessions/:sessionKey/messages | Get session messages |

### Projects
| Method | Path | Description |
|--------|------|-------------|
| GET | /projects | List known projects in `.kael/projects` |
| GET | /projects/:project | Ensure/load project scaffold and return `PROJECT.md` context + index |
| GET | /projects/:project/documents | List indexed documents for a project |
| GET | /projects/:project/document | Read a single project document (`path` query param, default `PROJECT.md`) |
| POST | /projects/:project/documents | Create or update a project document |

### Plans
| Method | Path | Description |
|--------|------|-------------|
| GET | /plans | List plans |
| GET | /plans/:planId | Get plan details |
| POST | /plans | Create plan |
| POST | /plans/generate | Generate plan from objective |
| POST | /plans/:planId/steps/:stepIndex | Update step status |
| POST | /plans/:planId/execute-next | Execute next step |
| POST | /plans/:planId/cancel | Cancel plan |
| POST | /plans/reconcile | Reconcile plan status |

### Exec (Shell & Approvals)
| Method | Path | Description |
|--------|------|-------------|
| GET | /exec/approvals | List approvals |
| POST | /exec/approvals/:approvalId/approve | Approve command |
| POST | /exec/approvals/:approvalId/deny | Deny command |
| GET | /exec/sessions | List exec sessions |
| GET | /exec/sessions/:sessionId/log | Get session log |

### MCP (Registry & Approvals)
| Method | Path | Description |
|--------|------|-------------|
| GET | /mcp/servers | List registered MCP servers |
| POST | /mcp/servers | Create/update MCP server registry entry |
| GET | /mcp/approvals | List MCP approvals |
| POST | /mcp/approvals/:approvalId/approve | Approve MCP server usage |
| POST | /mcp/approvals/:approvalId/deny | Deny MCP server usage |

### Jobs (Media Processing)
| Method | Path | Description |
|--------|------|-------------|
| GET | /jobs | List jobs |
| GET | /jobs/:jobId | Get job details |
| GET | /jobs/:jobId/log | Get job log |
| POST | /jobs/:jobId/cancel | Cancel job |
| POST | /jobs/transcode | Transcode video |
| POST | /jobs/hls | Convert to HLS |
| POST | /jobs/capture | Capture stream |
| POST | /jobs/vlc | Play input/url with VLC |
| POST | /jobs/probe | Probe local media |
| POST | /jobs/probe-url | Probe URL/stream |

#### Jobs Payload Contract

`Job` now uses capability-based fields:

- `capability`: dominio dono do job (ex.: `video`)
- `action`: acao executada no dominio (ex.: `transcode`, `convert_hls`)

`type` nao faz mais parte do payload atual.

Exemplo de `job` retornado por `GET /jobs/:jobId`:

```json
{
  "ok": true,
  "job": {
    "id": "a1b2c3d4",
    "capability": "video",
    "action": "transcode",
    "sessionKey": "main",
    "command": "ffmpeg",
    "input": "/videos/input.mp4",
    "output": "/videos/output.mp4",
    "args": ["-y", "-i", "/videos/input.mp4", "-c:v", "libx264", "-c:a", "aac", "/videos/output.mp4"],
    "status": "running",
    "createdAt": "2026-03-07T12:00:00.000Z",
    "startedAt": "2026-03-07T12:00:01.000Z",
    "logPath": "/.kael-data/jobs/logs/a1b2c3d4.log"
  }
}
```

Exemplo resumido de item em `GET /jobs`:

```json
{
  "id": "a1b2c3d4",
  "capability": "video",
  "action": "probe_media",
  "status": "succeeded",
  "output": "/videos/probe.json"
}
```

### Streams (Clone & Serve)
| Method | Path | Description |
|--------|------|-------------|
| GET | /streams | List all cloned origins with serving status |
| GET | /streams/:originId | Get detailed origin info with serving status |
| POST | /streams/clone | Clone an HLS/DASH URL. Body: `{ url, durationSeconds?, allVariants?, format? }` |
| POST | /streams/:originId/serve | Start serving an origin as VOD HTTP |
| POST | /streams/:originId/stop | Stop serving an origin |

### Stream Watch (Quality Monitor)
| Method | Path | Description |
|--------|------|-------------|
| POST | /streams/watch | Start a new HLS stream watch session |
| GET | /streams/watch | List all active watch sessions |
| GET | /streams/watch/:id | Get status and events for a watch session |
| DELETE | /streams/watch/:id | Stop a watch session |

### Schedules (Automation)
| Method | Path | Description |
|--------|------|-------------|
| GET | /schedules | List schedules |
| GET | /schedules/:scheduleId | Get schedule details |
| POST | /schedules | Create/update schedule |
| POST | /schedules/:scheduleId/pause | Pause schedule |
| POST | /schedules/:scheduleId/resume | Resume schedule |
