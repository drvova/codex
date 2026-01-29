import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { RiskLevel, RiskPolicy } from "../mcp/registry";

export type UserMcpPolicy = {
  riskPolicy?: RiskPolicy;
  readOnlyTools?: Array<string | RegExp>;
  writeTools?: Array<string | RegExp>;
  riskOverrides?: Record<string, RiskLevel>;
};

export type UserMetadata = {
  id: string;
  mcp?: UserMcpPolicy;
  [key: string]: unknown;
};

const DEFAULT_METADATA_PATH = path.join(os.homedir(), ".codex", "user-metadata.json");

const readMetadataSource = async (): Promise<string | null> => {
  const envValue = process.env.CODEX_USER_METADATA;
  if (envValue && envValue.trim().length > 0) {
    return envValue;
  }

  const filePath = process.env.CODEX_USER_METADATA_PATH ?? DEFAULT_METADATA_PATH;
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const normalizeUserMetadata = (userId: string, value: unknown): UserMetadata | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    const entry = value.find(
      (item) => item && typeof item === "object" && (item as UserMetadata).id === userId,
    );
    if (!entry) {
      return null;
    }
    return {
      id: userId,
      ...(entry as UserMetadata),
    };
  }

  const record = value as Record<string, unknown>;
  if (record.users && typeof record.users === "object") {
    const users = record.users as Record<string, unknown>;
    const entry = users[userId];
    if (!entry || typeof entry !== "object") {
      return null;
    }
    return {
      id: userId,
      ...(entry as UserMetadata),
    };
  }

  const entry = record[userId];
  if (entry && typeof entry === "object") {
    return {
      id: userId,
      ...(entry as UserMetadata),
    };
  }

  if (record.id === userId) {
    return record as UserMetadata;
  }

  return null;
};

export const fetchUserMetadata = async (userId: string): Promise<UserMetadata | null> => {
  const raw = await readMetadataSource();
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw) as unknown;
  return normalizeUserMetadata(userId, parsed);
};
