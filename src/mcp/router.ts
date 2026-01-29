import {
  createRegistryManager,
  createRiskClassifier,
  decideInvocation,
  type Decision,
  type McpSearch,
  type RiskLevel,
  type RiskPolicy,
  type ToolDefinition,
  type ToolRegistry,
} from "./registry";

export type UserMcpPolicy = {
  riskPolicy?: RiskPolicy;
  readOnlyTools?: Array<string | RegExp>;
  writeTools?: Array<string | RegExp>;
  riskOverrides?: Record<string, RiskLevel>;
};

export type UserMetadata = {
  id: string;
  mcp?: UserMcpPolicy;
};

export type UserMetadataProvider = (userId: string) => Promise<UserMetadata | null>;

export type McpConfigWatcher = {
  onChange: (listener: () => void) => () => void;
};

export type ToolRouterOptions = {
  query?: string;
  server?: string;
  limit?: number;
  ttlMs?: number;
  baseRiskPolicy?: RiskPolicy;
  userMetadataProvider?: UserMetadataProvider;
  configWatcher?: McpConfigWatcher;
};

export type ToolRoutingDecision = Decision;

export type ToolRouter = {
  getRegistryForUser: (
    userId: string,
    options?: { query?: string; server?: string; limit?: number; force?: boolean },
  ) => Promise<ToolRegistry>;
  resolveTool: (options: {
    userId: string;
    qualifiedName: string;
    query?: string;
    server?: string;
    limit?: number;
    force?: boolean;
  }) => Promise<ToolDefinition | null>;
  decideForUser: (options: {
    userId: string;
    qualifiedName: string;
    args: Record<string, unknown>;
    query?: string;
    server?: string;
    limit?: number;
    force?: boolean;
  }) => Promise<ToolRoutingDecision | null>;
  invalidateAll: () => void;
  close: () => void;
};

type UserRegistryState = {
  manager: ReturnType<typeof createRegistryManager>;
  policyKey: string;
};

const mergeUnique = (base: string[] = [], extra: string[] = []): string[] => {
  if (extra.length === 0) {
    return base;
  }
  const seen = new Set(base);
  const merged = [...base];
  extra.forEach((value) => {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  });
  return merged;
};

const normalizePolicyForKey = (policy: RiskPolicy): Record<string, unknown> => ({
  readVerbs: policy.readVerbs ?? [],
  writeVerbs: policy.writeVerbs ?? [],
  sensitiveFields: policy.sensitiveFields ?? [],
  writeFields: policy.writeFields ?? [],
  readOnlyHints: policy.readOnlyHints ?? [],
  writeHints: policy.writeHints ?? [],
  forceRead: (policy.forceRead ?? []).map((entry) =>
    entry instanceof RegExp ? entry.toString() : entry,
  ),
  forceWrite: (policy.forceWrite ?? []).map((entry) =>
    entry instanceof RegExp ? entry.toString() : entry,
  ),
  overrides: policy.overrides ?? {},
});

const buildPolicyKey = (policy: RiskPolicy): string =>
  JSON.stringify(normalizePolicyForKey(policy));

const mergeRiskPolicy = (base: RiskPolicy, user: UserMcpPolicy | undefined): RiskPolicy => {
  if (!user) {
    return base;
  }
  const derived: RiskPolicy = {
    readVerbs: mergeUnique(base.readVerbs ?? [], user.riskPolicy?.readVerbs ?? []),
    writeVerbs: mergeUnique(base.writeVerbs ?? [], user.riskPolicy?.writeVerbs ?? []),
    sensitiveFields: mergeUnique(
      base.sensitiveFields ?? [],
      user.riskPolicy?.sensitiveFields ?? [],
    ),
    writeFields: mergeUnique(base.writeFields ?? [], user.riskPolicy?.writeFields ?? []),
    readOnlyHints: mergeUnique(
      base.readOnlyHints ?? [],
      user.riskPolicy?.readOnlyHints ?? [],
    ),
    writeHints: mergeUnique(
      base.writeHints ?? [],
      user.riskPolicy?.writeHints ?? [],
    ),
    forceRead: [
      ...(base.forceRead ?? []),
      ...(user.riskPolicy?.forceRead ?? []),
      ...(user.readOnlyTools ?? []),
    ],
    forceWrite: [
      ...(base.forceWrite ?? []),
      ...(user.riskPolicy?.forceWrite ?? []),
      ...(user.writeTools ?? []),
    ],
    overrides: {
      ...(base.overrides ?? {}),
      ...(user.riskPolicy?.overrides ?? {}),
      ...(user.riskOverrides ?? {}),
    },
  };
  return derived;
};

