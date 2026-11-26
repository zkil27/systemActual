// Kyna Ops print agent for the warehouse PC.
//  - Every few seconds: asks the app for labels to print and prints them silently.
//  - Every minute: runs the app's sync (the daytime clock; webhooks cover the night).
//  - Once a day (optional): backs up the database with pg_dump.
// Only makes outgoing HTTPS requests. No ports are opened on the PC.
// pdf-to-printer is CommonJS: newer Node can't import its functions by name, so take them off the default export.
import pdfToPrinter from "pdf-to-printer";
const { print, getDefaultPrinter } = pdfToPrinter;
import { execFile } from "node:child_process";
import { appendFile, mkdir, open, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const VERSION = "1.2.0";
const BASE = (process.env.KYNA_URL || "").replace(/\/$/, "");
const TOKEN = (process.env.DEVICE_TOKEN || "").trim();
const PRINTER = (process.env.PRINTER_NAME || "").trim() || undefined;
const PAPER = (process.env.PAPER_SIZE || "4x6").trim();
// "shrink": labels that fit print at 100%; a label bigger than the sticker
// (TikTok's is 105 x 148 mm, wider than 4x6) is scaled down instead of cut off.
const SCALE = (process.env.PRINT_SCALE || "shrink").trim();
// "off": print only, don't run the app's sync (for testing a printer on a PC that isn't the warehouse PC).
const SYNC_CLOCK = (process.env.SYNC_CLOCK || "on").trim().toLowerCase() !== "off";
// "TEST": only ever print test pages. Real labels and pick lists stay queued for the warehouse PC.
const PRINT_ONLY = (process.env.PRINT_ONLY || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const DEFAULT_POLL_MS = 30_000;
const DEFAULT_TICK_MS = 180_000;

if (!BASE.startsWith("https://") && !BASE.startsWith("http://localhost")) {
  console.error("KYNA_URL must be your https:// Kyna Ops address. Check .env");
  process.exit(1);
}
if (!TOKEN.startsWith("kpd_")) {
  console.error("DEVICE_TOKEN is missing. Get it from Kyna Ops > Settings > Printer.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ logs
// One file per day in LOG_DIR (default: the backup folder), last LOG_KEEP days kept,
// so "what happened at 2 PM yesterday?" has an answer even after a restart.
const LOG_DIR = process.env.LOG_DIR || process.env.BACKUP_DIR || "C:\\KynaBackups";
const LOG_KEEP = Number(process.env.LOG_KEEP ?? 14);
let logDirReady = null;
let lastLogPrune = "";

function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function writeLogLine(line) {
  try {
    logDirReady ??= mkdir(LOG_DIR, { recursive: true });
    await logDirReady;
    const day = localDay();
    await appendFile(path.join(LOG_DIR, `agent-${day}.log`), line + "\r\n");
    if (lastLogPrune !== day) {
      lastLogPrune = day;
      const files = (await readdir(LOG_DIR)).filter((f) => /^agent-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
      for (const old of files.slice(0, Math.max(0, files.length - LOG_KEEP))) await rm(path.join(LOG_DIR, old)).catch(() => {});
    }
  } catch {
    // Logging must never stop printing.
  }
}

const log = (...a) => {
  const line = [new Date().toLocaleString(), ...a].join(" ");
  console.log(line);
  void writeLogLine(line);
};

// ------------------------------------------------------------------ printer status (Windows)
// Asks Windows what the printer says (Get-Printer). A label sent to an offline or
// out-of-paper printer just sits in the spooler, so we stop before sending it.
const TROUBLE = /offline|error|paper|jam|door|toner|stopped|paused|notavailable|problem/i;
let statusCache = { at: 0, value: null };

function readPrinterStatus(name) {
  if (process.platform !== "win32" || !name) return Promise.resolve(null);
  if (Date.now() - statusCache.at < 20_000) return Promise.resolve(statusCache.value);
  // The name goes in through an environment variable, never into the command text.
  const script =
    "$p = Get-Printer -Name $env:KYNA_PRINTER -ErrorAction Stop; " +
    "if ($p.WorkOffline) { 'Offline' } else { [string]$p.PrinterStatus }";
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 10_000, env: { ...process.env, KYNA_PRINTER: name }, windowsHide: true },
      (err, stdout) => {
        const value = err ? null : String(stdout).trim().split(/\r?\n/).pop() || null;
        statusCache = { at: Date.now(), value };
        resolve(value);
      }
    );
  });
}

function printerTrouble(status) {
  return Boolean(status && TROUBLE.test(status) && !/^normal$/i.test(status));
}

async function api(pathname, { method = "GET", body, raw = false, timeoutMs = 60_000 } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw Object.assign(new Error("The printer code was rejected. Make a new one in Settings > Printer."), { fatal: true });
  return { ok: res.ok, status: res.status, data };
}

// ------------------------------------------------------------------ printing

async function fetchJobPdfBuffer(job) {
  if (job.docUrl) {
    try {
      const direct = await fetch(job.docUrl, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
      if (direct.ok) {
        const buf = Buffer.from(await direct.arrayBuffer());
        if (buf.subarray(0, 4).toString("latin1") === "%PDF") return buf;
      }
    } catch {
      // Fall back to Kyna Ops endpoint if direct CDN URL expired or failed.
    }
  }
  const res = await api(`/api/agent/jobs/${encodeURIComponent(job.id)}/pdf`, { raw: true });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Couldn't get the PDF (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function printOne(job) {
  const buf = await fetchJobPdfBuffer(job);
  const file = path.join(tmpdir(), `kyna-${job.id}.pdf`);
  await writeFile(file, buf);
  try {
    await print(file, { printer: PRINTER, paperSize: PAPER, scale: SCALE, silent: true });
  } finally {
    await unlink(file).catch(() => {});
  }
}

async function reportBatch(results) {
  if (!results.length) return false;
  const r = await api("/api/agent/jobs/status-batch", { method: "POST", body: { results } });
  return Boolean(r.data?.paused);
}

async function printLoop() {
  let printerName = PRINTER;
  if (!printerName) printerName = (await getDefaultPrinter().catch(() => null))?.name ?? "default printer";
  let lastTrouble = null;
  log(`Printing to: ${printerName} (${PAPER}, scale: ${SCALE})`);
  if (PRINT_ONLY.length) log(`Only printing: ${PRINT_ONLY.join(", ")}. Real labels are left for the warehouse PC.`);

  for (;;) {
    try {
      const printerStatus = await readPrinterStatus(printerName);
      const { ok, data } = await api("/api/agent/poll", {
        method: "POST",
        body: {
          version: VERSION,
          printer: printerName,
          printerStatus,
          backup: backupState,
          ...(PRINT_ONLY.length ? { kinds: PRINT_ONLY } : {}),
        },
      });
      let jobs = ok && !data.paused ? data.jobs ?? [] : [];
      if (PRINT_ONLY.length && jobs.some((j) => !PRINT_ONLY.includes(j.kind))) {
        // An app that ignores the filter handed us something else: never print it, put it all back.
        log(`Refused ${jobs.filter((j) => !PRINT_ONLY.includes(j.kind)).length} job(s) that aren't ${PRINT_ONLY.join("/")}. Returned to the queue.`);
        await api("/api/agent/release", { method: "POST" }).catch(() => {});
        jobs = [];
      }
      let pausedMidChunk = false;
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        // Check the printer (cached 20s) before each label: never mark PRINTED what can't come out.
        const status = await readPrinterStatus(printerName);
        if (printerTrouble(status)) {
          if (lastTrouble !== status) log(`Printer says "${status}". Holding ${jobs.length - i} job(s) until it's fixed.`);
          lastTrouble = status;
          await api("/api/agent/release", { method: "POST" }).catch(() => {});
          pausedMidChunk = true;
          break;
        }
        if (lastTrouble) {
          log("Printer is back. Printing again.");
          lastTrouble = null;
        }
        let outcome;
        try {
          await printOne(job);
          outcome = { id: job.id, status: "PRINTED" };
          log(`Printed: ${job.title}`);
        } catch (err) {
          if (err.fatal) throw err;
          log(`FAILED: ${job.title}: ${err.message}`);
          outcome = { id: job.id, status: "FAILED", error: String(err.message || err) };
        }
        // Report after each job so heartbeat stays fresh, pause stops within 1 job,
        // and large label waves never risk stale-claim timeouts.
        const paused = await reportBatch([outcome]).catch(() => false);
        if (paused) {
          pausedMidChunk = true;
          await api("/api/agent/release", { method: "POST" }).catch(() => {});
          log("Paused from the phone.");
          break;
        }
      }
      if (!jobs.length || pausedMidChunk) {
        await sleep(typeof data?.nextPollMs === "number" ? data.nextPollMs : DEFAULT_POLL_MS);
      }
    } catch (err) {
      if (err.fatal) {
        log(err.message);
        await sleep(60_000);
      } else {
        log(`Can't reach Kyna Ops (${err.message}). Retrying.`);
        await sleep(10_000);
      }
    }
  }
}

// ------------------------------------------------------------------ sync clock

async function tickLoop() {
  for (;;) {
    let nextMs = DEFAULT_TICK_MS;
    try {
      // Server TICK_BUDGET_MS is 90s and maxDuration is 120s; wait 125s so slow ticks return nextTickMs cleanly.
      const { ok, status, data } = await api("/api/worker/tick", { method: "POST", timeoutMs: 125_000 });
      if (!ok) log(`Sync returned ${status}`);
      else if (typeof data?.nextTickMs === "number") nextMs = data.nextTickMs;
    } catch (err) {
      if (!err.fatal) log(`Sync failed (${err.message})`);
    }
    await sleep(nextMs);
  }
}

// ------------------------------------------------------------------ nightly backup

const BACKUP_URL = (process.env.BACKUP_DATABASE_URL || "").trim();
const BACKUP_DIR = process.env.BACKUP_DIR || "C:\\KynaBackups";
const BACKUP_HOUR = Number(process.env.BACKUP_HOUR ?? 18);
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP ?? 7);
/** Reported to the app on every poll, so the owner sees a failed backup on the phone. */
const backupState = { enabled: Boolean(BACKUP_URL), lastBackupAt: null, lastBackupError: null, lastBackupBytes: null };
/** A real custom-format dump starts with "PGDMP" and is never tiny. */
const MIN_DUMP_BYTES = 10 * 1024;

