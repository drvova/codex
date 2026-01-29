import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import { createToolRouter } from "../../src/mcp/router";
import type { McpSearch, McpSearchResponse } from "../../src/mcp/registry";

const makeResponse = (): McpSearchResponse => ({
  query: "tool",
  total_matches: 1,
  results: [
    {
      qualified_name: "mcp__foo__list",
      server: "foo",
      tool: "list",
      description: "List available items",
      schema: {
        input: {
          type: "object",
          required: [],
          properties: {},
        },
      },
    },
  ],
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createToolRouter", () => {
  it("invalidates cache on MCP config changes", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-config-"));
    const configPath = path.join(tempDir, "config.toml");
    await fs.writeFile(configPath, "[mcp_servers]\nfoo = { command = \"foo\" }\n");

    const prevConfigPath = process.env.CODEX_CONFIG_PATH;
    process.env.CODEX_CONFIG_PATH = configPath;

    let calls = 0;
    const mcpSearch: McpSearch = async () => {
      calls += 1;
      return makeResponse();
    };

    const router = createToolRouter(mcpSearch, { ttlMs: 60_000 });

    try {
      await sleep(700);
      await router.getRegistryForUser("user-1", { force: true });
      await router.getRegistryForUser("user-1");
      expect(calls).toBe(1);

      await fs.writeFile(
        configPath,
        "[mcp_servers]\nfoo = { command = \"foo\" }\nbar = { command = \"bar\" }\n",
      );
      await sleep(700);

      await router.getRegistryForUser("user-1");
      expect(calls).toBe(2);
    } finally {
      router.close();
      if (prevConfigPath === undefined) {
        delete process.env.CODEX_CONFIG_PATH;
      } else {
        process.env.CODEX_CONFIG_PATH = prevConfigPath;
      }
    }
  });

  it("merges per-user risk overrides from metadata", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "user-metadata-"));
    const metadataPath = path.join(tempDir, "user-metadata.json");
    const metadata = {
      users: {
        "user-1": {
          mcp: {
            riskOverrides: {
              mcp__foo__list: "read",
            },
          },
        },
      },
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata));

    const prevMetadataPath = process.env.CODEX_USER_METADATA_PATH;
    process.env.CODEX_USER_METADATA_PATH = metadataPath;

    const mcpSearch: McpSearch = async () => makeResponse();

    const router = createToolRouter(mcpSearch, {
      baseRiskPolicy: { forceWrite: ["mcp__foo__list"] },
    });

    try {
      const userDecision = await router.decideForUser({
        userId: "user-1",
        qualifiedName: "mcp__foo__list",
        args: {},
      });
      const otherDecision = await router.decideForUser({
        userId: "user-2",
        qualifiedName: "mcp__foo__list",
        args: {},
      });

      expect(userDecision?.action).toBe("invoke");
      expect(otherDecision?.action).toBe("confirm");
    } finally {
      router.close();
      if (prevMetadataPath === undefined) {
        delete process.env.CODEX_USER_METADATA_PATH;
      } else {
        process.env.CODEX_USER_METADATA_PATH = prevMetadataPath;
      }
    }
  });
});
