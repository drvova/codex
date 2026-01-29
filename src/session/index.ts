import { createToolRouter, type ToolRouter } from "../mcp/router";
import type { McpSearch, RiskPolicy } from "../mcp/registry";

export type SessionOptions = {
  userId: string;
  mcpSearch: McpSearch;
  query?: string;
  server?: string;
  limit?: number;
  ttlMs?: number;
  baseRiskPolicy?: RiskPolicy;
};

export type Session = {
  userId: string;
  toolRouter: ToolRouter;
  close: () => void;
};

export const createSession = (options: SessionOptions): Session => {
  const { userId, mcpSearch, query, server, limit, ttlMs, baseRiskPolicy } = options;
  const toolRouter = createToolRouter(mcpSearch, {
    query,
    server,
    limit,
    ttlMs,
    baseRiskPolicy,
  });
  return {
    userId,
    toolRouter,
    close: () => toolRouter.close(),
  };
};
