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
        end

        subgraph Chat ["Chat & Sessions"]
            direction LR
            API --> ChatPOST[POST /chat]
            API --> Sessions[GET /sessions/:sessionKey/messages]
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

        subgraph Jobs ["Jobs (media processing)"]
            direction LR
            API --> JobsGET[GET /jobs]
            API --> JobGET[GET /jobs/:jobId]
            API --> JobLog[GET /jobs/:jobId/log]
            API --> JobCancel[POST /jobs/:jobId/cancel]
            API --> Transcode[POST /jobs/transcode]
            API --> HLS[POST /jobs/hls]
            API --> Capture[POST /jobs/capture]
            API --> Probe[POST /jobs/probe]
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

### Chat & Sessions
| Method | Path | Description |
|--------|------|-------------|
| POST | /chat | Send chat message |
| GET | /sessions/:sessionKey/messages | Get session messages |

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
| POST | /jobs/probe | Probe media |

### Schedules (Automation)
| Method | Path | Description |
|--------|------|-------------|
| GET | /schedules | List schedules |
| GET | /schedules/:scheduleId | Get schedule details |
| POST | /schedules | Create/update schedule |
| POST | /schedules/:scheduleId/pause | Pause schedule |
| POST | /schedules/:scheduleId/resume | Resume schedule |
