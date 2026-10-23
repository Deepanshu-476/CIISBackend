# AI Task Agent Request & Response Contract

Mounted Endpoint: `POST /api/ai/task-agent/parse`

## 1. Request Body Contract

The endpoint accepts a JSON object with the following fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `message` | string | **Yes** | Natural language task description (1 - 1000 characters). |
| `language` | string | No | Language preference (`"hinglish"` or `"en"`). Defaults to `"hinglish"`. |
| `draft` | object | No | Existing accumulated slot draft from earlier turns. |
| `draft.title` | string \| null | No | Task title. |
| `draft.description` | string \| null | No | Detailed description. |
| `draft.checkpoints`| string[] | No | List of checkpoint items. |
| `draft.priority` | string \| null | No | Priority (`"low"`, `"medium"`, `"high"`). Defaults to `"medium"`. |
| `draft.dueDateTime` | string \| null | No | Target ISO-8601 timestamp with `+05:30` IST offset. |
| `draft.assigneeName` | string \| null | No | Name of the person to whom task is assigned. |
| `draft.assigneeId` | string \| null | No | Mongoose ObjectId string of the assigned user. |
| `draft.assigneeLabel`| string \| null | No | Display label e.g. `"Rohan Verma (Engineering)"`. |
| `pick` | object | No | Disambiguation selection from candidate list. |
| `pick.assigneeId` | string | If pick | Selected user ID. |

### Example Request 1: Initial Prompt (Self Task)
```json
{
  "message": "Kal shaam 5 baje client report submit karni hai",
  "language": "hinglish"
}
```

### Example Request 2: Follow-up with Disambiguation Pick
```json
{
  "message": "Vikas ko assign karo",
  "language": "hinglish",
  "draft": {
    "title": "Client presentation review",
    "description": null,
    "checkpoints": ["Review slides", "Verify numbers"],
    "priority": "high",
    "dueDateTime": "2026-10-18T17:00:00+05:30",
    "assigneeName": "Vikas",
    "assigneeId": null,
    "assigneeLabel": null
  },
  "pick": {
    "assigneeId": "6530a1b2c3d4e5f6a7b8c9d0"
  }
}
```

---

## 2. Response Contract

The controller returns `status`: `"ready" | "needs_input" | "needs_disambiguation"`.

### Example Response: Status `ready` (Self Task)
```json
{
  "success": true,
  "status": "ready",
  "reply": "Task details ready hain. Kya ise create kar doon?",
  "draft": {
    "title": "Client report submit karni hai",
    "description": "",
    "checkpoints": [],
    "priority": "medium",
    "dueDateTime": "2026-10-17T17:00:00+05:30",
    "assigneeName": null,
    "assigneeId": null,
    "assigneeLabel": null
  },
  "missing": [],
  "chips": [],
  "candidates": [],
  "notices": [],
  "canAssignOthers": true,
  "payload": {
    "endpoint": "/tasks/self/create",
    "method": "POST",
    "body": {
      "title": "Client report submit karni hai",
      "description": "",
      "dueDateTime": "2026-10-17T17:00:00+05:30",
      "priority": "medium",
      "priorityDays": "1",
      "checkpoints": []
    }
  },
  "preview": {
    "title": "Client report submit karni hai",
    "description": "",
    "checkpoints": [],
    "priority": "medium",
    "dueDateTime": "2026-10-17T17:00:00+05:30",
    "dueLabel": "Tomorrow, 5:00 PM",
    "assignee": null,
    "taskFor": "self"
  },
  "meta": {
    "model": "llama-3.3-70b-versatile"
  }
}
```

### Example Response: Status `ready` (Assign to Others)
```json
{
  "success": true,
  "status": "ready",
  "reply": "Task details ready hain. Kya ise create kar doon?",
  "draft": {
    "title": "Client presentation review",
    "description": "",
    "checkpoints": ["Review slides"],
    "priority": "high",
    "dueDateTime": "2026-10-18T17:00:00+05:30",
    "assigneeName": "Vikas Verma",
    "assigneeId": "6530a1b2c3d4e5f6a7b8c9d0",
    "assigneeLabel": "Vikas Verma (QA)"
  },
  "missing": [],
  "chips": [],
  "candidates": [],
  "notices": [],
  "canAssignOthers": true,
  "payload": {
    "endpoint": "/task/create-for-others",
    "method": "POST",
    "body": {
      "title": "Client presentation review",
      "description": "",
      "dueDateTime": "2026-10-18T17:00:00+05:30",
      "priority": "high",
      "assignedUsers": [
        "6530a1b2c3d4e5f6a7b8c9d0"
      ],
      "checkpoints": [
        { "title": "Review slides" }
      ]
    }
  },
  "preview": {
    "title": "Client presentation review",
    "description": "",
    "checkpoints": ["Review slides"],
    "priority": "high",
    "dueDateTime": "2026-10-18T17:00:00+05:30",
    "dueLabel": "Sunday, 5:00 PM",
    "assignee": {
      "id": "6530a1b2c3d4e5f6a7b8c9d0",
      "label": "Vikas Verma (QA)"
    },
    "taskFor": "others"
  },
  "meta": {
    "model": "llama-3.3-70b-versatile"
  }
}
```
