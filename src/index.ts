import type { Env } from "./types";

type GenerateRequest = {
  prompt?: unknown;
  originalPrompt?: unknown;
  negativePrompt?: unknown;
  aspectRatio?: unknown;
  imageCount?: unknown;
  guidance?: unknown;
  steps?: unknown;
  seed?: unknown;
};

type LooseAI = {
  run(model: string, inputs: unknown): Promise<unknown>;
};

type ImageResult = {
  image?: string;
};

const MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
const MAX_IMAGES = 5;
const MAX_PROMPT_LENGTH = 2048;

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function buildPrompt(body: GenerateRequest): string {
  const originalPrompt =
    asText(body.originalPrompt) || asText(body.prompt);

  const compiledPrompt = asText(body.prompt);
  const aspectRatio =
    asText(body.aspectRatio).toLowerCase() === "square"
      ? "square"
      : "portrait";

  const aspectLock =
    aspectRatio === "square"
      ? "Compose the image as a true square 1:1 photograph with complete, intentional framing."
      : "Compose the image as a true vertical portrait photograph in a 2:3 frame with complete, intentional framing.";

  const realismLock = [
    "Create a genuine real-world camera photograph.",
    "Every person, visible age, body type, body size, height, weight distribution, facial structure, physical development stage, anatomy, pose, action, object, location, and relationship explicitly typed by the user is mandatory and must remain internally consistent.",
    "Use only clothing and accessories explicitly typed by the user; do not invent, replace, layer, redesign, or automatically add wardrobe details.",
    "Use realistic human proportions, joint placement, hands, fingers, eyes, skin texture, pores, fine hair, gravity, contact, perspective, scale, depth, and physically believable lighting.",
    "Render natural high-end medium-format photographic detail, accurate color, authentic optical depth, realistic dynamic range, and believable lens behavior.",
    "No CGI, no 3D render, no digital art, no illustration, no cartoon, no anime, no plastic skin, no waxy skin, no beauty-filter finish, no text, no logo, and no watermark.",
  ].join(" ");

  const source = compiledPrompt || originalPrompt;

  // Put the user's exact wording first so it receives the strongest priority.
  return [
    `USER'S EXACT REQUIRED SCENE: ${originalPrompt}.`,
    aspectLock,
    realismLock,
    source !== originalPrompt ? `Additional compiled requirements: ${source}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_PROMPT_LENGTH);
}

async function generateOne(
  env: Env,
  prompt: string,
  width: number,
  height: number,
  steps: number,
): Promise<{ dataURI: string }> {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(width));
  form.append("height", String(height));
  form.append("steps", String(steps));

  const serialized = new Response(form);
  const contentType = serialized.headers.get("content-type");

  if (!serialized.body || !contentType) {
    throw new Error("Could not serialize the image request.");
  }

  // Loose typing keeps the project compatible even when the local generated
  // Cloudflare model types lag behind the currently available model catalog.
  const ai = env.AI as unknown as LooseAI;

  const result = (await ai.run(MODEL, {
    multipart: {
      body: serialized.body,
      contentType,
    },
  })) as ImageResult;

  if (!result || typeof result.image !== "string" || result.image.length === 0) {
    throw new Error("The image model returned no displayable image.");
  }

  return {
    dataURI: `data:image/jpeg;base64,${result.image}`,
  };
}

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  let body: GenerateRequest;

  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return jsonResponse({ error: "The request body must be valid JSON." }, 400);
  }

  const originalPrompt =
    asText(body.originalPrompt) || asText(body.prompt);

  if (!originalPrompt) {
    return jsonResponse({ error: "A prompt is required." }, 400);
  }

  const imageCount = clampInteger(body.imageCount, 1, MAX_IMAGES, 3);

  // FLUX.2 Klein accepts explicit dimensions. Portrait uses a true 2:3 frame.
  const isSquare = asText(body.aspectRatio).toLowerCase() === "square";
  const width = 1024;
  const height = isSquare ? 1024 : 1536;

  // Cloudflare's documented example uses 25 steps. Keep the UI value useful,
  // but enforce a quality-focused minimum and a conservative upper bound.
  const requestedSteps = clampInteger(body.steps, 1, 50, 25);
  const steps = Math.min(40, Math.max(25, requestedSteps));

  const prompt = buildPrompt(body);

  try {
    const images = await Promise.all(
      Array.from({ length: imageCount }, () =>
        generateOne(env, prompt, width, height, steps),
      ),
    );

    return jsonResponse({
      images,
      model: MODEL,
      width,
      height,
      steps,
    });
  } catch (error) {
    console.error("Digital Anarchist generation error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Image generation failed.";

    return jsonResponse({ error: message }, 500);
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/generate") {
      return handleGenerate(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return jsonResponse({
        ok: true,
        service: "Digital Anarchist",
        model: MODEL,
      });
    }

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": url.origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const assets = (env as Env & { ASSETS?: Fetcher }).ASSETS;

    if (assets) {
      return assets.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
