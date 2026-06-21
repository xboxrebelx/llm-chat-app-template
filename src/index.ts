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

type HordeEnv = Env & {
  AI_HORDE_API_KEY?: string;
  ASSETS?: Fetcher;
};

type HordeSubmitResponse = {
  id?: string;
  kudos?: number;
  message?: string;
};

type HordeCheckResponse = {
  done?: boolean;
  faulted?: boolean;
  cancelled?: boolean;
  is_possible?: boolean;
  wait_time?: number;
  queue_position?: number;
  processing?: number;
  waiting?: number;
  finished?: number;
  message?: string;
};

type HordeGeneration = {
  img?: string;
  model?: string;
  seed?: string | number;
  censored?: boolean;
  state?: string;
  gen_metadata?: Array<{
    type?: string;
    value?: string;
    ref?: string;
  }>;
};

type HordeStatusResponse = {
  done?: boolean;
  faulted?: boolean;
  cancelled?: boolean;
  generations?: HordeGeneration[];
  kudos?: number;
  message?: string;
};

type HordeModel = {
  name?: string;
  count?: number;
  performance?: number;
  queued?: number;
  jobs?: number;
  eta?: number;
};

const HORDE_API = "https://aihorde.net/api/v2";
const CLIENT_AGENT =
  "DigitalAnarchist:1.0:https://github.com/xboxrebelx/llm-chat-app-template";

const MAX_IMAGES = 5;
const MAX_PROMPT_LENGTH = 4096;
const MAX_WAIT_MS = 4 * 60 * 1000;
const DEFAULT_MODEL = "AlbedoBase XL (SDXL)";

const PREFERRED_MODEL_PATTERNS: Array<{
  pattern: RegExp;
  score: number;
}> = [
  { pattern: /juggernaut.*xl/i, score: 1000 },
  { pattern: /realvis.*xl/i, score: 950 },
  { pattern: /albedo.*xl/i, score: 900 },
  { pattern: /dreamshaper.*xl/i, score: 850 },
  { pattern: /photon.*xl/i, score: 800 },
  { pattern: /zavy.*xl/i, score: 760 },
  { pattern: /sdxl/i, score: 600 },
];

const FALLBACK_NEGATIVE = [
  "cgi",
  "3d render",
  "computer generated",
  "digital art",
  "illustration",
  "painting",
  "cartoon",
  "anime",
  "video game graphics",
  "plastic skin",
  "waxy skin",
  "airbrushed skin",
  "beauty filter",
  "overprocessed",
  "uncanny face",
  "wrong age appearance",
  "age body mismatch",
  "face body mismatch",
  "incorrect proportions",
  "deformed anatomy",
  "malformed hands",
  "extra fingers",
  "missing fingers",
  "extra limbs",
  "duplicate body parts",
  "distorted eyes",
  "asymmetrical eyes",
  "blurred face",
  "low resolution",
  "soft focus",
  "motion blur",
  "text",
  "caption",
  "logo",
  "watermark",
].join(", ");

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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function buildPositivePrompt(body: GenerateRequest): string {
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

function buildNegativePrompt(body: GenerateRequest): string {
  const supplied = asText(body.negativePrompt);
  return supplied || FALLBACK_NEGATIVE;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    let detail = text;

    try {
      const parsed = JSON.parse(text) as {
        message?: string;
        error?: string;
        errors?: unknown;
      };

      detail =
        parsed.message ||
        parsed.error ||
        (parsed.errors ? JSON.stringify(parsed.errors) : text);
    } catch {
      // Keep the original response text.
    }

    throw new Error(
      detail || `AI Horde request failed with status ${response.status}.`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("AI Horde returned an invalid JSON response.");
  }
}

function hordeHeaders(apiKey: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    apikey: apiKey,
    "Client-Agent": CLIENT_AGENT,
  };
}

function scoreModel(model: HordeModel): number {
  const name = asText(model.name);
  const workerCount = Math.max(0, Number(model.count) || 0);
  const performance = Math.max(0, Number(model.performance) || 0);

  let preference = 0;

  for (const preferred of PREFERRED_MODEL_PATTERNS) {
    if (preferred.pattern.test(name)) {
      preference = Math.max(preference, preferred.score);
    }
  }

  return preference + Math.min(workerCount, 100) * 8 + Math.min(performance, 500);
}

async function selectModel(apiKey: string): Promise<string> {
  try {
    const response = await fetch(
      `${HORDE_API}/status/models?type=image`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          apikey: apiKey,
          "Client-Agent": CLIENT_AGENT,
        },
      },
    );

    const models = await readJson<HordeModel[]>(response);

    const candidates = models
      .filter((model) => asText(model.name) && (Number(model.count) || 0) > 0)
      .map((model) => ({
        name: asText(model.name),
        score: scoreModel(model),
      }))
      .filter((model) => model.score >= 600)
      .sort((left, right) => right.score - left.score);

    if (candidates.length > 0) {
      return candidates[0].name;
    }
  } catch (error) {
    console.warn("Could not load AI Horde model list:", error);
  }

  return DEFAULT_MODEL;
}

