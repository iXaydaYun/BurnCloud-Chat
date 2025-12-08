export type ProviderConfig = {
  name: string;
  baseUrl: string;
  path: string;
  apiKeyEnv: string;
  models: string[];
  capabilities?: {
    vision?: boolean;
    video?: boolean;
  };
  headers?: Record<string, string>;
};

export const providers: Record<string, ProviderConfig> = {
  burncloud: {
    name: "BurnCloud",
    baseUrl: process.env.BURNCLOUD_BASE_URL ?? "https://ai.burncloud.com",
    path: "/v1/chat/completions",
    apiKeyEnv: "BURNCLOUD_API_KEY",
    models: [
      "gpt-4.1",
      "gpt-4o",
      "claude-3-7-sonnet-20250219",
      "claude-3-5-sonnet-20241022",
      "deepseek-r1",
      "deepseek-v3",
    ],
    capabilities: { vision: true, video: false },
  },
};

export function resolveProvider(
  key: string,
  allowMissingApiKey = false,
): ProviderConfig | null {
  const provider = providers[key];
  if (!provider) return null;
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey && !allowMissingApiKey) return null;
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  return { ...provider, headers };
}
