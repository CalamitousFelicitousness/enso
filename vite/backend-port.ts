import fs from "fs";
import http from "http";
import path from "path";

const portFilePaths = [
  path.resolve(process.cwd(), ".sdnext.port"),
  path.join(process.env.HOME || "", ".sdnext.port"),
];

function readPortFile(): string | null {
  for (const p of portFilePaths) {
    try {
      const port = fs.readFileSync(p, "utf-8").trim();
      if (port && /^\d+$/.test(port)) return port;
    } catch {
      /* not found */
    }
  }
  return null;
}

function writePortFile(port: string) {
  for (const p of portFilePaths) {
    try {
      fs.writeFileSync(p, port, "utf-8");
    } catch {
      /* ignore */
    }
  }
}

function probePort(port: number, timeout = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/sdapi/v1/cmd-flags`, { timeout }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Resolve the SD.Next backend port. Priority order:
 *   1. `envPort` (typically `process.env.BACKEND_PORT`) — always wins
 *   2. `.sdnext.port` file in CWD or `$HOME` — trusted even if SD.Next is offline
 *   3. Probe candidates 7855, 7860..7865 via `/sdapi/v1/cmd-flags` — discovery
 *   4. Fallback `"7860"` when nothing is reachable
 *
 * Used by both `vite.config.ts` (proxy setup) and snapshot scripts in
 * `scripts/openapi-*.ts` (live `/openapi.json` fetch).
 */
export async function detectBackendPort(envPort?: string): Promise<string> {
  if (envPort) return envPort;

  const filePort = readPortFile();
  if (filePort) return filePort;

  const candidates = [7855, 7860, 7861, 7862, 7863, 7864, 7865];
  const results = await Promise.all(
    candidates.map(async (p) => ({ port: p, alive: await probePort(p) })),
  );
  const found = results.find((r) => r.alive);
  if (found) {
    const port = String(found.port);
    writePortFile(port);
    return port;
  }

  return "7860";
}
