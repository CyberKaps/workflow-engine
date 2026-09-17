
# Workflow Engine

A lightweight background job execution engine built from scratch to explore how reliable job processing systems work in practice.

This project demonstrates job queues, multiple workers, atomic job claiming, retries, worker heartbeats, failure recovery, timeouts, and stale execution handling using PostgreSQL as the durable job store.

> This is a learning project inspired by concepts used in systems such as Trigger.dev. It is intentionally educational and not a production-ready replacement.

---

## Architecture

![Job Execution Architecture](image.png)

This diagram shows the main flow:

- the API creates jobs
- PostgreSQL stores the queue and job state
- workers claim and execute jobs with atomic locking
- each worker sends heartbeats to the monitor
- the monitor detects dead workers and reclaims their unfinished jobs

---

## Tech Stack

* Node.js
* TypeScript
* PostgreSQL
* Prisma
* pnpm

---

## Core Concepts

### 1. Background Jobs

Instead of keeping an HTTP request open while performing long-running work:

```text
HTTP Request
     ↓
Do Work
     ↓
Response
```

The API creates a durable job:

```text
HTTP Request
     ↓
Create Job
     ↓
Store in PostgreSQL
     ↓
Return Response
```

A worker executes the job separately.

---

### 2. Job Lifecycle

Jobs move through different states depending on the execution result.

```text
PENDING
   ↓
RUNNING
   ↓
COMPLETED
```

For failed jobs:

```text
RUNNING
   ↓
FAILED
   ↓
PENDING (retry)
   ↓
RUNNING
```

After the maximum number of attempts:

```text
RUNNING
   ↓
FAILED
```

---

### 3. Multiple Workers

Multiple workers can process jobs concurrently.

```text
             PostgreSQL
             /         \
            /           \
       Worker 1       Worker 2
          ↓               ↓
       Job A            Job B
```

The system ensures that two workers do not claim the same pending job.

---

### 4. Atomic Job Claiming

PostgreSQL's:

```sql
FOR UPDATE SKIP LOCKED
```

is used when workers claim jobs.

This allows workers to safely select different jobs without waiting for rows already locked by another worker.

Example:

```text
Worker 1 → locks Job A
Worker 2 → skips Job A → claims Job B
```

This prevents duplicate job ownership during concurrent processing.

---

### 5. Worker Ownership

Each worker is registered with a stable `workerKey` and a database-generated `id`. In the current code, the `WORKER_ID` environment variable is used as the worker's unique `workerKey`.

When a worker claims a job:

```text
Job
├── status = RUNNING
├── workerId = WorkerDatabaseId
└── startedAt = now
```

This allows the system to know which worker currently owns a running job and to verify ownership during long-running execution.

---

### 6. Worker Heartbeats

Workers periodically update their heartbeat timestamp. In the implementation, the monitor polls every 5 seconds.

```text
Worker
   ↓
Heartbeat
   ↓
PostgreSQL
```

The heartbeat answers:

> Is this worker still alive?

A heartbeat does not mean that a job has completed.

---

### 7. Dead Worker Detection

A separate monitor process checks worker heartbeats and marks workers as dead when their last heartbeat is older than the configured stale threshold.

In this project, the stale timeout is 15 seconds:

```text
DEAD_AFTER_MS = 15_000
```

If a worker has not sent a heartbeat for that period:

```text
Worker
   ↓
Heartbeat stops
   ↓
Monitor detects stale worker
   ↓
Worker status = DEAD
```

The worker is considered dead, and any still-running jobs it owns are recovered.

---

### 8. Job Recovery

If a dead worker owned jobs that were still running:

```text
RUNNING
   ↓
Worker dies
   ↓
Monitor detects worker
   ↓
Recover job
   ↓
PENDING
```

Another worker can then claim the recovered job.

Only jobs that were still `RUNNING` under the dead worker are recovered.

---

### 9. Retries

Failed jobs can be retried.

The job tracks the number of execution attempts, and the worker increments that count as soon as it claims a job for execution. The current implementation uses a maximum of:

```text
MAX_ATTEMPTS = 3
```

After the final failed attempt, the job becomes permanently `FAILED`.

---

### 10. Retry Backoff

Retries are not performed immediately. The job contains:

```text
nextRunAt
```

The worker only picks a job when:

```text
nextRunAt <= current time
```

or when `nextRunAt` is `NULL`.

The retry delay uses exponential backoff based on the current attempt count:

```text
Attempt 1 → 2 seconds
Attempt 2 → 4 seconds
Attempt 3 → 8 seconds
```

The actual code computes this using `Math.pow(2, job.attempts)` before scheduling the next run.

---

### 11. Stale Execution Detection

A worker can potentially continue executing an old job after that job has been recovered and claimed by another worker.

To handle this, long-running work periodically checks:

```text
Do I still own this job?
```

Ownership is verified using the job's:

```text
status
workerId
```

If ownership has been lost:

```text
Worker 1
   ↓
Old execution
   ↓
Ownership lost
   ↓
Stop execution
```

This prevents a stale worker from continuing and later marking another worker's job as completed.

---

### 12. Job Timeout

Long-running jobs can exceed their allowed execution time. The monitor checks for jobs that have remained `RUNNING` longer than the timeout threshold:

