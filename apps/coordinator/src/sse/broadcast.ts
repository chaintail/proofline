import type { ServerResponse } from "node:http";
import type { RunEvent } from "@proofline/event-model";

export class SseHub {
  private clients = new Set<ServerResponse>();

  attach(res: ServerResponse, backlog: RunEvent[]) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    for (const e of backlog) res.write(`data: ${JSON.stringify(e)}\n\n`);
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  send(e: RunEvent) {
    for (const c of this.clients) c.write(`data: ${JSON.stringify(e)}\n\n`);
  }
}
