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
  openai: {
    name: "OpenAI",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com",
    path: "/v1/chat/completions",
    apiKeyEnv: "OPENAI_API_KEY",
    models: ["gpt-4o", "gpt-4.1", "gpt-3.5-turbo"],
    capabilities: { vision: true, video: false },
  },
};

export function resolveProvider(key: string): ProviderConfig | null {
  const provider = providers[key];
  if (!provider) return null;
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) return null;
  return { ...provider, headers: { Authorization: `Bearer ${apiKey}` } };
}