```text
JOB_TIMEOUT_MS = 10_000
```

When a job exceeds that threshold, it is reset to `PENDING` and re-queued for retry unless it already reached the maximum attempt count. This is separate from dead-worker recovery.

```text
RUNNING
   ↓
Timeout
   ↓
PENDING or FAILED
```

---

## Database Models

### Worker

```text
Worker
├── id
├── workerKey
├── lastHeartbeat
├── status
├── createdAt
└── jobs
```

### Job

```text
Job
├── id
├── type
├── payload
├── status
├── attempts
├── createdAt
├── startedAt
├── completedAt
├── nextRunAt
├── workerId
└── worker
```

---

## Job Status Flow

### Successful Job

```text
PENDING
   ↓
RUNNING
   ↓
COMPLETED
```

### Failed Job With Retry

```text
PENDING
   ↓
RUNNING
   ↓
FAILED
   ↓
PENDING
   ↓
RUNNING
```

### Permanently Failed Job

```text
PENDING
   ↓
RUNNING
   ↓
FAILED
   ↓
RETRY
   ↓
FAILED
   ↓
RETRY
   ↓
FAILED
```

After the maximum attempts, the job remains `FAILED`.

### Dead Worker Recovery

```text
RUNNING
   ↓
Worker dies
   ↓
Monitor detects dead worker
   ↓
PENDING
   ↓
Another worker
```

---

## Project Structure

```text
workflow-engine/
│
├── prisma/
│   ├── migrations/
│   └── schema.prisma
│
├── src/
│   ├── worker/
│   │   └── index.ts
│   │
│   ├── worker2/
│   │   └── index.ts
│   │
│   ├── monitor.ts
│   └── server.ts
│
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── prisma.config.ts
└── README.md
```

---

## Running the Project

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Create a `.env` file:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/workflow_engine"
```

Each worker also needs a unique `WORKER_ID` so it can register itself in the database:

```env
WORKER_ID="worker-1"
```

Use a different value for each worker, for example `worker-1` and `worker-2`.

### 3. Run database migrations

```bash
pnpm prisma migrate dev
```

### 4. Start the API

```bash
pnpm dev
```

### 5. Start Worker 1

```bash
WORKER_ID="worker-1" pnpm worker
```

### 6. Start Worker 2

```bash
WORKER_ID="worker-2" pnpm worker2
```

### 7. Start the Monitor

```bash
pnpm monitor
```

Run the API, workers, and monitor in separate terminals.

> The worker processes use `WORKER_ID` as the unique `workerKey` when registering with PostgreSQL. This allows the monitor to identify dead workers and recover their jobs.

---

## Creating a Job

Example:

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "send_email",
    "payload": {
      "to": "test@example.com"
    }
  }'
```

Example response:

```json
{
  "id": "cm...",
  "status": "PENDING"
}
```

The worker will then claim and process the job.

---

## Failure Scenarios Tested

The project was tested against several failure scenarios:

* Multiple workers processing jobs concurrently
* Duplicate job claiming prevention
* Forced job failures
* Retry handling
* Maximum attempt handling
* Exponential retry backoff
* Future `nextRunAt` handling
* Worker heartbeat
* Worker crash during job execution
* Recovery of jobs from dead workers
* Stale execution detection
* Stopping execution after ownership is lost
* Job timeout and retry

---

## Interesting Bugs Encountered

### Retry Attempt Off-by-One

The database incremented `attempts` during the job claim, but the JavaScript object returned from the raw SQL query still contained the previous value.

This initially resulted in:

```text
Expected: 3 attempts
Actual:   4 attempts
```

The fix was to calculate the current execution attempt explicitly:

```ts
const currentAttempt = job.attempts + 1;
```

This was also a useful lesson about the difference between the database state and an in-memory object.

---

## What I Learned

This project helped me understand the fundamentals behind background job execution systems:

* Why long-running work should be separated from HTTP requests
* How persistent jobs survive process failures
* How workers consume jobs
* Why concurrent workers create race conditions
* How PostgreSQL can safely coordinate workers
* The difference between claiming and executing a job
* How worker ownership works
* Why heartbeats are needed
* How dead workers can be detected
* How abandoned jobs can be recovered
* How retries and attempt limits work
* Why retry backoff is useful
* How long-running executions can become stale
* Why workers should verify ownership before continuing
* How timeouts can be handled

---

## Project Status

This is an educational implementation.

The goal is to progressively understand the problems involved in building reliable background job infrastructure and solve them one at a time.

Future improvements may include:

* Worker lifecycle/status management
* Better job scheduling
* More robust timeout handling
* Job priorities
* Concurrency limits
* Persistent execution history
* Better observability
* Distributed coordination improvements

---

## Known Limitations

This project is intentionally small and explicit, so it helps explain the core mechanics without trying to solve every production concern at once.

Current limitations include:

* A very minimal API surface; it only creates jobs
* No job listing, filtering, or admin endpoints
* No durable execution logs beyond the job state itself
* No sophisticated scheduler or queue fairness model
* No retry policy configuration beyond the hardcoded maximum attempts and exponential backoff values
* No advanced worker coordination beyond heartbeat-based recovery
* No real observability dashboard or metrics pipeline

This makes it a useful learning project, but not a drop-in production queue system.

---

## License

This project is for learning and experimentation.