export const createToolRouter = (mcpSearch: McpSearch, options: ToolRouterOptions = {}): ToolRouter => {
  const registryDefaults = {
    query: options.query ?? "tool",
    server: options.server,
    limit: options.limit ?? 200,
    ttlMs: options.ttlMs ?? 60_000,
  };
  const basePolicy = options.baseRiskPolicy ?? {};
  const userMetadataProvider = options.userMetadataProvider;
  const userRegistries = new Map<string, UserRegistryState>();
  let unsubscribe: (() => void) | null = null;

  if (options.configWatcher) {
    unsubscribe = options.configWatcher.onChange(() => {
      userRegistries.forEach(({ manager }) => manager.invalidate());
    });
  }

  const getPolicyForUser = async (userId: string): Promise<RiskPolicy> => {
    if (!userMetadataProvider) {
      return basePolicy;
    }
    const metadata = await userMetadataProvider(userId);
    return mergeRiskPolicy(basePolicy, metadata?.mcp);
  };

  const getRegistryManager = async (userId: string) => {
    const policy = await getPolicyForUser(userId);
    const policyKey = buildPolicyKey(policy);
    const existing = userRegistries.get(userId);
    if (existing && existing.policyKey === policyKey) {
      return existing.manager;
    }
    const riskClassifier = createRiskClassifier(policy);
    const manager = createRegistryManager(mcpSearch, {
      query: registryDefaults.query,
      server: registryDefaults.server,
      limit: registryDefaults.limit,
      ttlMs: registryDefaults.ttlMs,
      riskClassifier,
    });
    userRegistries.set(userId, { manager, policyKey });
    return manager;
  };

  return {
    getRegistryForUser: async (userId, optionsArg = {}) => {
      const manager = await getRegistryManager(userId);
      return manager.getRegistry({
        query: optionsArg.query ?? registryDefaults.query,
        server: optionsArg.server ?? registryDefaults.server,
        limit: optionsArg.limit ?? registryDefaults.limit,
        force: optionsArg.force,
      });
    },
    resolveTool: async (optionsArg) => {
      const registry = await (async () => {
        const manager = await getRegistryManager(optionsArg.userId);
        return manager.getRegistry({
          query: optionsArg.query ?? registryDefaults.query,
          server: optionsArg.server ?? registryDefaults.server,
          limit: optionsArg.limit ?? registryDefaults.limit,
          force: optionsArg.force,
        });
      })();
      return registry.toolsByQualifiedName.get(optionsArg.qualifiedName) ?? null;
    },
    decideForUser: async (optionsArg) => {
      const tool = await (async () => {
        const registry = await (async () => {
          const manager = await getRegistryManager(optionsArg.userId);
          return manager.getRegistry({
            query: optionsArg.query ?? registryDefaults.query,
            server: optionsArg.server ?? registryDefaults.server,
            limit: optionsArg.limit ?? registryDefaults.limit,
            force: optionsArg.force,
          });
        })();
        return registry.toolsByQualifiedName.get(optionsArg.qualifiedName) ?? null;
      })();

      if (!tool) {
        return null;
      }
      return decideInvocation({ tool, args: optionsArg.args });
    },
    invalidateAll: () => {
      userRegistries.forEach(({ manager }) => manager.invalidate());
    },
    close: () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      userRegistries.clear();
    },
  };
};
