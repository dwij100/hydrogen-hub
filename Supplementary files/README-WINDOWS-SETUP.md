# Hydrogen Hub Windows setup

This is the exact setup for the packaged local application. You do not need a
Supabase account, Lovable SQL action, database password, Node.js, Python, or a
service-role key.

## Before you begin

You need:

1. A 64-bit Windows computer with hardware virtualization available.
2. Docker Desktop installed and its WSL 2 engine running.
3. Enough free disk space for Docker images and solver results (allow at least
   10 GB initially).
4. A full Gurobi licence that is permitted in a container. Academic users should
   use WLS; a named-user licence is tied to one host and is not suitable for a
   Docker container.
5. Internet access during the first Docker build. WLS also needs internet access
   while acquiring/renewing solver tokens.

The size-limited licence bundled with `gurobipy` is not enough. The setup performs
a 2,001-variable readiness solve and rejects it explicitly.

## Step 1 — start Docker Desktop

1. Open **Docker Desktop** from the Windows Start menu.
2. Accept any WSL 2 update/restart request.
3. Wait until Docker Desktop reports that the engine is running.
4. Optional confirmation in PowerShell:

   ```powershell
   docker version
   docker compose version
   ```

Both commands must complete. `docker version` must show a Server section.

## Step 2 — extract the complete package

Extract the ZIP to a normal local folder, for example:

```text
C:\Users\YourName\Documents\Hydrogen-Hub
```

Do not run it from inside the ZIP preview. Do not move only the `.bat` file; the
entire folder structure is required.

Avoid a OneDrive network-only folder for the first setup. A short local path also
avoids Windows path-length problems.

## Step 3 — add the private Gurobi licence

1. Download your full WLS/commercial client licence from your Gurobi account.
2. Rename it to exactly:

   ```text
   gurobi.lic
   ```

3. Put it in the package's `secrets` folder, giving this exact path:

   ```text
   Hydrogen-Hub\secrets\gurobi.lic
   ```

4. In File Explorer, enable **View → Show → File name extensions** and confirm it
   is not named `gurobi.lic.txt`.

Never paste the file contents into chat, Lovable, GitHub, `.env`, or a browser
variable. The licence is bind-mounted read-only into the backend and worker. It
is excluded by `.gitignore` and `.dockerignore`.

## Step 4 — run the one-time setup

Open PowerShell in the extracted package folder. An easy method is to click the
File Explorer address bar, type `powershell`, and press Enter.

Run:

```powershell
PowerShell -NoProfile -ExecutionPolicy Bypass -File .\Setup-Hydrogen-Hub.ps1
```

The script performs these actions once:

1. Confirms Docker Engine and Docker Compose are available.
2. Confirms the solver, Dockerfiles, Compose file and licence are present.
3. Copies `.env.example` to `.env` with safe local defaults if needed.
4. Checks that local port 8080 is available.
5. Builds the React/Nginx image and the Python/Pyomo/Gurobi image.
6. Runs frontend type checking, lint, 72 tests, and a production build inside
   the frontend image build.
7. Runs backend integrity, adapter, queue, API, result and Pyomo model-build
   tests in the backend image.
8. Starts the API, single worker and frontend.
9. Waits for all three container health checks.
10. Confirms the 29 original hashes, writable persistent storage, worker
    heartbeat, and a full Gurobi licence readiness solve.

The first build can take several minutes and downloads container packages. Do
not close PowerShell or Docker Desktop. Success ends with:

```text
SETUP COMPLETE
Application address: http://localhost:8080
```

The application has not yet been proven end-to-end until you perform the first
licensed optimization in Step 6.

## Step 5 — check readiness

Run:

```powershell
PowerShell -NoProfile -ExecutionPolicy Bypass -File .\Check-Hydrogen-Hub.ps1
```

You want:

```text
API ready: True
Database ready: True
Worker ready: True
Storage ready: True
Dataset ready: True
Gurobi package: available
Gurobi licence: full
Overall: READY
```

The health response never exposes licence contents.

## Step 6 — perform the first real optimization

1. Double-click `Start Hydrogen Hub.bat`.
2. Your browser should open `http://localhost:8080`.
3. Choose **Saved Projects**, create a project, and open it; or begin a draft
   directly with **Start Configuration**.
4. Review the fixed 24-hour horizon.
5. Select at least one supported POM/WWTP/BSP/BHH. If you select a WWTP, also
   select a BSP or BHH as required by the interface.
6. Optionally select solar farm 1 or 2.
7. Select at least one existing vehicle template. Configure railway only if you
   also select a station and 1–3 train templates.
8. Add at least one C1–C3 consumer and enter demand in kg H2/day.
9. On **Review and Run**, click **Validate configuration**.
10. Inspect the resolved configuration and any exact error messages.
11. When readiness and validation are green, click **Run optimization** once.
12. Watch the state change through queued, preparing, validating, solving and
    processing results.
