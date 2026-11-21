import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import type { LiveServerMessage } from "@google/genai";

type LanguageMode = "auto" | "en" | "hi" | "or";
type VoiceName = "Kore" | "Zephyr" | "Puck" | "Charon" | "Fenrir";

const ALLOWED_VOICES = new Set<VoiceName>(["Kore", "Zephyr", "Puck", "Charon", "Fenrir"]);

function getAiClient(apiVersion?: "v1beta"): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function normalizeLanguage(lang: unknown): LanguageMode {
  if (lang === "en" || lang === "hi" || lang === "or" || lang === "auto") {
    return lang;
  }
  return "auto";
}

function normalizeVoice(voice: unknown): VoiceName {
  if (typeof voice === "string" && ALLOWED_VOICES.has(voice as VoiceName)) {
    return voice as VoiceName;
  }
  return "Kore";
}

function buildSwatiInstruction(
  language: LanguageMode,
  isVoice: boolean,
  isWatchingScreen = false
): string {
  const langRule =
    language === "or"
      ? "Always respond in natural, conversational Odia using Odia script (ଓଡ଼ିଆ), unless the user explicitly asks for another language."
      : language === "hi"
        ? "Always respond in natural, conversational Hindi using Devanagari script (unless the user explicitly asks for another language)."
        : language === "en"
          ? "Always respond in clear, natural English (unless the user explicitly asks for another language)."
          : "Automatically match the user's language: if they speak or write in Odia (ଓଡ଼ିଆ), reply in natural conversational Odia; if they speak or write in Hindi or Hinglish, reply in natural conversational Hindi (using Devanagari script); if they speak or write in English, reply in clear, natural English.";

  const formatRule = isVoice
    ? "This is a real-time spoken voice conversation on an Android phone. Keep replies warm, natural, direct, and concise (usually 1 to 3 short sentences unless asked for detail). Avoid markdown symbols, bullet lists, or reading punctuation aloud."
    : "This is a mobile assistant conversation. Keep replies helpful, well-structured, and easy to read on a phone screen without unnecessary filler.";

  const screenRule = isWatchingScreen
    ? "Live Screen Understanding is active with the user's explicit permission. You are receiving real-time snapshots of their shared screen. When describing what the user is doing or answering questions about the visible screen, focus on the actual visible content, active app/page, text, buttons, or errors shown—never invent things not visible on the screen."
    : "";

  return [
    "You are SWATI AI, a helpful, intelligent, and calm trilingual (Odia, Hindi, and English) AI voice assistant designed for mobile users.",
    'When greeting the user or introducing yourself, introduce yourself as: "Hello! I am SWATI AI. How can I help you?" (or in Hindi: "नमस्ते! मैं SWATI AI हूँ। मैं आपकी कैसे मदद कर सकती हूँ?", or in Odia: "ନମସ୍କାର! ମୁଁ SWATI AI। ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?").',
    langRule,
    formatRule,
    screenRule,
    "Never invent capabilities you do not have (like directly toggling device hardware), and if asked to do something on the device, explain clearly how the user can do it.",
  ]
    .filter(Boolean)
    .join(" ");
}