async function verifyDump(file) {
  const info = await stat(file);
  if (info.size < MIN_DUMP_BYTES) throw new Error(`Backup file is only ${info.size} bytes`);
  const fh = await open(file, "r");
  try {
    const head = Buffer.alloc(5);
    await fh.read(head, 0, 5, 0);
    if (head.toString("latin1") !== "PGDMP") throw new Error("Backup file is not a pg_dump archive");
  } finally {
    await fh.close();
  }
  return info;
}

/** On start, report the newest existing backup so a restart doesn't look like "never backed up". */
async function loadLastBackup() {
  const files = (await readdir(BACKUP_DIR).catch(() => [])).filter((f) => /^kyna-\d{4}-\d{2}-\d{2}\.dump$/.test(f)).sort();
  const newest = files[files.length - 1];
  if (!newest) return;
  try {
    const info = await verifyDump(path.join(BACKUP_DIR, newest));
    backupState.lastBackupAt = info.mtime.toISOString();
    backupState.lastBackupBytes = info.size;
  } catch (err) {
    backupState.lastBackupError = `${newest}: ${err.message}`;
  }
}

function runPgDump(file) {
  return new Promise((resolve, reject) => {
    // Arguments are passed as a list (no shell), so the URL can't be mangled or injected.
    execFile("pg_dump", ["--format=custom", `--file=${file}`, `--dbname=${BACKUP_URL}`], { timeout: 15 * 60_000 }, (err, _out, stderr) =>
      err ? reject(new Error(stderr?.toString().trim() || err.message)) : resolve()
    );
  });
}

