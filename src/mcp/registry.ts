type JsonSchema = {
  required?: string[];
  properties?: Record<string, JsonSchema>;
  type?: string | string[];
  description?: string;
};

export type McpToolResult = {
  qualified_name: string;
  server: string;
  tool: string;
  description?: string;
  schema?: {
    input?: JsonSchema;
  };
};

export type McpSearchResponse = {
  results: McpToolResult[];
  total_matches?: number;
  query?: string;
};

export type McpSearchRequest = {
  query: string;
  server?: string;
  include_schema?: boolean;
  limit?: number;
};

export type McpSearch = (request: McpSearchRequest) => Promise<McpSearchResponse>;

export type RiskLevel = "read" | "write" | "unknown";

export type ToolDefinition = {
  qualifiedName: string;
  server: string;
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
  requiredFields: string[];
  risk: RiskLevel;
};

export type ToolRegistry = {
  toolsByQualifiedName: Map<string, ToolDefinition>;
  toolsByServer: Map<string, ToolDefinition[]>;
};

export type DecisionAction = "invoke" | "clarify" | "confirm";

export type Decision = {
  action: DecisionAction;
  reason: string;
  tool: ToolDefinition;
  args: Record<string, unknown>;
  missingFields?: string[];
};

const READ_VERBS = [
  "get",
  "list",
  "fetch",
  "read",
  "search",
  "query",
  "describe",
  "inspect",
  "view",
  "status",
  "check",
  "lookup",
  "preview",
  "analyze",
  "scan",
  "crawl",
  "scrape",
];

const WRITE_VERBS = [
  "create",
  "update",
  "delete",
  "remove",
  "add",
  "set",
  "patch",
  "post",
  "put",
  "deploy",
  "restart",
  "start",
  "stop",
  "run",
  "execute",
  "install",
  "uninstall",
  "grant",
  "revoke",
  "upload",
  "import",
  "export",
  "merge",
  "push",
  "commit",
  "schedule",
  "cancel",
  "approve",
  "deny",
  "charge",
  "transfer",
  "send",
];

const SENSITIVE_FIELDS = [
  "password",
  "secret",
  "token",
  "key",
  "credential",
  "auth",
  "bearer",
  "private",
  "env",
  "filesystem",
  "path",
  "command",
  "sql",
  "script",
  "code",
];

const WRITE_FIELDS = [
  "create",
  "update",
  "delete",
  "remove",
  "write",
  "execute",
  "run",
  "deploy",
];

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const hasKeyword = (text: string, keywords: string[]): boolean =>
  keywords.some((keyword) => text.includes(keyword));

const collectSchemaFields = (schema?: JsonSchema): string[] => {
  if (!schema?.properties) {
    return [];
  }
  return Object.keys(schema.properties).map((key) => normalizeText(key));
};

const getRequiredFields = (schema?: JsonSchema): string[] => {
  if (!schema?.required) {
    return [];
  }
  return schema.required.filter((field): field is string => typeof field === "string");
};

export const classifyRisk = (tool: McpToolResult): RiskLevel => {
  const text = normalizeText(
    [tool.qualified_name, tool.tool, tool.description ?? ""].join(" "),
  );
  const schemaFields = collectSchemaFields(tool.schema?.input);
  const schemaText = schemaFields.join(" ");

  const hasWriteVerb = hasKeyword(text, WRITE_VERBS);
  const hasReadVerb = hasKeyword(text, READ_VERBS);
  const hasSensitiveField = hasKeyword(schemaText, SENSITIVE_FIELDS);
  const hasWriteField = hasKeyword(schemaText, WRITE_FIELDS);

  if (hasWriteVerb || hasWriteField || hasSensitiveField) {
    return "write";
  }
  if (hasReadVerb) {
    return "read";
  }
  return "unknown";
};

export const buildRegistry = (response: McpSearchResponse): ToolRegistry => {
  const toolsByQualifiedName = new Map<string, ToolDefinition>();
  const toolsByServer = new Map<string, ToolDefinition[]>();

  response.results.forEach((tool) => {
    const inputSchema = tool.schema?.input;
    const requiredFields = getRequiredFields(inputSchema);
    const risk = classifyRisk(tool);
    const entry: ToolDefinition = {
      qualifiedName: tool.qualified_name,
      server: tool.server,
      name: tool.tool,
      description: tool.description,
      inputSchema,
      requiredFields,
      risk,
    };

    toolsByQualifiedName.set(tool.qualified_name, entry);

    const serverTools = toolsByServer.get(tool.server);
    if (serverTools) {
      serverTools.push(entry);
    } else {
      toolsByServer.set(tool.server, [entry]);
    }
  });

  return { toolsByQualifiedName, toolsByServer };
};