13. A genuine successful run says `Completed`, termination `optimal`, and shows
    the objective **Total hydrogen imbalance**, real charts, and raw tables.

The first full solve may use substantial memory and time. Leave Docker Desktop
running. Closing the browser does not stop the worker; reopening the run recovers
its persisted status. Use **Cancel run** to terminate it deliberately.

## Normal use after setup

After restarting Windows:

1. Open Docker Desktop.
2. Wait for its engine to run.
3. Double-click `Start Hydrogen Hub.bat`.

For another scenario:

```text
Open project → change supported inputs → Validate → Run optimization
```

You do **not** repeat package installation, tests, image builds, environment-file
creation, licence placement, or setup for every run.

## Stop without losing results

Run:

```powershell
PowerShell -NoProfile -ExecutionPolicy Bypass -File .\Stop-Hydrogen-Hub.ps1
```

This stops containers but preserves the named Docker volume. Starting again
restores completed runs; an interrupted active run is safely requeued by the
worker.

Do not run this unless you intend to erase persisted solver runs:

```text
docker compose down -v
```

Browser projects are stored in this browser's local storage. Do not clear site
data for `localhost:8080` if you want to retain their names and configurations.

## Logs and troubleshooting

Show recent redacted logs:

```powershell
PowerShell -NoProfile -ExecutionPolicy Bypass -File .\View-Hydrogen-Hub-Logs.ps1
```

### Docker is installed but unavailable

Open Docker Desktop and wait for the engine. If `docker version` has no Server
section, restart Docker Desktop or Windows.

### Port 8080 is occupied

Open `.env` in Notepad and change:

```env
HYDROGEN_HUB_PORT=8081
```

Run setup again after this configuration change. The address becomes
`http://localhost:8081`.

### Licence is `missing`

Check the exact path and extension: `secrets\gurobi.lic`. Then restart:

```powershell
docker compose restart backend worker
```

### Licence is `restricted`

You are using the pip size-limited licence, not a full licence. Replace the file
with a valid full WLS/commercial licence and restart the backend and worker.

### Licence is `invalid` or `invocation_failed`

Check expiry, WLS eligibility, computer date/time, and internet access. Do not
post the licence file. Use the redacted logs plus the public error when asking
for help.

### WLS expires

Academic WLS is normally valid for 90 days and can be renewed while you remain
eligible. Download the renewed `gurobi.lic`, replace the old private file, and
run:

```powershell
docker compose restart backend worker
PowerShell -NoProfile -ExecutionPolicy Bypass -File .\Check-Hydrogen-Hub.ps1
```

You do not rebuild the app merely because a licence was renewed.

### One service is unhealthy

Run the check and logs scripts. `Setup-Hydrogen-Hub.ps1` deliberately stops with
a visible error rather than pretending the app is ready.

### The worker stops

Run `Check-Hydrogen-Hub.ps1`, then `View-Hydrogen-Hub-Logs.ps1`. Docker's
`restart: unless-stopped` policy normally restarts the worker automatically. If
it remains unhealthy, run:

```powershell
docker compose restart worker
```

The restarted worker recovers persisted interrupted work; it does not create a
second concurrent solve.

### A run remains queued

Only one optimization is allowed at a time. Check whether another run is active
in the application or in `Check-Hydrogen-Hub.ps1`. If the queue is non-empty but
there is no active run and the worker is unhealthy, restart the worker as shown
above. Do not submit the same run repeatedly; its idempotency key deliberately
prevents duplicates.

### A run fails

Read the safe error shown in the application, then run
`View-Hydrogen-Hub-Logs.ps1`. Keep the run ID visible when asking for support,
but do not share the licence file. A non-optimal, infeasible, solver-error, or
unexpected termination is displayed as failed and never as a completed result.

### Cancellation takes a few seconds

An executing solve first changes to `cancelling`. The worker sends graceful
termination to the entire solver process group and allows a 15-second cleanup
period before forced termination. Do not repeatedly click Cancel or stop Docker
during that interval.

### The browser cannot connect

Confirm Docker Desktop is running and use `Check-Hydrogen-Hub.ps1`. Verify the
address printed by the script, including a changed port from `.env`. If the
frontend is unhealthy, restart the stack with `Start Hydrogen Hub.bat`; if it
still fails, inspect the redacted logs. A firewall rule is normally unnecessary
because the app listens only on the local computer (`127.0.0.1`).

### Back up completed runs

Stop the application first. The exact Docker-volume backup and intentional
restore commands are in `IMPLEMENTATION_REPORT.md`. The backup covers run
records, staged inputs, manifests, logs, and result artifacts. Browser-saved
project names/configurations are separate local browser storage; do not clear
site data for the application address.

## Security boundary

- Frontend is bound to `127.0.0.1`, not the LAN.
- Local single-user mode has no login or remote-user authorization.
- Do not expose port 8080 to the internet.
- No Supabase account, migration or private key is needed.
- The licence is never copied into an image or archive.
- Logs are redacted for common secret/token names, but still review them before
  sharing.