async function backupLoop() {
  if (!BACKUP_URL) return;
  await mkdir(BACKUP_DIR, { recursive: true });
  await loadLastBackup();
  for (;;) {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const file = path.join(BACKUP_DIR, `kyna-${day}.dump`);
    const files = (await readdir(BACKUP_DIR).catch(() => [])).filter((f) => /^kyna-\d{4}-\d{2}-\d{2}\.dump$/.test(f)).sort();
    if (now.getHours() >= BACKUP_HOUR && !files.includes(path.basename(file))) {
      try {
        await runPgDump(file);
        const info = await verifyDump(file);
        backupState.lastBackupAt = new Date().toISOString();
        backupState.lastBackupBytes = info.size;
        backupState.lastBackupError = null;
        log(`Backup saved: ${file} (${(info.size / 1_048_576).toFixed(1)} MB)`);
        // Only rotate old backups once today's is known good.
        for (const old of [...files, path.basename(file)].sort().slice(0, -BACKUP_KEEP)) {
          await rm(path.join(BACKUP_DIR, old)).catch(() => {});
        }
      } catch (err) {
        backupState.lastBackupError = String(err.message || err).slice(0, 300);
        log(`Backup failed: ${err.message}`);
        await rm(file).catch(() => {});
      }
    }
    await sleep(30 * 60_000);
  }
}

log(`Kyna Ops print agent ${VERSION} → ${BASE}`);
printLoop();
if (SYNC_CLOCK) tickLoop();
else log("Sync clock off (SYNC_CLOCK=off): printing only.");
backupLoop();
