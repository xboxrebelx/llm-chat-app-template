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

function extractTypedAge(text: string): number | null {
  const patterns = [
    /\b(?:age(?:d)?|exactly|about|around|approximately|almost|nearly|just turned|looks(?:\s+(?:exactly|about|around|approximately))?|appears(?:\s+to\s+be)?|most likely)\s*(\d{1,3})\b/i,
    /\b(\d{1,3})\s*(?:years?\s*old|yo)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const age = Number.parseInt(match[1], 10);
    if (age >= 1 && age <= 100) return age;
  }

  return null;
}

function buildAgeAppearanceLock(age: number): string {
  const low = Math.max(1, age - 2);
  const high = Math.min(100, age + 2);

  let appearance = "";

  if (age <= 5) {
    appearance =
      "young-child facial structure and child-sized body proportions, soft child features, and no adolescent or adult aging markers";
  } else if (age <= 9) {
    appearance =
      "school-age child facial structure and body proportions, age-appropriate skin and hair, and no adolescent or adult aging markers";
  } else if (age <= 12) {
    appearance =
      "preteen facial structure and body proportions, age-appropriate physical development, and no adult facial aging or adult facial hair";
  } else if (age <= 17) {
    appearance =
      "adolescent facial structure and body proportions, age-appropriate physical development, smooth youthful skin, and no mature-adult aging markers";
  } else if (age <= 24) {
    appearance =
      "young-adult facial structure, firm facial contours, smooth natural skin with realistic pores, and no mature age-related facial lines";
  } else if (age <= 34) {
    appearance =
      "late-twenties to early-thirties adult facial structure, firm cheeks and jawline, natural skin texture, and only minimal fine expression lines";
  } else if (age <= 39) {
    appearance =
      "unmistakable mid-thirties adult facial structure, firm cheeks and jawline, natural skin texture, subtle expression lines only, no pronounced forehead creases, no pronounced crow's feet, no jowling, and no age-related neck laxity";
  } else if (age <= 49) {
    appearance =
      "adult facial structure consistent with the forties, natural mature skin texture, moderate realistic expression lines, and age-consistent hair and body proportions";
  } else if (age <= 59) {
    appearance =
      "adult facial structure consistent with the fifties, natural mature skin texture, realistic facial lines, and age-consistent hair, hands, neck, and body proportions";
  } else if (age <= 69) {
    appearance =
      "adult facial structure consistent with the sixties, naturally aged skin and hair, realistic facial lines, and age-consistent hands, neck, posture, and body proportions";
  } else {
    appearance =
      "older-adult facial structure, naturally aged skin and hair, realistic age-related facial lines, and age-consistent hands, neck, posture, and body proportions";
  }

  return [
    `AGE IS THE HIGHEST-PRIORITY IDENTITY ATTRIBUTE: the subject is exactly ${age} and must visibly appear within ${low}-${high}.`,
    `Use ${appearance}.`,
    "Keep the apparent age of the face, neck, hands, hair, skin, posture, and body fully consistent with one another.",
    `Do not make the subject look noticeably older or younger than ${age}.`,
  ].join(" ");
}

function buildPrompt(body: GenerateRequest): string {
  const originalPrompt =
    asText(body.originalPrompt) || asText(body.prompt);

  const age = extractTypedAge(originalPrompt);
  const isSquare =
    asText(body.aspectRatio).toLowerCase() === "square";

  const aspectLock = isSquare
    ? "FRAME: true square 1:1 camera photograph with complete intentional composition."
    : "FRAME: true vertical 2:3 camera photograph with complete intentional composition.";

  const fullBodyLock =
    /\b(?:full[-\s]?body|head[-\s]?to[-\s]?toe|entire body|both feet visible)\b/i.test(
      originalPrompt,
    )
      ? "FULL-BODY LOCK: position the camera far enough back to show the complete subject from the top of the head through both feet. Keep the head, hands, legs, ankles, and both feet fully inside the frame with visible floor space below the feet."
      : "";

  const ageLock = age === null ? "" : buildAgeAppearanceLock(age);

  const fixedRequirements = [
    ageLock,
    aspectLock,
    fullBodyLock,
    "ADHERENCE: every explicitly typed person, object, action, pose, location, lighting condition, camera angle, body type, body size, and relationship is mandatory.",
    "WARDROBE: use exactly the clothing and accessories explicitly typed by the user. Do not invent, replace, layer, redesign, or automatically add wardrobe items.",
    "ANATOMY: realistic human proportions, joints, hands, fingers, eyes, facial geometry, body-mass distribution, gravity, contact, scale, and perspective.",
    "PHOTO QUALITY: authentic high-end camera photograph with natural unretouched skin, visible pores and fine texture, individual hair strands, realistic eyes, physically believable light, accurate color, optical depth, and natural dynamic range.",
    "STYLE EXCLUSIONS: no CGI appearance, no 3D-render appearance, no illustration, no cartoon, no anime, no plastic or waxy skin, no beauty-filter finish, no text, no logo, and no watermark.",
    age === null
      ? ""
      : `FINAL AGE CHECK BEFORE RENDERING: the subject must read immediately as exactly ${age}, within the visible range ${Math.max(1, age - 2)}-${Math.min(100, age + 2)}.`,
  ]
    .filter(Boolean)
    .join(" ");

  const scenePrefix = "USER'S EXACT REQUIRED SCENE: ";
  const reservedLength = scenePrefix.length + fixedRequirements.length + 3;
  const availableSceneLength = Math.max(
    300,
    MAX_PROMPT_LENGTH - reservedLength,
  );
  const scene = originalPrompt.slice(0, availableSceneLength);

  return `${scenePrefix}${scene}. ${fixedRequirements}`.slice(
    0,
    MAX_PROMPT_LENGTH,
  );
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
  const isSquare = asText(body.aspectRatio).toLowerCase() === "square";
  const width = 1024;
  const height = isSquare ? 1024 : 1536;

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