export const refreshRegistry = async (
  mcpSearch: McpSearch,
  {
    query = "tool",
    server,
    limit = 200,
  }: { query?: string; server?: string; limit?: number } = {},
): Promise<ToolRegistry> => {
  const response = await mcpSearch({
    query,
    server,
    include_schema: true,
    limit,
  });
  return buildRegistry(response);
};

export type RegistryManagerOptions = {
  query?: string;
  server?: string;
  limit?: number;
  ttlMs?: number;
};

export type RegistryManager = {
  getRegistry: (options?: {
    query?: string;
    server?: string;
    limit?: number;
    force?: boolean;
  }) => Promise<ToolRegistry>;
  refresh: (options?: { query?: string; server?: string; limit?: number }) => Promise<ToolRegistry>;
  invalidate: () => void;
  lastUpdated: () => number | null;
};

export const createRegistryManager = (
  mcpSearch: McpSearch,
  defaults: RegistryManagerOptions = {},
): RegistryManager => {
  let registry: ToolRegistry | null = null;
  let lastUpdated = 0;
  let inflight: Promise<ToolRegistry> | null = null;
  let lastQuery = defaults.query ?? "tool";
  let lastServer = defaults.server;
  let lastLimit = defaults.limit ?? 200;
  const ttlMs = defaults.ttlMs ?? 60_000;

  const shouldRefresh = (options: {
    query?: string;
    server?: string;
    limit?: number;
    force?: boolean;
  }): boolean => {
    if (options.force) {
      return true;
    }
    if (!registry) {
      return true;
    }
    if (ttlMs <= 0) {
      return true;
    }
    const now = Date.now();
    if (now - lastUpdated >= ttlMs) {
      return true;
    }
    if (options.query && options.query !== lastQuery) {
      return true;
    }
    if (options.server !== undefined && options.server !== lastServer) {
      return true;
    }
    if (options.limit && options.limit !== lastLimit) {
      return true;
    }
    return false;
  };

  const doRefresh = (options: { query?: string; server?: string; limit?: number }) => {
    if (inflight) {
      return inflight;
    }
    const nextQuery = options.query ?? lastQuery ?? "tool";
    const nextServer =
      options.server === undefined ? lastServer : options.server;
    const nextLimit = options.limit ?? lastLimit ?? 200;
    inflight = refreshRegistry(mcpSearch, {
      query: nextQuery,
      server: nextServer,
      limit: nextLimit,
    })
      .then((nextRegistry) => {
        registry = nextRegistry;
        lastUpdated = Date.now();
        lastQuery = nextQuery;
        lastServer = nextServer;
        lastLimit = nextLimit;
        return nextRegistry;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return {
    getRegistry: async (options = {}) => {
      if (shouldRefresh(options)) {
        return doRefresh(options);
      }
      return registry as ToolRegistry;
    },
    refresh: async (options = {}) => doRefresh(options),
    invalidate: () => {
      registry = null;
      lastUpdated = 0;
    },
    lastUpdated: () => (lastUpdated === 0 ? null : lastUpdated),
  };
};

const findMissingRequiredFields = (
  requiredFields: string[],
  args: Record<string, unknown>,
): string[] =>
  requiredFields.filter((field) => args[field] === undefined || args[field] === null);

export const decideInvocation = ({
  tool,
  args,
}: {
  tool: ToolDefinition;
  args: Record<string, unknown>;
}): Decision => {
  const missingFields = findMissingRequiredFields(tool.requiredFields, args);
  if (missingFields.length > 0) {
    return {
      action: "clarify",
      reason: "Missing required tool arguments.",
      tool,
      args,
      missingFields,
    };
  }

  if (tool.risk !== "read") {
    return {
      action: "confirm",
      reason: "Tool classified as write or unknown risk.",
      tool,
      args,
    };
  }

  return {
    action: "invoke",
    reason: "Read-only tool with required arguments present.",
    tool,
    args,
  };
};
