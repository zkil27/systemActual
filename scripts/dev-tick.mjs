// Local stand-in for the warehouse PC agent: calls the worker tick every minute.
// Usage (with `npm run dev` running in another terminal):  npm run dev:tick
const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.WORKER_SECRET;
if (!secret) {
  console.error("WORKER_SECRET is not set in .env");
  process.exit(1);
}

async function tick() {
  const started = new Date().toLocaleTimeString();
  try {
    const res = await fetch(`${base}/api/worker/tick`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    console.log(started, res.status, await res.text());
  } catch (err) {
    console.error(started, "tick failed:", err.message);
  }
}

await tick();
setInterval(tick, 60_000);
