import { describe, expect, it } from "vitest";

import { resolveAiRuntimeConfigFromSources } from "@/lib/server/app-settings";

describe("ai runtime config", () => {
  it("prefers stored settings over environment values", () => {
    const config = resolveAiRuntimeConfigFromSources(
      {
        aiApiKey: "stored-key",
        aiBaseUrl: "https://stored.example/v1",
        aiModel: "stored-model",
        aiVisionModel: "stored-vision",
        aiSupportsVision: false,
      },
      {
        AI_API_KEY: "env-key",
        AI_BASE_URL: "https://env.example/v1",
        AI_MODEL: "env-model",
        AI_SUPPORTS_VISION: "true",
      } as unknown as NodeJS.ProcessEnv,
    );

    expect(config).toEqual({
      apiKey: "stored-key",
      baseURL: "https://stored.example/v1",
      model: "stored-model",
      visionModel: "stored-vision",
      supportsVision: false,
    });
  });

  it("falls back to environment values when settings are empty", () => {
    const config = resolveAiRuntimeConfigFromSources(
      {
        aiApiKey: null,
        aiBaseUrl: null,
        aiModel: null,
        aiVisionModel: null,
        aiSupportsVision: null,
      },
      {
        OPENAI_API_KEY: "env-key",
        OPENAI_BASE_URL: "https://env.example/v1",
        OPENAI_MODEL: "env-model",
        AI_SUPPORTS_VISION: "false",
      } as unknown as NodeJS.ProcessEnv,
    );

    expect(config).toEqual({
      apiKey: "env-key",
      baseURL: "https://env.example/v1",
      model: "env-model",
      visionModel: "env-model",
      supportsVision: false,
    });
  });
});
