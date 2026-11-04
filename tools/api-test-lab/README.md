# CIIS API Test Lab

One page that adds dummy data, runs every API flow against a running backend, notes how long each call takes, lists what fails, and deletes the dummy data again. It is a separate small server; it does not change the backend.

## Run it (local, safe)

```bash
# 1. local MongoDB as a replica set (the backend uses transactions)
mongod --dbpath /tmp/ciislab-db --port 27027 --replSet rs0 --bind_ip 127.0.0.1 --fork --logpath /tmp/ciislab-db.log
node -e 'require("mongodb").MongoClient.connect("mongodb://127.0.0.1:27027/?directConnection=true").then(async c=>{await c.db("admin").command({replSetInitiate:{}}).catch(e=>console.log(e.message));await c.close()})'

# 2. backend on port 3100 against that database (no emails, no cron jobs)
MONGO_URI="mongodb://127.0.0.1:27027/ciislab?replicaSet=rs0" PORT=3100 DISABLE_SCHEDULED_JOBS=true \
  EMAIL_HOST= EMAIL_USER= EMAIL_PASS= REDIS_URL= node server.js

# 3. the lab (another terminal)
MONGO_URI="mongodb://127.0.0.1:27027/ciislab?replicaSet=rs0" LAB_TARGET=http://localhost:3100 npm run lab
# open http://localhost:4600
```

Buttons: **Add dummy data** → **Start test** → **Delete dummy data**.

If login OTP is switched on in that database, the lab reads the OTP the backend stored and verifies it. If the OTP email cannot be sent, it uses a token signed with `JWT_SECRET` from `.env` for the rest of the run and marks the login row as WARN.

## What it tests

| Module | What is checked |
|---|---|
| Auth & Login | company login, wrong password / company / email refused, no token / fake token → 401, refresh token |
| Setup | departments (7-day and 5-day week), job roles with 5 shifts, 6 employees through the add-employee API, leave type + policy, permission checks |
| Attendance (live) | shifts are built around the current time, so real clock-in gives PRESENT / LATE / HALF DAY / "too early" refused; clock-out after seconds → ABSENT; double clock-in/out refused |
| Shift rules | 12 in/out time cases on a 09:00–18:00 shift (grace 09:10, half-day line 11:00, short-leave 17:30, half-day-early 14:00) |
| Manual attendance | admin add → edit → delete, the employee's list shows the new status, employees refused |
| Weekend & overtime | Saturday short punch stays WEEKEND, Sunday work is PRESENT, full-day overtime approved → PRESENT + "Full Day", rejected overtime changes nothing, employee cannot approve own |
| Leave & holidays | validation, apply → approve / reject / cancel, yearly limit, approved leave shows LEAVE in attendance, holiday shows HOLIDAY |
| Tasks | assigned + self tasks, status flow, remarks, checkpoints, outsider access, notifications, old `/task` API |
| Projects | create, member / non-member access, project task status + remarks |
| Clients | services, add client (creates login), client login, client tasks + remarks, one client cannot see another, client blocked from employee areas |
| Page management | Emp-Attendance view access given → works → removed → blocked again, leave approver, sidebar |
| CRM | owner given access to all CRM admin pages through Page Management, lead types/sources, add lead (validation), stages, single + bulk assignment, history, workload, telecaller sees only own leads, call outcomes (callback → follow-up, converted → locked), follow-ups, all admin call pages, 8 reports, employee and client blocked |
| Payroll | components, structure (Basic + Special − PT), assign ₹30,000 salary, payroll run for last month: generate → review → approve → lock → reopen, payslip only after approval, employees blocked |
| Admin pages | employee edit/delete, branches, groups, meetings, client meetings, alerts, support tickets, dashboards, asset requests |
| All GET APIs | every GET route found in the code is called (owner, optionally employee and client) and timed; 5xx, timeouts and "Route not found" are failures. GET routes that start jobs, download files or are test/debug routes are never called. |

Live clock-in tests run only between 03:05 and 21:20 India time.

## Rate limit

Login and add-employee share a limit of 20 calls per 15 minutes per IP. Running the test several times in a row shows those rows as WARN (429). Restarting a local backend resets it.

## Safety

- Everything the lab creates belongs to a company whose code starts with `ZZLAB`, and every login email ends with `@zzlab-test.example.com`. Delete removes only records linked to those companies and users.
- A database that is not on localhost is refused unless the lab is started with `LAB_ALLOW_REMOTE_DB=1`. The production backends share the live database, so do not point it there.

## Settings

| Env | Default |
|---|---|
| `LAB_PORT` | 4600 |
| `LAB_TARGET` | `http://localhost:$PORT` from `.env` (can be changed on the page) |
| `LAB_MONGO_URI` / `MONGO_URI` | from `.env` |
| `LAB_ALLOW_REMOTE_DB` | off |
| `LAB_SLOW_MS` | 1500 (calls slower than this are marked SLOW) |
| `LAB_TIMEOUT_MS` | 20000 |
