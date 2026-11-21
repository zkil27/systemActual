// Kyna Ops print agent for the warehouse PC.
//  - Every few seconds: asks the app for labels to print and prints them silently.
//  - Every minute: runs the app's sync (the daytime clock; webhooks cover the night).
//  - Once a day (optional): backs up the database with pg_dump.
// Only makes outgoing HTTPS requests. No ports are opened on the PC.
import { print, getDefaultPrinter } from "pdf-to-printer";
import { execFile } from "node:child_process";
import { mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const VERSION = "1.0.0";
const BASE = (process.env.KYNA_URL || "").replace(/\/$/, "");
const TOKEN = (process.env.DEVICE_TOKEN || "").trim();
const PRINTER = (process.env.PRINTER_NAME || "").trim() || undefined;
const PAPER = (process.env.PAPER_SIZE || "4x6").trim();
const POLL_MS = 5_000;
const TICK_MS = 60_000;

if (!BASE.startsWith("https://") && !BASE.startsWith("http://localhost")) {
  console.error("KYNA_URL must be your https:// Kyna Ops address. Check .env");
  process.exit(1);
}
if (!TOKEN.startsWith("kpd_")) {
  console.error("DEVICE_TOKEN is missing. Get it from Kyna Ops > Settings > Printer.");
  process.exit(1);
}

const log = (...a) => console.log(new Date().toLocaleString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function printOne(job) {
  const res = await api(`/api/agent/jobs/${encodeURIComponent(job.id)}/pdf`, { raw: true });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Couldn't get the PDF (${res.status})`);
  }
  const file = path.join(tmpdir(), `kyna-${job.id}.pdf`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  try {
    await print(file, { printer: PRINTER, paperSize: PAPER, scale: "noscale", silent: true });
  } finally {
    await unlink(file).catch(() => {});
  }
}

async function report(job, result) {
  const r = await api(`/api/agent/jobs/${encodeURIComponent(job.id)}/status`, { method: "POST", body: result });
  return Boolean(r.data?.paused);
}

async function printLoop() {
  let printerName = PRINTER;
  if (!printerName) printerName = (await getDefaultPrinter().catch(() => null))?.name ?? "default printer";
  log(`Printing to: ${printerName} (${PAPER})`);

  for (;;) {
    try {
      const { ok, data } = await api("/api/agent/poll", { method: "POST", body: { version: VERSION, printer: printerName } });
      const jobs = ok && !data.paused ? data.jobs ?? [] : [];
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        let paused = false;
        try {
          await printOne(job);
          paused = await report(job, { status: "PRINTED" });
          log(`Printed: ${job.title}`);
        } catch (err) {
          if (err.fatal) throw err;
          log(`FAILED: ${job.title}: ${err.message}`);
          paused = await report(job, { status: "FAILED", error: String(err.message || err) }).catch(() => false);
        }
        if (paused && i < jobs.length - 1) {
          // Owner tapped Pause (e.g. changing the label roll): hand the rest back.
          await api("/api/agent/release", { method: "POST" }).catch(() => {});
          log("Paused from the phone.");
          break;
        }
      }
      if (!jobs.length) await sleep(POLL_MS);
    } catch (err) {
      if (err.fatal) {
        log(err.message);
        await sleep(60_000);
      } else {
        log(`Can't reach Kyna Ops (${err.message}). Retrying.`);
        await sleep(POLL_MS * 2);
      }
    }
  }
}

// ------------------------------------------------------------------ sync clock

async function tickLoop() {
  for (;;) {
    try {
      const { ok, status } = await api("/api/worker/tick", { method: "POST", timeoutMs: 90_000 });
      if (!ok) log(`Sync returned ${status}`);
    } catch (err) {
      if (!err.fatal) log(`Sync failed (${err.message})`);
    }
    await sleep(TICK_MS);
  }
}

// ------------------------------------------------------------------ nightly backup

const BACKUP_URL = (process.env.BACKUP_DATABASE_URL || "").trim();
const BACKUP_DIR = process.env.BACKUP_DIR || "C:\\KynaBackups";
const BACKUP_HOUR = Number(process.env.BACKUP_HOUR ?? 18);
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP ?? 7);

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
  for (;;) {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const file = path.join(BACKUP_DIR, `kyna-${day}.dump`);
    const files = (await readdir(BACKUP_DIR).catch(() => [])).filter((f) => /^kyna-\d{4}-\d{2}-\d{2}\.dump$/.test(f)).sort();
    if (now.getHours() >= BACKUP_HOUR && !files.includes(path.basename(file))) {
      try {
        await runPgDump(file);
        log(`Backup saved: ${file}`);
        for (const old of [...files, path.basename(file)].sort().slice(0, -BACKUP_KEEP)) {
          await rm(path.join(BACKUP_DIR, old)).catch(() => {});
        }
      } catch (err) {
        log(`Backup failed: ${err.message}`);
        await rm(file).catch(() => {});
      }
    }
    await sleep(30 * 60_000);
  }
}

log(`Kyna Ops print agent ${VERSION} → ${BASE}`);
printLoop();
tickLoop();
backupLoop();
