# CIIS API Test Lab

One page that adds dummy data, runs every API flow against a running backend, notes how long each call takes, lists what fails, and deletes the dummy data again. It is a separate small server; it does not change the backend.

## Run it (local, safe)

```bash
# 1. local MongoDB as a replica set (the backend uses transactions)
mongod --dbpath /tmp/ciislab-db --port 27027 --replSet rs0 --bind_ip 127.0.0.1 --fork --logpath /tmp/ciislab-db.log
node -e 'require("mongodb").MongoClient.connect("mongodb://127.0.0.1:27027/?directConnection=true").then(async c=>{await c.db("admin").command({replSetInitiate:{}}).catch(e=>console.log(e.message));await c.close()})'

# 2. backend on port 3100 against that database (no emails, no cron jobs)
MONGO_URI="mongodb://127.0.0.1:27027/ciislab?replicaSet=rs0" PORT=3100 DISABLE_SCHEDULED_JOBS=true \
  EMAIL_HOST= EMAIL_USER= EMAIL_PASS= REDIS_URL= \
  COTURN_HOST=turn.lab.local COTURN_STATIC_AUTH_SECRET=lab-turn-secret node server.js

# 3. the lab (another terminal)
MONGO_URI="mongodb://127.0.0.1:27027/ciislab?replicaSet=rs0" LAB_TARGET=http://localhost:3100 \
  COTURN_STATIC_AUTH_SECRET=lab-turn-secret npm run lab
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
| Calls (TURN) | `/api/chat/turn-credentials` returns a TURN server with a username + credential that is still valid and matches `COTURN_STATIC_AUTH_SECRET` (when the lab is given it); no token → 401 |
| All GET APIs | every GET route found in the code is called (owner, optionally employee and client) and timed; 5xx, timeouts and "Route not found" are failures. GET routes that start jobs, download files or are test/debug routes are never called. |

The `COTURN_*` values above are local placeholders: the endpoint only signs credentials, it never contacts a TURN server. Without them the backend answers 503 and the TURN rows fail.

Live clock-in tests run only between 03:05 and 21:20 India time.

## Rate limit

Login and add-employee share a limit of 20 calls per 15 minutes per IP. Running the test several times in a row shows those rows as WARN (429). Restarting a local backend resets it.

## Safety

- Everything the lab creates belongs to a company whose code starts with `ZZLAB`, and every login email ends with `@zzlab-test.example.com`. Delete removes only records linked to those companies and users.
- A database that is not on localhost is refused unless the lab is started with `LAB_ALLOW_REMOTE_DB=1`. The production backends share the live database, so do not point it there.

## On the server at `/test`

The lab needs its **own** database and its **own** backend copy on the server. app1, app2 and the web backend all use the live database, so never point the lab at them.

```bash
# 1. lab database (Docker, localhost only)
docker run -d --name ciislab-mongo --restart unless-stopped -p 127.0.0.1:27027:27017 mongo:8 --replSet rs0 --bind_ip_all
docker exec ciislab-mongo mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'

# 2. lab backend = copy of the repo backend in /var/www/apitestlab (own .env, NOT the live one)
cd /var/www/apitestlab
MONGO_URI="mongodb://127.0.0.1:27027/ciislab?replicaSet=rs0&directConnection=true" PORT=3100 DISABLE_SCHEDULED_JOBS=true \
  EMAIL_HOST= EMAIL_USER= EMAIL_PASS= REDIS_URL= COTURN_HOST=turn.lab.local COTURN_STATIC_AUTH_SECRET=lab-turn-secret \
  pm2 start server.js --name lab-backend --update-env

# 3. the lab page at /test with a password
MONGO_URI="mongodb://127.0.0.1:27027/ciislab?replicaSet=rs0&directConnection=true" LAB_TARGET=http://127.0.0.1:3100 \
  COTURN_STATIC_AUTH_SECRET=lab-turn-secret LAB_BASE_PATH=/test LAB_PASSWORD='<strong password>' \
  pm2 start tools/api-test-lab/server.js --name lab --update-env
```

nginx (inside the domain's `server { listen 443 ... }` block):

```nginx
location = /test { return 301 /test/; }
location /test/ {
    proxy_pass http://127.0.0.1:4600;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_buffering off;          # live progress (server-sent events)
    proxy_read_timeout 900s;
}
```

Open `https://<domain>/test/` and log in as `lab` / `LAB_PASSWORD`. With `LAB_BASE_PATH` set, the lab will not start without `LAB_PASSWORD`. It listens on 127.0.0.1 only (`LAB_HOST`).

## Settings

| Env | Default |
|---|---|
| `LAB_PORT` | 4600 |
| `LAB_HOST` | 127.0.0.1 |
| `LAB_BASE_PATH` | none (server: `/test`) |
| `LAB_USER` / `LAB_PASSWORD` | `lab` / none — password login is on when `LAB_PASSWORD` is set; required with `LAB_BASE_PATH` |
| `LAB_TARGET` | `http://localhost:$PORT` from `.env` (can be changed on the page) |
| `LAB_MONGO_URI` / `MONGO_URI` | from `.env` |
| `LAB_ALLOW_REMOTE_DB` | off |
| `LAB_SLOW_MS` | 1500 (calls slower than this are marked SLOW) |
| `LAB_TIMEOUT_MS` | 20000 |
