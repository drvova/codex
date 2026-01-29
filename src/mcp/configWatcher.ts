import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type McpConfig = {
  path: string;
  raw: string;
  mcpServers: string[];
};

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".codex", "config.toml");
const WATCH_INTERVAL_MS = 500;
const DEBOUNCE_MS = 100;

const resolveConfigPath = (): string =>
  process.env.CODEX_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;

const extractMcpServers = (raw: string): string[] => {
  const servers = new Set<string>();
  let inMcpServers = false;

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inMcpServers = trimmed === "[mcp_servers]";
      const match = trimmed.match(/^\[mcp_servers\.([^\]]+)\]$/);
      if (match) {
        servers.add(match[1].trim());
      }
      return;
    }

    if (!inMcpServers) {
      return;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      return;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    if (key.length > 0) {
      servers.add(key.replace(/^["']|["']$/g, ""));
    }
  });

  return Array.from(servers).sort();
};

const readConfig = async (configPath: string): Promise<McpConfig | null> => {
  try {
    const raw = await fs.promises.readFile(configPath, "utf8");
    return {
      path: configPath,
      raw,
      mcpServers: extractMcpServers(raw),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

export const onMcpConfigChange = (
  cb: (cfg: McpConfig) => void,
): (() => void) => {
  const configPath = resolveConfigPath();
  let lastRaw: string | null = null;
  let closed = false;
  let debounceTimer: NodeJS.Timeout | null = null;

  const notify = async () => {
    if (closed) {
      return;
    }
    const config = await readConfig(configPath);
    if (!config) {
      return;
    }
    if (config.raw === lastRaw) {
      return;
    }
    lastRaw = config.raw;
    cb(config);
  };

  const schedule = () => {
    if (closed) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      void notify();
    }, DEBOUNCE_MS);
  };

  fs.watchFile(
    configPath,
    { interval: WATCH_INTERVAL_MS },
    (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs) {
        return;
      }
      schedule();
    },
  );

  void notify();

  return () => {
    closed = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    fs.unwatchFile(configPath);
  };
};
