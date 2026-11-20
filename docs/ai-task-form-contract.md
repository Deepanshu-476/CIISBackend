# Real Form Contract: Create Personal Task (Self) & Assign to Others

Documented from actual codebase audit of `CIIS/src/hrCds/pages/TaskManagement.jsx`, `CIIS/src/hrCds/pages/hr/AdminTaskCreate.jsx`, `CIISBackend/HR-CDS/routes/selfTaskRoute.js`, `CIISBackend/HR-CDS/routes/taskRoute.js`, and `CIISBackend/HR-CDS/controllers/*.js`.

---

## 1. Endpoints & Methods

| Modal Context | Frontend Submit Trigger | Target Endpoint | HTTP Method | Content-Type |
|---|---|---|---|---|
| **Create Personal Task (Self)** | `TaskManagement.jsx:4924` (`handleCreateTask`) | `/api/tasks/self/create` (via `axios.post('/tasks/self/create')`) | `POST` | `multipart/form-data` |
| **Assign To Others (Owner / Admin)** | `AdminTaskCreate.jsx:1360` (`handleCreateTask`) | `/api/task/create-for-others` (or `/api/tasks/create-for-others`) | `POST` | `multipart/form-data` |

*Note: In the frontend, `axios` is configured with `baseURL: <API_URL>` (which already includes `/api`).*

---

## 2. Complete Field Matrix

| Field Label | FormData Key | Data Type | Required (Frontend) | Required (Backend) | Default | Allowed Values / Schema / Sub-settings | FormData Serialization |
|---|---|---|---|---|---|---|---|
| **Kiske Liye (Assignee)** *(Others only)* | `assignedUsers` | `string` (JSON array of ObjectIds) | Yes (for Others) | Yes (for Others) | `[<currentUserId>]` for self | Array of User ObjectId strings belonging to the company | `JSON.stringify(assignedUsers)` e.g. `'["65a..."]'` |
| **Assigned Groups** *(Others only)* | `assignedGroups` | `string` (JSON array of ObjectIds) | No | No | `[]` | Array of Group ObjectId strings | `JSON.stringify(assignedGroups)` e.g. `'[]'` |
| **Branch** *(Others only, if scoped)* | `branchId` & `branch` | `string` (ObjectId) | Conditional | Conditional | `""` | Valid Branch ObjectId string if admin is scoped to specific branch | Plain string |
| **Task Title \*** | `title` | `string` | **Yes** | **Yes** | `""` | Non-empty trimmed string (1-200 chars) | Plain string: `formData.append('title', val)` |
| **Description \*** | `description` | `string` | **Yes** (in modal) | **NO** (Backend accepts `""`) | `""` | Any string (can be empty `""` when skipped via AI) | Plain string: `formData.append('description', val)` |
| **Due Date & Time \*** | `dueDateTime` | `string` (ISO-8601) | **Yes** | No (treated as null if missing, but modal requires it) | `""` | ISO-8601 string e.g. `2026-10-20T10:00:00.000Z` or with `+05:30` | Plain string: `formData.append('dueDateTime', isoDate)` |
| **Priority** | `priority` | `string` | No | No | `"medium"` | Enum: `'low'`, `'medium'`, `'high'` | Plain string: `formData.append('priority', val)` |
| **Priority Days** | `priorityDays` | `string` / `number` | No | No | `"1"` | String number >= 1, default `'1'` | Plain string: `formData.append('priorityDays', val)` |
| **Reminder Settings** | `reminderSettings` | `string` (JSON object) | No | No | `{"enabled":false,"options":[],"reminderTime":null,"customTime":null,"repeatIntervalMinutes":null,"minutesBeforeDue":null}` | Object: `{ enabled: boolean, options: string[], reminderTime: string\|null, customTime: string\|null, repeatIntervalMinutes: number\|null, minutesBeforeDue: number\|null }`<br>Options enum: `['hourly', 'halfHourly', 'oneHourBefore']` | `JSON.stringify(buildReminderPayload(settings))` |
| **Repeat Task** | `repeatPattern` | `string` | No | No | `"none"` | Enum: `'none'`, `'daily'` | Plain string: `formData.append('repeatPattern', val)` |
| **Repeat Days** | `repeatDays` | `string` (JSON array) | No | No | `[]` | Array of lowercase weekday names: `['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']`. If empty when pattern is daily, repeats every day. | `JSON.stringify(repeatDays)` e.g. `'["monday","wednesday"]'` |
| **Repeat End Date** | `recurrenceEndDate` | `string` (ISO date) | Yes if repeatPattern !== 'none' | No | `""` | End date ISO string (e.g. `2026-10-31T23:59:59.999Z` or `YYYY-MM-DD`). Cannot be before dueDateTime. | Plain string: `formData.append('recurrenceEndDate', val)` |
| **Checkpoints** | `checkpoints` | `string` (JSON array) | No | No | `[]` | Array of `{ title: string, completed: boolean }`. Blank titles filtered out. | `JSON.stringify(getCleanCheckpoints(checkpoints))` |
| **Attachments (Files)** | `files` | `File` binary | No | No | `[]` | Up to 10 files. Mime types: `jpeg, jpg, png, pdf, mp4, mp3, wav, avi, mkv, webm`. Max 20MB per file. | Multiple `formData.append('files', file)` |
| **Record Voice (Voice Note)** | `voiceNote` | `Blob` / `File` binary | No | No | `null` | Max 1 audio file (webm, mp3, wav). Max 20MB. | Single `formData.append('voiceNote', blob, 'voice-note.webm')` |

