/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleAtlasState } from "./atlas-state";
import { handleStructure } from "./ai-structure";
import { handleAtlasActions } from "./atlas-actions";
import { handleCanonicalRecords } from "./canonical-records";
import { handleConversationCases } from "./conversation-cases";
import { handleSlice3 } from "./slice3-api";
import { handleSlice4 } from "./slice4-api";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  OPENAI_API_KEY?: string;
  CAMPUS_ATLAS_ACTION_KEY?: string;
  CAMPUS_ATLAS_PUBLIC_DEMO?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/state") {
      return handleAtlasState(request, env.DB, env.CAMPUS_ATLAS_PUBLIC_DEMO === "true");
    }

    if (url.pathname === "/api/structure") {
      return handleStructure(request, env.OPENAI_API_KEY);
    }

    if (/^\/api\/v1\/projects\/[^/]+\/(?:conversations|cases|events|case-boundaries)(?:\/|$)/.test(url.pathname)) {
      return handleConversationCases(request, env.DB, env.CAMPUS_ATLAS_ACTION_KEY);
    }

    if (/^\/api\/v1\/projects\/[^/]+\/(?:checkpoints|findings|governance-events|mechanisms\/eligible)(?:\/|$)/.test(url.pathname)) {
      return handleSlice3(request, env.DB, env.CAMPUS_ATLAS_ACTION_KEY);
    }

    if (/^\/api\/v1\/projects\/[^/]+\/(?:roadways|reconstruction|packets|live-state)(?:\/|$)/.test(url.pathname)) {
      return handleSlice4(request, env.DB, env.CAMPUS_ATLAS_ACTION_KEY);
    }

    if (url.pathname.startsWith("/api/v1/projects/") && url.pathname.includes("/records/")) {
      return handleCanonicalRecords(request, env.DB, env.CAMPUS_ATLAS_ACTION_KEY);
    }

    if (["/mcp", "/openapi.json", "/.well-known/openapi.json", "/privacy", "/api/context", "/api/blueprint", "/api/precedents", "/api/candidates", "/api/outcomes", "/api/events", "/api/receipts", "/api/security"].includes(url.pathname)) {
      return handleAtlasActions(request, { DB: env.DB, CAMPUS_ATLAS_ACTION_KEY: env.CAMPUS_ATLAS_ACTION_KEY, CAMPUS_ATLAS_PUBLIC_DEMO: env.CAMPUS_ATLAS_PUBLIC_DEMO });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
