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

export type RiskPolicy = {
  readVerbs?: string[];
  writeVerbs?: string[];
  sensitiveFields?: string[];
  writeFields?: string[];
  readOnlyHints?: string[];
  writeHints?: string[];
  forceRead?: Array<string | RegExp>;
  forceWrite?: Array<string | RegExp>;
  overrides?: Record<string, RiskLevel>;
};

export type RiskClassifier = (tool: McpToolResult) => RiskLevel;

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

const DEFAULT_READ_VERBS = [
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

const DEFAULT_WRITE_VERBS = [
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

const DEFAULT_SENSITIVE_FIELDS = [
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

const DEFAULT_WRITE_FIELDS = [
  "create",
  "update",
  "delete",
  "remove",
  "write",
  "execute",
  "run",
  "deploy",
];

const DEFAULT_READ_ONLY_HINTS = [
  "read only",
  "readonly",
  "no side effects",
  "no side-effects",
  "non mutating",
  "non-mutating",
];

const DEFAULT_WRITE_HINTS = [
  "mutating",
  "side effect",
  "side-effect",
  "destructive",
  "dangerous",
  "write",
];

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const hasKeyword = (text: string, keywords: string[]): boolean =>
  keywords.length > 0 && keywords.some((keyword) => text.includes(keyword));

const normalizeList = (values?: string[]): string[] =>
  (values ?? [])
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);

const matchesAny = (
  normalizedText: string,
  rawText: string,
  patterns: Array<string | RegExp>,
): boolean => {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => {
    if (typeof pattern === "string") {
      return normalizedText.includes(normalizeText(pattern));
    }
    return pattern.test(rawText) || pattern.test(normalizedText);
  });
};

const collectSchemaFields = (schema?: JsonSchema): string[] => {
  if (!schema) {
    return [];
  }
  const fields = new Set<string>();
  const seen = new Set<JsonSchema>();
  const stack: JsonSchema[] = [schema];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (Array.isArray(current.required)) {
      current.required.forEach((field) => {
        if (typeof field === "string") {
          fields.add(normalizeText(field));
        }
      });
    }

    if (current.properties) {
      Object.entries(current.properties).forEach(([key, value]) => {
        fields.add(normalizeText(key));
        if (value) {
          stack.push(value);
        }
      });
    }
  }

  return Array.from(fields);
};

const getRequiredFields = (schema?: JsonSchema): string[] => {
  if (!schema?.required) {
    return [];
  }
  return schema.required.filter((field): field is string => typeof field === "string");
};

export const createRiskClassifier = (policy: RiskPolicy = {}): RiskClassifier => {
  const readVerbs = normalizeList(policy.readVerbs ?? DEFAULT_READ_VERBS);
  const writeVerbs = normalizeList(policy.writeVerbs ?? DEFAULT_WRITE_VERBS);
  const sensitiveFields = normalizeList(
    policy.sensitiveFields ?? DEFAULT_SENSITIVE_FIELDS,
  );
  const writeFields = normalizeList(policy.writeFields ?? DEFAULT_WRITE_FIELDS);
  const readOnlyHints = normalizeList(
    policy.readOnlyHints ?? DEFAULT_READ_ONLY_HINTS,
  );
  const writeHints = normalizeList(policy.writeHints ?? DEFAULT_WRITE_HINTS);
  const forceRead = policy.forceRead ?? [];
  const forceWrite = policy.forceWrite ?? [];
  const overrides = policy.overrides ?? {};

  return (tool: McpToolResult): RiskLevel => {
    const override = overrides[tool.qualified_name];
    if (override) {
      return override;
    }

    const rawText = [tool.qualified_name, tool.tool, tool.description ?? ""].join(" ");
    const text = normalizeText(rawText);
    const schemaFields = collectSchemaFields(tool.schema?.input);
    const schemaText = schemaFields.join(" ");

    if (matchesAny(text, rawText, forceWrite)) {
      return "write";
    }
    if (matchesAny(text, rawText, forceRead)) {
      return "read";
    }

    const hasWriteVerb = hasKeyword(text, writeVerbs);
    const hasReadVerb = hasKeyword(text, readVerbs);
    const hasSensitiveField = hasKeyword(schemaText, sensitiveFields);
    const hasWriteField = hasKeyword(schemaText, writeFields);
    const hasWriteHint = hasKeyword(text, writeHints);
    const hasReadOnlyHint = hasKeyword(text, readOnlyHints);

    if (hasWriteVerb || hasWriteField || hasSensitiveField || hasWriteHint) {
      return "write";
    }
    if (hasReadOnlyHint || hasReadVerb) {
      return "read";
    }
    return "unknown";
  };
};

const defaultRiskClassifier = createRiskClassifier();

export const classifyRisk = (tool: McpToolResult): RiskLevel =>
  defaultRiskClassifier(tool);

export type RegistryBuildOptions = {
  riskClassifier?: RiskClassifier;
};

export const buildRegistry = (
  response: McpSearchResponse,
  options: RegistryBuildOptions = {},
): ToolRegistry => {
  const toolsByQualifiedName = new Map<string, ToolDefinition>();
  const toolsByServer = new Map<string, ToolDefinition[]>();
  const riskClassifier = options.riskClassifier ?? defaultRiskClassifier;

  response.results.forEach((tool) => {
    const inputSchema = tool.schema?.input;
    const requiredFields = getRequiredFields(inputSchema);
    const risk = riskClassifier(tool);
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
    riskClassifier,
  }: {
    query?: string;
    server?: string;
    limit?: number;
    riskClassifier?: RiskClassifier;
  } = {},
): Promise<ToolRegistry> => {
  const response = await mcpSearch({
    query,
    server,
    include_schema: true,
    limit,
  });
  return buildRegistry(response, { riskClassifier });
};

export type RegistryManagerOptions = {
  query?: string;
  server?: string;
  limit?: number;
  ttlMs?: number;
  riskClassifier?: RiskClassifier;
  riskPolicy?: RiskPolicy;
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
  let generation = 0;
  let lastQuery = defaults.query ?? "tool";
  let lastServer = defaults.server;
  let lastLimit = defaults.limit ?? 200;
  const ttlMs = defaults.ttlMs ?? 60_000;
  const riskClassifier =
    defaults.riskClassifier ?? createRiskClassifier(defaults.riskPolicy);

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
    const refreshGeneration = generation;
    inflight = refreshRegistry(mcpSearch, {
      query: nextQuery,
      server: nextServer,
      limit: nextLimit,
      riskClassifier,
    })
      .then((nextRegistry) => {
        if (refreshGeneration !== generation) {
          return nextRegistry;
        }
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
      generation += 1;
      registry = null;
      lastUpdated = 0;
      inflight = null;
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