function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractErrorText(err: unknown): string {
  if (typeof err === "string") {
    const trimmed = err.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return extractErrorText(parsed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  if (err instanceof Error) {
    return extractErrorText(err.message);
  }

  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (obj.error !== undefined) {
      const nested = extractErrorText(obj.error);
      if (nested && nested !== "[object Object]") return nested;
    }
    if (typeof obj.message === "string" && obj.message.trim()) {
      return extractErrorText(obj.message);
    }
    if (typeof obj.reason === "string" && obj.reason.trim()) {
      return obj.reason.trim();
    }
    try {
      const serialized = JSON.stringify(obj);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Ignore JSON serialization error
    }
  }

  return "Unexpected error communicating with Gemini.";
}

function parseGeminiErrorMessage(err: unknown): { status: number; message: string } {
  const raw = extractErrorText(err);
  const upper = raw.toUpperCase();

  if (upper.includes("PERMISSION_DENIED") || upper.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) {
    return {
      status: 403,
      message: "API permission denied. Please check your GEMINI_API_KEY in Settings > Secrets.",
    };
  }
  if (upper.includes("API_KEY_INVALID") || upper.includes("INVALID_API_KEY")) {
    return {
      status: 400,
      message: "Invalid Gemini API key. Please check your key in Settings > Secrets.",
    };
  }
  if (upper.includes("RESOURCE_EXHAUSTED") || upper.includes("QUOTA") || upper.includes("429")) {
    return {
      status: 429,
      message: "Rate limit reached. Please wait a moment and try again.",
    };
  }
  if (upper.includes("UNAVAILABLE") || upper.includes("HIGH DEMAND") || upper.includes("503")) {
    return {
      status: 503,
      message: "Gemini is temporarily busy due to high demand. Please try again in a moment.",
    };
  }
  if (upper.includes("INVALID_ARGUMENT")) {
    return {
      status: 400,
      message: raw,
    };
  }

  return {
    status: 500,
    message: raw && raw !== "[object Object]" ? raw : "Unable to reach Gemini right now. Please try again.",
  };
}

function isRetryableGeminiError(err: unknown): boolean {
  const text = extractErrorText(err).toUpperCase();
  return (
    text.includes("503") ||
    text.includes("UNAVAILABLE") ||
    text.includes("HIGH DEMAND") ||
    text.includes("429") ||
    text.includes("RESOURCE_EXHAUSTED") ||
    text.includes("ECONNRESET") ||
    text.includes("ETIMEDOUT")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractReplyText(response: {
  text?: string;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}): string {
  const direct = typeof response.text === "string" ? response.text.trim() : "";
  if (direct) return direct;

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "6mb" }));

  app.get("/api/health", (_req, res) => {
    const hasKey = Boolean(getAiClient());
    res.json({ ok: true, configured: hasKey });
  });

  app.post("/api/chat", async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error: "Gemini API key is not configured. Please check Settings > Secrets.",
      });
      return;
    }

    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    const language = normalizeLanguage(req.body?.language);
    const screenFrameBase64 =
      typeof req.body?.screenFrameBase64 === "string" &&
      req.body.screenFrameBase64.length > 0 &&
      req.body.screenFrameBase64.length < 4_500_000
        ? req.body.screenFrameBase64
        : "";
    const rawHistory: unknown[] = Array.isArray(req.body?.history)
      ? req.body.history
      : [];

    const contents: Array<{
      role: "user" | "model";
      parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
    }> = rawHistory
      .filter(
        (item: unknown): item is { role: "user" | "model"; text: string } =>
          typeof item === "object" &&
          item !== null &&
          ((item as { role?: unknown }).role === "user" ||
            (item as { role?: unknown }).role === "model") &&
          typeof (item as { text?: unknown }).text === "string" &&
          (item as { text: string }).text.trim().length > 0
      )
      .slice(-16)
      .map((item: { role: "user" | "model"; text: string }) => ({
        role: item.role,
        parts: [{ text: item.text }],
      }));

    const userParts: Array<{
      text?: string;
      inlineData?: { mimeType: string; data: string };
    }> = [];
    if (screenFrameBase64) {
      userParts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: screenFrameBase64,
        },
      });
    }
    userParts.push({ text: message });

    contents.push({
      role: "user",
      parts: userParts,
    });

    const systemInstruction = buildSwatiInstruction(
      language,
      false,
      Boolean(screenFrameBase64)
    );

    const attempts: Array<{ model: string; thinkingLevel: ThinkingLevel; delayMs: number }> = [
      { model: "gemini-4-hydrogen", thinkingLevel: ThinkingLevel.LOW, delayMs: 0 },
      { model: "gemini-4-hydrogen", thinkingLevel: ThinkingLevel.LOW, delayMs: 600 },
      { model: "gemini-3.1-flash-lite", thinkingLevel: ThinkingLevel.MINIMAL, delayMs: 200 },
    ];

    let lastError: unknown = null;
    for (const attempt of attempts) {
      if (attempt.delayMs > 0) {
        await sleep(attempt.delayMs);
      }
      try {
        const response = await ai.models.generateContent({
          model: attempt.model,
          contents,
          config: {
            systemInstruction,
            thinkingConfig: {
              thinkingLevel: attempt.thinkingLevel,
            },
          },
        });

        const reply = extractReplyText(response);
        if (!reply) {
          res.status(502).json({
            error: "SWATI AI received an empty response. Please try again.",
          });
          return;
        }

        res.json({ reply, model: attempt.model });
        return;
      } catch (err) {
        lastError = err;
        console.error(`[SWATI /api/chat] ${attempt.model} failed:`, extractErrorText(err));
        if (!isRetryableGeminiError(err)) {
          break;
        }
      }
    }

    const parsed = parseGeminiErrorMessage(lastError);
    res.status(parsed.status).json({ error: parsed.message });
  });

  app.post("/api/tts", async (req, res) => {
    const ai = getAiClient("v1beta");
    if (!ai) {
      res.status(503).json({
        error: "Gemini API key is not configured. Please check Settings > Secrets.",
      });
      return;
    }

    const rawText = typeof req.body?.text === "string" ? req.body.text : "";
    const cleanText = sanitizeForSpeech(rawText);
    if (!cleanText) {
      res.status(400).json({ error: "Text is required for speech synthesis." });
      return;
    }

    const voiceName = normalizeVoice(req.body?.voice);
    const language = normalizeLanguage(req.body?.language);
    const hasOdia = /[\u0B00-\u0B7F]/.test(cleanText);
    const hasHindi = /[\u0900-\u097F]/.test(cleanText);
    const isOdiaSpeech = language === "or" || (language === "auto" && hasOdia);
    const isHindiSpeech =
      !isOdiaSpeech && (language === "hi" || (language === "auto" && hasHindi));

    const styleInstruction = isOdiaSpeech
      ? "Warm, clear, natural Indian trilingual AI assistant speaking Odia clearly"
      : isHindiSpeech
        ? "Warm, clear, natural Indian trilingual AI assistant speaking Hindi clearly"
        : "Warm, clear, natural trilingual AI assistant voice";

    const speechLang = isOdiaSpeech
      ? "or-IN"
      : isHindiSpeech
        ? "hi-IN"
        : "en-US";

    try {
      const interaction = await ai.interactions.create({
        model: "gemini-3.8-flash-lite-tts",
        input: [
          {
            type: "text",
            text: cleanText.slice(0, 1800),
            annotations: [
              {
                type: "speech_metadata",
                style: styleInstruction,
              },
            ],
          },
        ],
        response_format: { type: "audio" },
        generation_config: {
          speech_config: [
            {
              language: speechLang,
              voice: voiceName,
            },
          ],
        },
      });

      const base64Audio = interaction.output_audio?.data;
      if (!base64Audio) {
        res.status(502).json({ error: "Speech synthesis returned no audio." });
        return;
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: interaction.output_audio?.mime_type || "audio/wav",
      });
    } catch (err) {
      console.error("[SWATI /api/tts] error:", extractErrorText(err));
      const parsed = parseGeminiErrorMessage(err);
      res.status(parsed.status).json({ error: parsed.message });
    }
  });

  app.post("/api/generate-image", async (req, res) => {
    const ai = getAiClient("v1beta");
    if (!ai) {
      res.status(503).json({
        error: "Gemini API key is not configured. Please check Settings > Secrets.",
      });
      return;
    }

    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (!prompt) {
      res.status(400).json({ error: "Please enter a description for the image." });
      return;
    }

    const allowedRatios = new Set(["1:1", "3:4", "4:3", "9:16", "16:9"]);
    const rawRatio = typeof req.body?.aspectRatio === "string" ? req.body.aspectRatio : "1:1";
    const aspectRatio = allowedRatios.has(rawRatio) ? rawRatio : "1:1";

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-image",
        contents: {
          parts: [{ text: prompt.slice(0, 1000) }],
        },
        config: {
          imageConfig: {
            aspectRatio,
          },
        },
      });

      let imageBase64 = "";
      let mimeType = "image/png";
      let caption = "";

      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data && !imageBase64) {
          imageBase64 = part.inlineData.data;
          if (part.inlineData.mimeType) {
            mimeType = part.inlineData.mimeType;
          }
        } else if (typeof part.text === "string" && part.text.trim()) {
          caption += (caption ? "\n" : "") + part.text.trim();
        }
      }

      if (!imageBase64) {
        res.status(502).json({
          error:
            caption ||
            "Image generation did not return an image for this prompt. Please try a different description.",
        });
        return;
      }

      res.json({
        imageDataUrl: `data:${mimeType};base64,${imageBase64}`,
        mimeType,
        caption,
        model: "gemini-3.1-flash-lite-image",
      });
    } catch (err) {
      const rawError = extractErrorText(err);
      console.error("[SWATI /api/generate-image] error:", rawError);
      const upper = rawError.toUpperCase();

      if (
        upper.includes("PERMISSION_DENIED") ||
        upper.includes("BILLING") ||
        upper.includes("PAID") ||
        upper.includes("QUOTA") ||
        upper.includes("RESOURCE_EXHAUSTED") ||
        upper.includes("403") ||
        upper.includes("429")
      ) {
        res.status(402).json({
          error:
            "Image generation is unavailable with the current API key (requires a billing-enabled Gemini API key in Settings > Secrets, or quota is currently exhausted). Normal chat and voice remain available.",
        });
        return;
      }

      if (upper.includes("NOT_FOUND") || upper.includes("404")) {
        res.status(404).json({
          error:
            "Image generation model is currently unavailable on this API configuration. Normal chat and voice remain available.",
        });
        return;
      }

      const parsed = parseGeminiErrorMessage(err);
      res.status(parsed.status).json({ error: parsed.message });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const reqUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (reqUrl.pathname === "/api/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", async (clientWs, request) => {
    const ai = getAiClient("v1beta");
    if (!ai) {
      clientWs.send(
        JSON.stringify({
          type: "error",
          message: "Gemini API key is not configured. Please check Settings > Secrets.",
        })
      );
      clientWs.close();
      return;
    }

    const reqUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const language = normalizeLanguage(reqUrl.searchParams.get("lang"));
    const voiceName = normalizeVoice(reqUrl.searchParams.get("voice"));
    const isWatchingScreen = reqUrl.searchParams.get("watch") === "1";

    let closed = false;
    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

    const sendToClient = (payload: Record<string, unknown>) => {
      if (!closed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    try {
      liveSession = await ai.live.connect({
        model: "gemini-3.8-live",
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
          systemInstruction: buildSwatiInstruction(language, true, isWatchingScreen),
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const content = message.serverContent;
            if (!content) return;

            if (content.inputTranscription?.text) {
              sendToClient({
                type: "inputTranscript",
                text: content.inputTranscription.text,
              });
            }

            if (content.outputTranscription?.text) {
              sendToClient({
                type: "outputTranscript",
                text: content.outputTranscription.text,
              });
            }

            for (const part of content.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                sendToClient({
                  type: "audio",
                  data: part.inlineData.data,
                });
              }
            }

            if (content.interrupted) {
              sendToClient({ type: "interrupted" });
            }

            if (content.turnComplete) {
              sendToClient({ type: "turnComplete" });
            }
          },
          onerror: (err) => {
            const parsed = parseGeminiErrorMessage(err);
            console.error("[SWATI /api/live] onerror:", parsed.message);
            sendToClient({ type: "error", message: parsed.message });
          },
          onclose: (event) => {
            console.log(
              "[SWATI /api/live] onclose:",
              event?.code,
              event?.reason || "(no reason)"
            );
            if (!closed) {
              closed = true;
              sendToClient({ type: "closed" });
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close();
              }
            }
          },
        },
      });
      sendToClient({ type: "ready" });
    } catch (err) {
      const parsed = parseGeminiErrorMessage(err);
      sendToClient({ type: "error", message: parsed.message });
      clientWs.close();
      return;
    }

    clientWs.on("message", (raw) => {
      if (!liveSession || closed) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          data?: string;
          mimeType?: string;
          text?: string;
        };

        if (msg.type === "audio" && typeof msg.data === "string" && msg.data.length > 0) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } else if (msg.type === "video" && typeof msg.data === "string" && msg.data.length > 0) {
          const safeMime =
            msg.mimeType === "image/png" ? "image/png" : "image/jpeg";
          liveSession.sendRealtimeInput({
            video: {
              data: msg.data,
              mimeType: safeMime,
            },
          });
        } else if (msg.type === "text" && typeof msg.text === "string" && msg.text.trim()) {
          liveSession.sendRealtimeInput({
            text: msg.text.trim(),
          });
        } else if (msg.type === "audioStreamEnd") {
          liveSession.sendRealtimeInput({
            audioStreamEnd: true,
          });
        }
      } catch (err) {
        console.error("[SWATI /api/live] message error:", extractErrorText(err));
      }
    });

    clientWs.on("close", () => {
      closed = true;
      try {
        liveSession?.close();
      } catch {
        // Ignore close errors
      }
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "0.0.0.0", () => {
    console.log(`SWATI AI server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start SWATI AI server:", err);
  process.exit(1);
});