---

## 3. Server-Side Validation vs Frontend Modal Rules

### The Empty Description Verification Finding
- **Frontend Observation**: Both `TaskManagement.jsx` (Personal Task) and `AdminTaskCreate.jsx` display `Description *` and disable the submit button if `description` is falsy (`!newTask.description`).
- **Live Server Test**: Tested live against Express backend endpoints:
  - `POST /api/tasks/self/create` with `description: ""` -> **HTTP 201 Created** (Task created successfully with `description: ""`).
  - `POST /api/task/create-for-others` with `description: ""` -> **HTTP 201 Created** (Task created successfully with `description: ""`).
- **Mongoose Schema (`HR-CDS/models/Task.js`)**:
  ```javascript
  title: { type: String, required: true, trim: true },
  description: String, // NOT required!
  ```
- **Conclusion**: The backend does NOT validate or reject empty descriptions. When the user skips description in the AI flow ("koi nahi" / "skip"), the AI agent can safely send `description: ""` (or empty string). If the user or client configuration specifically requests a fallback, we also support `fallbackTitleAsDescription` option (`description: draft.description || draft.title`).

### Other Server Validations
- `title`: Explicitly checked in controller: `if (!title || !String(title).trim()) return res.status(400)`.
- `dueDateTime`: If provided, parsed as `new Date(dueDateTime)`. If `isNaN`, returns `400 Invalid due date format`.
- `assignedUsers`: For `taskFor: 'others'`, requires at least one valid user ID within the requester's company/branch/department scope.
- Identity fields (`companyCode`, `createdBy`, `company`): Automatically set on the server from `req.user`. Frontend MUST NOT inject these.

---

## 4. Multer Attachment Specifications

From `CIISBackend/utils/multer.js` and `HR-CDS/routes/selfTaskRoute.js`:
- **Multer Middleware**:
  ```javascript
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]);
  ```
- **Max File Count**: 10 for `files`, 1 for `voiceNote`.
- **Max File Size**: `20 * 1024 * 1024` bytes (20 MB).
- **Allowed MIME/Extensions**: `/jpeg|jpg|png|pdf|mp4|mp3|wav|avi|mkv|webm/i`.
- **Storage Destination**: `uploads/tasks/`.

---

## 5. Expected Form-Filler Slot Sequence (Single Source of Truth)

1. `assignee` *(Owner/Admin only, skipped automatically for employee self-task)*
2. `title` \*(Required)
3. `description` (Optional: accepts "koi nahi" -> blank)
4. `dueDateTime` \*(Required)
5. `priority` (Optional: Low / Medium / High, default: Medium)
6. `reminder` (Optional: Haan / Nahi, default: Nahi)
   - If Haan -> `reminderOption` (hourly / halfHourly / oneHourBefore)
7. `priorityDays` (Optional: default 1)
8. `repeat` (Optional: No repeat / Repeat Task)
   - If Repeat Task -> `repeatDays` (weekdays) + `recurrenceEndDate`
9. `checkpoints` (Optional: ek ek karke bol dein ya 'koi nahi')
10. `attachments` (Optional: photo / file clip upload ya 'nahi')
11. `ready` (Final confirmation with full preview card)