async function submitGeneration(
  apiKey: string,
  body: GenerateRequest,
): Promise<{
  requestId: string;
  model: string;
  width: number;
  height: number;
  steps: number;
}> {
  const imageCount = clampInteger(body.imageCount, 1, MAX_IMAGES, 1);
  const guidance = clampInteger(body.guidance, 1, 30, 8);
  const requestedSteps = clampInteger(body.steps, 1, 50, 30);
  const steps = Math.min(40, Math.max(25, requestedSteps));
  const seedText = asText(body.seed);
  const seed =
    seedText === ""
      ? null
      : clampInteger(body.seed, 0, 2147483647, 0);

  const isSquare =
    asText(body.aspectRatio).toLowerCase() === "square";

  // 768x1152 is a true 2:3 portrait and matches many more volunteer GPUs
  // than 1024x1536. Square remains 1024x1024.
  const width = isSquare ? 1024 : 768;
  const height = isSquare ? 1024 : 1152;

  const positivePrompt = buildPositivePrompt(body);
  const negativePrompt = buildNegativePrompt(body);
  const model = await selectModel(apiKey);

  const params: Record<string, unknown> = {
    sampler_name: "k_dpmpp_2m",
    cfg_scale: guidance,
    steps,
    width,
    height,
    n: imageCount,
    karras: true,
    hires_fix: false,
    clip_skip: 1,
  };

  if (seed !== null) {
    params.seed = String(seed);
  }

  const payload = {
    prompt: `${positivePrompt} ### ${negativePrompt}`,
    params,
    models: [model],
    nsfw: false,
    censor_nsfw: false,
    trusted_workers: false,
    slow_workers: true,
    r2: true,
    shared: false,
    replacement_filter: true,
    allow_downgrade: true,
  };

  const response = await fetch(`${HORDE_API}/generate/async`, {
    method: "POST",
    headers: hordeHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  const submitted = await readJson<HordeSubmitResponse>(response);

  if (!submitted.id) {
    throw new Error(
      submitted.message || "AI Horde did not return a generation request ID.",
    );
  }

  return {
    requestId: submitted.id,
    model,
    width,
    height,
    steps,
  };
}

function pollDelayMilliseconds(check: HordeCheckResponse): number {
  const waitSeconds = Number(check.wait_time);

  if (Number.isFinite(waitSeconds) && waitSeconds > 0) {
    return Math.min(8000, Math.max(2000, waitSeconds * 1000));
  }

  return 2500;
}

async function waitForGeneration(
  apiKey: string,
  requestId: string,
): Promise<HordeStatusResponse> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const checkResponse = await fetch(
      `${HORDE_API}/generate/check/${encodeURIComponent(requestId)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          apikey: apiKey,
          "Client-Agent": CLIENT_AGENT,
        },
      },
    );

    const check = await readJson<HordeCheckResponse>(checkResponse);

    if (check.faulted) {
      throw new Error(check.message || "AI Horde marked the request as faulted.");
    }

    if (check.cancelled) {
      throw new Error("AI Horde cancelled the generation request.");
    }

    if (check.is_possible === false) {
      throw new Error(
        "No active AI Horde worker can currently run this request. Try again later.",
      );
    }

    if (check.done) {
      const statusResponse = await fetch(
        `${HORDE_API}/generate/status/${encodeURIComponent(requestId)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            apikey: apiKey,
            "Client-Agent": CLIENT_AGENT,
          },
        },
      );

      return readJson<HordeStatusResponse>(statusResponse);
    }

    await sleep(pollDelayMilliseconds(check));
  }

  throw new Error(
    "AI Horde is still queued after four minutes. Try again when more volunteer workers are available.",
  );
}

function normalizeGenerationImage(
  generation: HordeGeneration,
): { url?: string; dataURI?: string; model?: string; seed?: string | number } | null {
  const image = asText(generation.img);

  if (!image) return null;

  const metadata = {
    model: asText(generation.model) || undefined,
    seed: generation.seed,
  };

  if (
    image.startsWith("https://") ||
    image.startsWith("http://") ||
    image.startsWith("data:image/")
  ) {
    return image.startsWith("data:image/")
      ? { dataURI: image, ...metadata }
      : { url: image, ...metadata };
  }

  return {
    dataURI: `data:image/webp;base64,${image}`,
    ...metadata,
  };
}

async function handleGenerate(
  request: Request,
  env: HordeEnv,
): Promise<Response> {
  const apiKey = asText(env.AI_HORDE_API_KEY);

  if (!apiKey) {
    return jsonResponse(
      {
        error:
          "AI_HORDE_API_KEY is missing from Cloudflare Variables and Secrets.",
      },
      500,
    );
  }

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

  try {
    const submitted = await submitGeneration(apiKey, body);
    const completed = await waitForGeneration(
      apiKey,
      submitted.requestId,
    );

    if (completed.faulted) {
      throw new Error(
        completed.message || "AI Horde marked the completed request as faulted.",
      );
    }

    if (completed.cancelled) {
      throw new Error("AI Horde cancelled the generation request.");
    }

    const images = (completed.generations || [])
      .map(normalizeGenerationImage)
      .filter(
        (
          image,
        ): image is NonNullable<ReturnType<typeof normalizeGenerationImage>> =>
          image !== null,
      );

    if (images.length === 0) {
      throw new Error("AI Horde returned no displayable images.");
    }

    return jsonResponse({
      images,
      provider: "AI Horde",
      requestId: submitted.requestId,
      selectedModel: submitted.model,
      width: submitted.width,
      height: submitted.height,
      steps: submitted.steps,
      kudos: completed.kudos,
    });
  } catch (error) {
    console.error("Digital Anarchist AI Horde error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "AI Horde image generation failed.";

    return jsonResponse({ error: message }, 500);
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const hordeEnv = env as HordeEnv;
    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      url.pathname === "/api/generate"
    ) {
      return handleGenerate(request, hordeEnv);
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/health"
    ) {
      return jsonResponse({
        ok: true,
        service: "Digital Anarchist",
        provider: "AI Horde",
        apiKeyConfigured: Boolean(asText(hordeEnv.AI_HORDE_API_KEY)),
      });
    }

    if (
      request.method === "OPTIONS" &&
      url.pathname.startsWith("/api/")
    ) {
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

    if (hordeEnv.ASSETS) {
      return hordeEnv.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
