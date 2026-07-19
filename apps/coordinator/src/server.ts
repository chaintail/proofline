/**
 * Proofline coordinator — observer/recorder + SSE fan-out + replay serving.
 *
 *   POST /runs                  start a run (meta: fixture, contracts, …)
 *   POST /events                { simulated, event } → seq+timestamp assigned here
 *   POST /runs/finalize         { attestationId, artifacts } → manifest.json
 *   GET  /events                SSE stream (backlog + live)
 *   GET  /runs/:id/manifest     recorded manifest (replay mode input)
 *   GET  /healthz
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { EventStore } from "./event-store/store";
import { SseHub } from "./sse/broadcast";

const PORT = Number(process.env.PORT ?? 4600);
const EVIDENCE_ROOT = resolve(
  process.env.EVIDENCE_ROOT ?? new URL("../../../evidence/runs", import.meta.url).pathname,
);

const store = new EventStore(EVIDENCE_ROOT);
const hub = new SseHub();
store.subscribe((e) => hub.send(e));

function json(res: import("node:http").ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: import("node:http").IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { ok: true });

    if (req.method === "POST" && url.pathname === "/runs") {
      const meta = await readBody(req);
      const run = store.startRun(meta);
      return json(res, 201, { runId: run.runId, dir: run.dir });
    }

    if (req.method === "POST" && url.pathname === "/events") {
      const { event, simulated = false } = await readBody(req);
      if (!event?.type) return json(res, 400, { error: "event.type required" });
      return json(res, 201, store.record(event, Boolean(simulated)));
    }

    if (req.method === "POST" && url.pathname === "/runs/finalize") {
      const { attestationId, artifacts = {} } = await readBody(req);
      return json(res, 200, store.finalize(attestationId, artifacts));
    }

    if (req.method === "GET" && url.pathname === "/events") {
      hub.attach(res, store.active?.events ?? []);
      return;
    }

    if (req.method === "GET" && url.pathname === "/runs") {
      const runs = existsSync(EVIDENCE_ROOT)
        ? readdirSync(EVIDENCE_ROOT).filter((d) =>
            existsSync(join(EVIDENCE_ROOT, d, "manifest.json")),
          )
        : [];
      return json(res, 200, { runs });
    }

    const m = url.pathname.match(/^\/runs\/([\w.-]+)\/manifest$/);
    if (req.method === "GET" && m) {
      const p = join(EVIDENCE_ROOT, m[1], "manifest.json");
      if (!existsSync(p)) return json(res, 404, { error: "not found" });
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      return res.end(readFileSync(p));
    }

    json(res, 404, { error: "no route" });
  } catch (err) {
    json(res, 500, { error: String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`coordinator listening on :${PORT}, evidence at ${EVIDENCE_ROOT}`);
});
