import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Maximize2,
  Mic,
  MicOff,
  SendHorizontal,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { ImagePreviewModal } from "./components/ImagePreviewModal";
import { PermissionSheet } from "./components/PermissionSheet";
import { ScreenWatchConsentSheet } from "./components/ScreenWatchConsentSheet";
import { SwatiEnergyAvatar } from "./components/SwatiEnergyAvatar";
import { VoiceSettingsModal } from "./components/VoiceSettingsModal";
import type {
  ChatMessage,
  LanguageMode,
  MicPermissionState,
  OrbState,
  VoiceName,
} from "./types";
import {
  computeRmsLevel,
  float32ToPcm16Base64,
  GaplessPcmPlayer,
  resampleFloat32,
  WavSpeechPlayer,
} from "./utils/audio";

const STARTER_PROMPTS: Record<
  LanguageMode,
  Array<{ label: string; prompt: string }>
> = {
  auto: [
    { label: "हिंदी में बात करें", prompt: "नमस्ते SWATI AI, आज तुम मेरी क्या मदद कर सकती हो?" },
    { label: "Generate image", prompt: "Create an image of a glowing blue lotus floating in space." },
    { label: "Translate to Hindi", prompt: "Translate 'Where is the nearest metro station?' into Hindi." },
    { label: "तस्वीर बनाएं", prompt: "नीली रोशनी से चमकते भविष्य के शहर की तस्वीर बनाओ।" },
  ],
  en: [
    { label: "What can you do?", prompt: "Hi SWATI AI, what can you help me with today?" },
    { label: "Generate image", prompt: "Create an image of a glowing blue lotus floating in space." },
    { label: "Explain clearly", prompt: "Explain how solar panels generate electricity in simple terms." },
    { label: "Quick message", prompt: "Help me write a polite message saying I will be 15 minutes late." },
  ],
  hi: [
    { label: "परिचय दें", prompt: "नमस्ते SWATI AI, अपना परिचय दो और बताओ तुम क्या कर सकती हो।" },
    { label: "तस्वीर बनाएं", prompt: "नीली रोशनी से चमकते भविष्य के शहर की तस्वीर बनाओ।" },
    { label: "सरल विज्ञान", prompt: "तारे रात में क्यों चमकते हैं? आसान भाषा में बताओ।" },
    { label: "ईमेल लिखें", prompt: "छुट्टी के लिए एक विनम्र संदेश हिंदी में लिख दो।" },
  ],
  or: [
    { label: "ପରିଚୟ ଦିଅନ୍ତୁ", prompt: "ନମସ୍କାର SWATI AI, ଆପଣଙ୍କର ପରିଚୟ ଦିଅନ୍ତୁ ଏବଂ ଆପଣ କଣ କରିପାରିବେ କୁହନ୍ତୁ।" },
    { label: "ଛବି ତିଆରି କରନ୍ତୁ", prompt: "ମହାକାଶରେ ଭାସୁଥିବା ଏକ ନୀଳ ପଦ୍ମର ଛବି ତିଆରି କରନ୍ତୁ।" },
    { label: "ସହଜ ବିଜ୍ଞାନ", prompt: "ରାତିରେ ତାରା କାହିଁକି ଚମକେ? ସହଜ ଓଡ଼ିଆରେ ବୁଝାନ୍ତୁ।" },
    { label: "ବାର୍ତ୍ତା ଲେଖନ୍ତୁ", prompt: "ମୁଁ ୧୫ ମିନିଟ୍ ବିଳମ୍ବରେ ପହଞ୍ଚିବି ବୋଲି ଏକ ନମ୍ର ବାର୍ତ୍ତା ଓଡ଼ିଆରେ ଲେଖିଦିଅନ୍ତୁ।" },
  ],
};

function isImageGenerationIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("/image ") || normalized === "/image") return true;

  const enPattern =
    /\b(create|generate|make|draw|paint|sketch|render|design)\b.{0,24}\b(image|picture|photo|artwork|illustration|wallpaper|portrait|poster|logo|drawing)\b/i;
  const hiPattern =
    /(तस्वीर|फ़ोटो|फोटो|इमेज|चित्र|पेंटिंग).{0,20}(बनाओ|बनाएं|बनाइए|बना दो|दिखाओ|जनरेट)|(image|photo|pic|picture|tasveer|wallpaper).{0,16}(banao|banaiye|bana do|generate karo)/i;

  return enPattern.test(normalized) || hiPattern.test(text);
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toReadableError(err: unknown, fallback: string): string {
  if (typeof err === "string") {
    const trimmed = err.trim();
    if (!trimmed || trimmed === "[object Object]") return fallback;
    if (trimmed.startsWith("{")) {
      try {
        return toReadableError(JSON.parse(trimmed), fallback);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  if (err instanceof Error) {
    return toReadableError(err.message, fallback);
  }

  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (obj.error !== undefined) {
      const nested = toReadableError(obj.error, "");
      if (nested) return nested;
    }
    if (obj.message !== undefined) {
      const nested = toReadableError(obj.message, "");
      if (nested) return nested;
    }
  }

  return fallback;
}

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  const raw = await res.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default function App() {
  const [language, setLanguage] = useState<LanguageMode>("auto");
  const [voice, setVoice] = useState<VoiceName>("Kore");
  const [autoSpeak, setAutoSpeak] = useState<boolean>(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isSendingText, setIsSendingText] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "16:9" | "9:16">("1:1");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    prompt?: string;
  } | null>(null);

  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [micPermission, setMicPermission] =
    useState<MicPermissionState>("checking");
  const [showPermissionSheet, setShowPermissionSheet] = useState(false);
  const [showScreenConsent, setShowScreenConsent] = useState(false);
  const [includeMicOnWatch, setIncludeMicOnWatch] = useState(true);
  const [isWatchingScreen, setIsWatchingScreen] = useState(false);
  const [isWatchMicMuted, setIsWatchMicMuted] = useState(false);
  const [autoDescribeScreen, setAutoDescribeScreen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [micErrorDetail, setMicErrorDetail] = useState<string | null>(null);

  const [liveUserTranscript, setLiveUserTranscript] = useState("");
  const [liveMayaTranscript, setLiveMayaTranscript] = useState("");
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(
    null
  );

  // Audio & WebSocket refs (safe from stale closures)
  const audioLevelRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const isLiveReadyRef = useRef<boolean>(false);
  const isVoiceActiveRef = useRef<boolean>(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micFreqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const gaplessPlayerRef = useRef<GaplessPcmPlayer | null>(null);
  const wavPlayerRef = useRef<WavSpeechPlayer | null>(null);

  // Live Screen Understanding refs (ephemeral in-memory only; never recorded or saved)
  const isWatchingRef = useRef<boolean>(false);
  const isWatchMicMutedRef = useRef<boolean>(false);
  const autoDescribeScreenRef = useRef<boolean>(true);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevDiffPixelsRef = useRef<Uint8ClampedArray | null>(null);
  const screenIntervalRef = useRef<number | null>(null);
  const latestScreenBase64Ref = useRef<string | null>(null);
  const lastNarrationAtRef = useRef<number>(0);
  const hasDescribedInitialFrameRef = useRef<boolean>(false);

  const liveUserTranscriptRef = useRef("");
  const liveMayaTranscriptRef = useRef("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const orbStateRef = useRef<OrbState>("idle");
  orbStateRef.current = orbState;
  isWatchMicMutedRef.current = isWatchMicMuted;
  autoDescribeScreenRef.current = autoDescribeScreen;

  // Initialize audio players
  useEffect(() => {
    gaplessPlayerRef.current = new GaplessPcmPlayer((isSpeaking) => {
      if (!isVoiceActiveRef.current) return;
      setOrbState(isSpeaking ? "speaking" : "listening");
    });
    wavPlayerRef.current = new WavSpeechPlayer();

    return () => {
      gaplessPlayerRef.current?.dispose();
      wavPlayerRef.current?.dispose();
    };
  }, []);

  // Poll live audio level at 60fps for smooth orb animation
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const state = orbStateRef.current;
      if (state === "speaking") {
        const liveLevel = gaplessPlayerRef.current?.getOutputLevel() ?? 0;
        const wavLevel = wavPlayerRef.current?.getOutputLevel() ?? 0;
        audioLevelRef.current = Math.max(liveLevel, wavLevel);
      } else if (
        state === "listening" &&
        !isWatchMicMutedRef.current &&
        micAnalyserRef.current &&
        micFreqDataRef.current
      ) {
        micAnalyserRef.current.getByteTimeDomainData(micFreqDataRef.current);
        let sum = 0;
        const arr = micFreqDataRef.current;
        for (let i = 0; i < arr.length; i++) {
          const v = (arr[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / arr.length);
        audioLevelRef.current = Math.min(1, rms * 4);
      } else {
        audioLevelRef.current = 0;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Check microphone permission status on mount
  const refreshMicPermission = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setMicPermission("unavailable");
      return "unavailable" as MicPermissionState;
    }

    if (navigator.permissions && navigator.permissions.query) {
      try {
        const status = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        const mapped = status.state as MicPermissionState;
        setMicPermission(mapped);
        status.onchange = () => {
          setMicPermission(status.state as MicPermissionState);
        };
        return mapped;
      } catch {
        setMicPermission("prompt");
        return "prompt" as MicPermissionState;
      }
    }

    setMicPermission("prompt");
    return "prompt" as MicPermissionState;
  }, []);

  useEffect(() => {
    void refreshMicPermission();
  }, [refreshMicPermission]);

  // Auto-scroll conversation
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, liveUserTranscript, liveMayaTranscript]);

  const commitLiveTurn = useCallback(() => {
    const userText = liveUserTranscriptRef.current.trim();
    const mayaText = liveMayaTranscriptRef.current.trim();

    if (userText || mayaText) {
      setMessages((prev) => {
        const next = [...prev];
        const now = Date.now();
        if (userText) {
          next.push({
            id: createId(),
            role: "user",
            text: userText,
            timestamp: now,
            source: "voice",
          });
        }
          if (mayaText) {
          next.push({
            id: createId(),
            role: "model",
            text: mayaText,
            timestamp: now + 1,
            source: isWatchingRef.current ? "screen" : "voice",
          });
        }
        return next;
      });
    }

    liveUserTranscriptRef.current = "";
    liveMayaTranscriptRef.current = "";
    setLiveUserTranscript("");
    setLiveMayaTranscript("");
  }, []);

  const clearScreenResources = useCallback(() => {
    isWatchingRef.current = false;
    setIsWatchingScreen(false);
    setIsWatchMicMuted(false);
    isWatchMicMutedRef.current = false;
    latestScreenBase64Ref.current = null;
    prevDiffPixelsRef.current = null;
    hasDescribedInitialFrameRef.current = false;
    lastNarrationAtRef.current = 0;

    if (screenIntervalRef.current !== null) {
      window.clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }

    if (screenStreamRef.current) {
      for (const track of screenStreamRef.current.getTracks()) {
        track.stop();
      }
      screenStreamRef.current = null;
    }

    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
    }
  }, []);

  const stopVoiceSession = useCallback(() => {
    isVoiceActiveRef.current = false;
    isLiveReadyRef.current = false;

    commitLiveTurn();
    clearScreenResources();

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.onaudioprocess = null;
      try {
        scriptProcessorRef.current.disconnect();
      } catch {
        // Ignore disconnect error
      }
      scriptProcessorRef.current = null;
    }

    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getTracks()) {
        track.stop();
      }
      micStreamRef.current = null;
    }

    if (inputAudioCtxRef.current && inputAudioCtxRef.current.state !== "closed") {
      void inputAudioCtxRef.current.close();
      inputAudioCtxRef.current = null;
    }

    micAnalyserRef.current = null;
    micFreqDataRef.current = null;

    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "audioStreamEnd" }));
        }
        wsRef.current.close();
      } catch {
        // Ignore close error
      }
      wsRef.current = null;
    }

    gaplessPlayerRef.current?.interrupt();
    audioLevelRef.current = 0;
    setOrbState("idle");
  }, [clearScreenResources, commitLiveTurn]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopVoiceSession();
    };
  }, [stopVoiceSession]);

  // Attach active screen MediaStream to the visible privacy preview video element
  useEffect(() => {
    const videoEl = screenVideoRef.current;
    const stream = screenStreamRef.current;
    if (isWatchingScreen && videoEl && stream) {
      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
      }
      void videoEl.play().catch(() => {
        // Autoplay with muted+playsInline may settle on loadedmetadata
      });
    }
  }, [isWatchingScreen]);

  const attachMicrophonePipeline = useCallback(async (stream: MediaStream) => {
    micStreamRef.current = stream;

    const inputCtx = new AudioContext({ sampleRate: 16000 });
    if (inputCtx.state === "suspended") {
      await inputCtx.resume();
    }
    inputAudioCtxRef.current = inputCtx;

    const source = inputCtx.createMediaStreamSource(stream);
    const analyser = inputCtx.createAnalyser();
    analyser.fftSize = 256;
    micAnalyserRef.current = analyser;
    micFreqDataRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));

    const processor = inputCtx.createScriptProcessor(4096, 1, 1);
    scriptProcessorRef.current = processor;

    const silentGain = inputCtx.createGain();
    silentGain.gain.value = 0;

    source.connect(analyser);
    analyser.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(inputCtx.destination);

    processor.onaudioprocess = (event) => {
      if (
        !isVoiceActiveRef.current ||
        !isLiveReadyRef.current ||
        (isWatchingRef.current && isWatchMicMutedRef.current) ||
        !wsRef.current ||
        wsRef.current.readyState !== WebSocket.OPEN
      ) {
        return;
      }
      const channelData = event.inputBuffer.getChannelData(0);
      const level = computeRmsLevel(channelData);
      if (orbStateRef.current === "listening") {
        audioLevelRef.current = Math.max(audioLevelRef.current, level);
      }
      const resampled = resampleFloat32(
        channelData,
        inputCtx.sampleRate,
        16000
      );
      const base64 = float32ToPcm16Base64(resampled);
      wsRef.current.send(JSON.stringify({ type: "audio", data: base64 }));
    };
  }, []);

  const captureScreenSnapshot = useCallback((): {
    base64: string;
    diffRatio: number;
  } | null => {
    const video = screenVideoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return null;
    }

    if (!screenCanvasRef.current) {
      screenCanvasRef.current = document.createElement("canvas");
    }
    const maxWidth = 768;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const targetW = Math.max(160, Math.round(video.videoWidth * scale));
    const targetH = Math.max(160, Math.round(video.videoHeight * scale));

    const canvas = screenCanvasRef.current;
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    const commaIdx = dataUrl.indexOf(",");
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : "";
    if (!base64) return null;

    // Lightweight 32x18 pixel-diff check to avoid repeating narration on static screens
    if (!diffCanvasRef.current) {
      diffCanvasRef.current = document.createElement("canvas");
      diffCanvasRef.current.width = 32;
      diffCanvasRef.current.height = 18;
    }
    let diffRatio = 1;
    const diffCtx = diffCanvasRef.current.getContext("2d", {
      willReadFrequently: true,
    });
    if (diffCtx) {
      diffCtx.drawImage(canvas, 0, 0, 32, 18);
      const curr = diffCtx.getImageData(0, 0, 32, 18).data;
      const prev = prevDiffPixelsRef.current;
      if (prev && prev.length === curr.length) {
        let totalDelta = 0;
        let samples = 0;
        for (let i = 0; i < curr.length; i += 4) {
          totalDelta +=
            (Math.abs(curr[i] - prev[i]) +
              Math.abs(curr[i + 1] - prev[i + 1]) +
              Math.abs(curr[i + 2] - prev[i + 2])) /
            (255 * 3);
          samples += 1;
        }
        diffRatio = samples > 0 ? totalDelta / samples : 0;
      }
      prevDiffPixelsRef.current = new Uint8ClampedArray(curr);
    }

    latestScreenBase64Ref.current = base64;
    return { base64, diffRatio };
  }, []);

  const buildNarrationPrompt = useCallback((): string => {
    if (language === "or") {
      return "ଏବେ ମୋର ସେୟାର ହୋଇଥିବା ସ୍କ୍ରିନ୍ ଦେଖନ୍ତୁ ଏବଂ ମୁଁ ସ୍କ୍ରିନ୍‌ରେ କଣ କରୁଛି ତାହା ୧–୨ଟି ସଂକ୍ଷିପ୍ତ, ସ୍ୱାଭାବିକ ଓଡ଼ିଆ ବାକ୍ୟରେ କୁହନ୍ତୁ।";
    }
    if (language === "hi") {
      return "अभी मेरी शेयर की गई स्क्रीन देखें और 1–2 छोटे, स्वाभाविक हिंदी वाक्यों में बताएं कि मैं स्क्रीन पर क्या कर रहा हूँ।";
    }
    if (language === "en") {
      return "Look at my shared screen right now and briefly describe what I am doing in 1 to 2 natural spoken sentences.";
    }
    return "Look at my shared screen right now and briefly describe what I am doing in 1 to 2 natural spoken sentences in my preferred language (Odia, Hindi, or English).";
  }, [language]);

  const openLiveWebSocket = useCallback(
    (watchMode: boolean) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/live?lang=${encodeURIComponent(
        language
      )}&voice=${encodeURIComponent(voice)}${watchMode ? "&watch=1" : ""}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const sendCapturedFrame = () => {
        if (
          !isWatchingRef.current ||
          !isLiveReadyRef.current ||
          !wsRef.current ||
          wsRef.current.readyState !== WebSocket.OPEN
        ) {
          return;
        }
        const snap = captureScreenSnapshot();
        if (!snap) return;

        wsRef.current.send(
          JSON.stringify({ type: "video", data: snap.base64 })
        );

        const now = Date.now();
        const isFirstFrame = !hasDescribedInitialFrameRef.current;
        const significantChange =
          snap.diffRatio >= 0.055 && now - lastNarrationAtRef.current >= 9500;

        if (
          autoDescribeScreenRef.current &&
          (isFirstFrame || significantChange) &&
          orbStateRef.current !== "speaking" &&
          orbStateRef.current !== "thinking"
        ) {
          hasDescribedInitialFrameRef.current = true;
          lastNarrationAtRef.current = now;
          wsRef.current.send(
            JSON.stringify({ type: "text", text: buildNarrationPrompt() })
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            data?: string;
            text?: string;
            message?: string;
          };

          if (msg.type === "ready") {
            isLiveReadyRef.current = true;
            setOrbState("listening");
            if (watchMode && isWatchingRef.current) {
              window.setTimeout(sendCapturedFrame, 450);
              if (screenIntervalRef.current !== null) {
                window.clearInterval(screenIntervalRef.current);
              }
              screenIntervalRef.current = window.setInterval(
                sendCapturedFrame,
                2500
              );
            }
          } else if (msg.type === "audio" && msg.data) {
            setOrbState("speaking");
            gaplessPlayerRef.current?.enqueuePcm16Base64(msg.data);
          } else if (msg.type === "inputTranscript" && msg.text) {
            liveUserTranscriptRef.current += msg.text;
            setLiveUserTranscript(liveUserTranscriptRef.current);
          } else if (msg.type === "outputTranscript" && msg.text) {
            liveMayaTranscriptRef.current += msg.text;
            setLiveMayaTranscript(liveMayaTranscriptRef.current);
          } else if (msg.type === "interrupted") {
            gaplessPlayerRef.current?.interrupt();
            setOrbState("listening");
          } else if (msg.type === "turnComplete") {
            commitLiveTurn();
          } else if (msg.type === "error") {
            setErrorBanner(
              toReadableError(
                msg.message,
                "Voice connection interrupted. Please try again."
              )
            );
            stopVoiceSession();
            setOrbState("error");
          } else if (msg.type === "closed") {
            if (isVoiceActiveRef.current) {
              stopVoiceSession();
            }
          }
        } catch {
          // Ignore malformed message
        }
      };

      ws.onerror = () => {
        if (isVoiceActiveRef.current) {
          setErrorBanner("Unable to connect live voice session.");
          stopVoiceSession();
          setOrbState("error");
        }
      };

      ws.onclose = () => {
        if (isVoiceActiveRef.current) {
          stopVoiceSession();
        }
      };
    },
    [
      buildNarrationPrompt,
      captureScreenSnapshot,
      commitLiveTurn,
      language,
      stopVoiceSession,
      voice,
    ]
  );

  const requestMicrophoneStream = useCallback(async (): Promise<MediaStream | null> => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicPermission("unavailable");
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      setMicPermission("granted");
      return stream;
    } catch (err) {
      const domErr = err as DOMException | undefined;
      const name = domErr?.name ?? "";

      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setMicPermission("denied");
        setMicErrorDetail(
          language === "or"
            ? "ମାଇକ୍ରୋଫୋନ୍ ଅନୁମତି ପ୍ରତ୍ୟାଖ୍ୟାନ କରାଯାଇଛି। ବ୍ରାଉଜର୍ ସେଟିଂସ୍‌ରୁ ଅନୁମତି ଦିଅନ୍ତୁ।"
            : language === "hi"
              ? "माइक्रोफ़ोन की अनुमति अस्वीकार की गई। कृपया ब्राउज़र सेटिंग्स से अनुमति दें।"
              : "Microphone permission was denied. Enable microphone access in your browser settings to talk with SWATI AI."
        );
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setMicPermission("unavailable");
        setMicErrorDetail(
          language === "or"
            ? "ଏହି ଡିଭାଇସ୍‌ରେ କୌଣସି ମାଇକ୍ରୋଫୋନ୍ ମିଳିଲା ନାହିଁ।"
            : language === "hi"
              ? "इस डिवाइस पर कोई माइक्रोफ़ोन नहीं मिला।"
              : "No microphone was found on this device."
        );
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        setMicErrorDetail(
          language === "or"
            ? "ମାଇକ୍ରୋଫୋନ୍ ବର୍ତ୍ତମାନ ଅନ୍ୟ ଏକ ଆପ୍ ଦ୍ୱାରା ବ୍ୟବହୃତ ହେଉଛି।"
            : language === "hi"
              ? "माइक्रोफ़ोन अभी किसी अन्य ऐप द्वारा उपयोग किया जा रहा है।"
              : "Your microphone is currently in use by another app. Close it and try again."
        );
      } else {
        setMicErrorDetail(
          domErr?.message ||
            "Could not access microphone. Please check permissions and try again."
        );
      }
      return null;
    }
  }, [language]);

  const startVoiceSession = useCallback(async () => {
    if (isVoiceActiveRef.current) return;

    setErrorBanner(null);
    setMicErrorDetail(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicPermission("unavailable");
      setShowPermissionSheet(true);
      return;
    }

    wavPlayerRef.current?.stop();
    setSpeakingMessageId(null);
    gaplessPlayerRef.current?.unlock();

    setOrbState("connecting");
    isVoiceActiveRef.current = true;

    const stream = await requestMicrophoneStream();
    if (!stream) {
      isVoiceActiveRef.current = false;
      setOrbState("idle");
      setShowPermissionSheet(true);
      return;
    }

    if (!isVoiceActiveRef.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    try {
      await attachMicrophonePipeline(stream);
      openLiveWebSocket(false);
    } catch (err) {
      setErrorBanner(
        toReadableError(err, "Failed to initialize voice audio pipeline.")
      );
      stopVoiceSession();
      setOrbState("error");
    }
  }, [
    attachMicrophonePipeline,
    openLiveWebSocket,
    requestMicrophoneStream,
    stopVoiceSession,
  ]);

  const startScreenWatching = useCallback(async () => {
    setErrorBanner(null);
    setMicErrorDetail(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getDisplayMedia
    ) {
      setErrorBanner(
        language === "or"
          ? "ଏହି ବ୍ରାଉଜର୍ କିମ୍ବା WebView ରେ Android MediaProjection ସ୍କ୍ରିନ୍ ସେୟାରିଂ (getDisplayMedia) ଉପଲବ୍ଧ ନାହିଁ। ଦୟାକରି Android Chrome କିମ୍ବା ସମର୍ଥିତ ବ୍ରାଉଜର୍ ବ୍ୟବହାର କରନ୍ତୁ।"
          : language === "hi"
            ? "इस ब्राउज़र या WebView में Android MediaProjection स्क्रीन शेयरिंग (getDisplayMedia) उपलब्ध नहीं है। कृपया Android Chrome या समर्थित ब्राउज़र का उपयोग करें।"
            : "Android MediaProjection screen sharing (getDisplayMedia) is not supported in this browser/WebView. Please open SWATI AI in Android Chrome or a supported browser."
      );
      return;
    }

    if (isVoiceActiveRef.current) {
      stopVoiceSession();
    }

    wavPlayerRef.current?.stop();
    setSpeakingMessageId(null);
    gaplessPlayerRef.current?.unlock();

    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 1, max: 2 },
        },
        audio: false,
      });
    } catch (err) {
      const domErr = err as DOMException | undefined;
      const name = domErr?.name ?? "";
      if (name === "NotAllowedError" || name === "AbortError") {
        setErrorBanner(
          language === "or"
            ? "ସ୍କ୍ରିନ୍ ସେୟାରିଂ ଅନୁମତି ଦିଆଯାଇନାହିଁ — SWATI AI ଆପଣଙ୍କ ସ୍କ୍ରିନ୍ ଦେଖୁନାହିଁ।"
            : language === "hi"
              ? "स्क्रीन शेयरिंग की अनुमति नहीं दी गई — SWATI AI आपकी स्क्रीन नहीं देख रही है।"
              : "Screen sharing permission was cancelled — SWATI AI is not viewing your screen."
        );
      } else {
        setErrorBanner(
          toReadableError(
            err,
            "Could not start screen sharing. Please grant screen capture permission and try again."
          )
        );
      }
      return;
    }

    const videoTracks = displayStream.getVideoTracks();
    if (videoTracks.length === 0) {
      for (const t of displayStream.getTracks()) t.stop();
      setErrorBanner("No screen video track was provided.");
      return;
    }

    screenStreamRef.current = displayStream;
    isWatchingRef.current = true;
    setIsWatchingScreen(true);
    hasDescribedInitialFrameRef.current = false;
    lastNarrationAtRef.current = 0;
    prevDiffPixelsRef.current = null;

    videoTracks[0].addEventListener("ended", () => {
      if (isWatchingRef.current) {
        stopVoiceSession();
      }
    });

    setOrbState("connecting");
    isVoiceActiveRef.current = true;

    let micMuted = !includeMicOnWatch;
    if (includeMicOnWatch) {
      const micStream = await requestMicrophoneStream();
      if (micStream && isWatchingRef.current) {
        try {
          await attachMicrophonePipeline(micStream);
          micMuted = false;
        } catch {
          for (const t of micStream.getTracks()) t.stop();
          micMuted = true;
        }
      } else {
        micMuted = true;
      }
    }

    setIsWatchMicMuted(micMuted);
    isWatchMicMutedRef.current = micMuted;

    if (!isWatchingRef.current) {
      stopVoiceSession();
      return;
    }

    try {
      openLiveWebSocket(true);
    } catch (err) {
      setErrorBanner(
        toReadableError(err, "Failed to start Live Screen Understanding session.")
      );
      stopVoiceSession();
      setOrbState("error");
    }
  }, [
    attachMicrophonePipeline,
    includeMicOnWatch,
    language,
    openLiveWebSocket,
    requestMicrophoneStream,
    stopVoiceSession,
  ]);

  const handleToggleWatchMic = useCallback(async () => {
    if (!isWatchingRef.current) return;

    if (isWatchMicMutedRef.current) {
      if (!micStreamRef.current) {
        const micStream = await requestMicrophoneStream();
        if (!micStream) {
          setShowPermissionSheet(true);
          return;
        }
        try {
          await attachMicrophonePipeline(micStream);
        } catch (err) {
          setErrorBanner(
            toReadableError(err, "Could not enable microphone while watching.")
          );
          return;
        }
      }
      isWatchMicMutedRef.current = false;
      setIsWatchMicMuted(false);
    } else {
      isWatchMicMutedRef.current = true;
      setIsWatchMicMuted(true);
    }
  }, [attachMicrophonePipeline, requestMicrophoneStream]);

  const handleDescribeScreenNow = useCallback(() => {
    if (
      !isWatchingRef.current ||
      !isLiveReadyRef.current ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const snap = captureScreenSnapshot();
    if (snap) {
      wsRef.current.send(JSON.stringify({ type: "video", data: snap.base64 }));
    }
    lastNarrationAtRef.current = Date.now();
    hasDescribedInitialFrameRef.current = true;
    wsRef.current.send(
      JSON.stringify({ type: "text", text: buildNarrationPrompt() })
    );
  }, [buildNarrationPrompt, captureScreenSnapshot]);

  const handleToggleVoice = useCallback(() => {
    if (isVoiceActiveRef.current) {
      stopVoiceSession();
    } else {
      void startVoiceSession();
    }
  }, [startVoiceSession, stopVoiceSession]);

  const speakMessage = useCallback(
    async (
      messageId: string,
      text: string,
      cachedBase64?: string,
      silentOnFail = false
    ) => {
      if (!wavPlayerRef.current) return;

      if (speakingMessageId === messageId) {
        wavPlayerRef.current.stop();
        setSpeakingMessageId(null);
        if (!isVoiceActiveRef.current) {
          setOrbState("idle");
        }
        return;
      }

      try {
        let audioBase64 = cachedBase64;
        if (!audioBase64) {
          const ttsRes = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voice, language }),
          });
          const ttsData = await readJsonSafe<{
            audioBase64?: string;
            error?: unknown;
          }>(ttsRes);
          if (!ttsRes.ok || !ttsData?.audioBase64) {
            throw new Error(
              toReadableError(
                ttsData?.error,
                `Speech synthesis failed (HTTP ${ttsRes.status}).`
              )
            );
          }
          audioBase64 = ttsData.audioBase64;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId ? { ...m, audioBase64 } : m
            )
          );
        }

        await wavPlayerRef.current.playWavBase64(
          audioBase64,
          () => {
            setSpeakingMessageId(messageId);
            if (!isVoiceActiveRef.current) {
              setOrbState("speaking");
            }
          },
          () => {
            setSpeakingMessageId((curr) => (curr === messageId ? null : curr));
            if (!isVoiceActiveRef.current) {
              setOrbState("idle");
            }
          }
        );
      } catch (err) {
        setSpeakingMessageId(null);
        if (!isVoiceActiveRef.current) {
          setOrbState("idle");
        }
        if (!silentOnFail) {
          setErrorBanner(
            toReadableError(err, "Could not play voice reply.")
          );
        }
      }
    },
    [language, speakingMessageId, voice]
  );

  const handleDownloadImage = useCallback(
    (imageDataUrl: string, prompt?: string) => {
      const slug = (prompt || "swati-ai-image")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32);
      const filename = `${slug || "swati-ai-image"}-${Date.now()}.png`;
      const link = document.createElement("a");
      link.href = imageDataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
    []
  );

  const generateImage = useCallback(
    async (rawPrompt: string) => {
      const cleanPrompt = rawPrompt.replace(/^\/image\s+/i, "").trim();
      if (!cleanPrompt || isSendingText || isGeneratingImage) return;

      setErrorBanner(null);
      setInputText("");
      setImageMode(false);
      wavPlayerRef.current?.stop();
      setSpeakingMessageId(null);

      const userMsg: ChatMessage = {
        id: createId(),
        role: "user",
        text: cleanPrompt,
        timestamp: Date.now(),
        source: "image",
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsGeneratingImage(true);
      setOrbState("thinking");

      try {
        const res = await fetch("/api/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: cleanPrompt,
            aspectRatio,
          }),
        });

        const data = await readJsonSafe<{
          imageDataUrl?: string;
          caption?: string;
          error?: unknown;
        }>(res);

        if (!res.ok || !data?.imageDataUrl) {
          throw new Error(
            toReadableError(
              data?.error,
              `Image generation failed (HTTP ${res.status}).`
            )
          );
        }

        const modelMsg: ChatMessage = {
          id: createId(),
          role: "model",
          text:
            data.caption ||
            (language === "or"
              ? `ଏହା ହେଉଛି "${cleanPrompt}" ପାଇଁ ତିଆରି ହୋଇଥିବା ଛବି:`
              : language === "hi"
                ? `यहाँ "${cleanPrompt}" की तस्वीर है:`
                : `Here is the generated image for "${cleanPrompt}":`),
          timestamp: Date.now(),
          source: "image",
          imageDataUrl: data.imageDataUrl,
          imagePrompt: cleanPrompt,
        };

        setMessages((prev) => [...prev, modelMsg]);
        setOrbState("idle");
      } catch (err) {
        const message = toReadableError(
          err,
          "Image generation is currently unavailable."
        );
        setOrbState("error");
        setErrorBanner(message);
        setMessages((prev) => [
          ...prev,
          {
            id: createId(),
            role: "model",
            text: message,
            timestamp: Date.now(),
            source: "image",
          },
        ]);
      } finally {
        setIsGeneratingImage(false);
      }
    },
    [aspectRatio, isGeneratingImage, isSendingText, language]
  );

  const sendTextMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || isSendingText || isGeneratingImage) return;

      if (imageMode || isImageGenerationIntent(text)) {
        await generateImage(text);
        return;
      }

      setErrorBanner(null);
      setInputText("");

      // If Live Voice / Watch session is open and ready, send directly into Live session
      if (
        isVoiceActiveRef.current &&
        isLiveReadyRef.current &&
        wsRef.current &&
        wsRef.current.readyState === WebSocket.OPEN
      ) {
        if (isWatchingRef.current) {
          const snap = captureScreenSnapshot();
          if (snap) {
            wsRef.current.send(
              JSON.stringify({ type: "video", data: snap.base64 })
            );
          }
        }
        const userMsg: ChatMessage = {
          id: createId(),
          role: "user",
          text,
          timestamp: Date.now(),
          source: isWatchingRef.current ? "screen" : "text",
        };
        setMessages((prev) => [...prev, userMsg]);
        wsRef.current.send(JSON.stringify({ type: "text", text }));
        return;
      }

      wavPlayerRef.current?.stop();
      setSpeakingMessageId(null);

      const capturedScreenFrame = isWatchingRef.current
        ? captureScreenSnapshot()?.base64 || latestScreenBase64Ref.current
        : null;

      const userMsg: ChatMessage = {
        id: createId(),
        role: "user",
        text,
        timestamp: Date.now(),
        source: capturedScreenFrame ? "screen" : "text",
      };

      const historyPayload = messages.slice(-14).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      setMessages((prev) => [...prev, userMsg]);
      setIsSendingText(true);
      setOrbState("thinking");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            history: historyPayload,
            language,
            ...(capturedScreenFrame
              ? { screenFrameBase64: capturedScreenFrame }
              : {}),
          }),
        });

        const data = await readJsonSafe<{ reply?: string; error?: unknown }>(res);
        if (!res.ok || !data?.reply) {
          throw new Error(
            toReadableError(
              data?.error,
              `SWATI AI could not respond right now (HTTP ${res.status}).`
            )
          );
        }

        const modelMsgId = createId();
        const modelMsg: ChatMessage = {
          id: modelMsgId,
          role: "model",
          text: data.reply,
          timestamp: Date.now(),
          source: capturedScreenFrame ? "screen" : "text",
        };

        setMessages((prev) => [...prev, modelMsg]);
        setOrbState("idle");

        if (autoSpeak) {
          void speakMessage(modelMsgId, data.reply, undefined, true);
        }
      } catch (err) {
        setOrbState("error");
        setErrorBanner(
          toReadableError(err, "Something went wrong. Please try again.")
        );
      } finally {
        setIsSendingText(false);
      }
    },
    [
      autoSpeak,
      captureScreenSnapshot,
      generateImage,
      imageMode,
      isGeneratingImage,
      isSendingText,
      language,
      messages,
      speakMessage,
    ]
  );

  const handleGenerateImageButton = () => {
    if (isSendingText || isGeneratingImage) return;
    if (inputText.trim()) {
      void generateImage(inputText);
      return;
    }
    setImageMode((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
      return next;
    });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendTextMessage(inputText);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendTextMessage(inputText);
    }
  };

  const handleLanguageChange = (nextLang: LanguageMode) => {
    setLanguage(nextLang);
    if (isVoiceActiveRef.current) {
      stopVoiceSession();
    }
  };

  const isVoiceActive =
    orbState === "connecting" ||
    orbState === "listening" ||
    orbState === "speaking";

  const statusLabel = (() => {
    const hi = language === "hi";
    const or = language === "or";
    if (isWatchingScreen) {
      switch (orbState) {
        case "connecting":
          return or
            ? "ସ୍କ୍ରିନ୍ ଦେଖିବା ପାଇଁ ସଂଯୋଗ ହେଉଛି..."
            : hi
              ? "स्क्रीन देखने के लिए जुड़ रहे हैं..."
              : "Connecting screen sharing...";
        case "speaking":
          return or
            ? "SWATI AI ସ୍କ୍ରିନ୍ ଦେଖି କହୁଛି"
            : hi
              ? "SWATI AI स्क्रीन देखकर बोल रही है"
              : "SWATI AI is describing your screen";
        case "thinking":
          return or
            ? "ସ୍କ୍ରିନ୍ ବିଶ୍ଳେଷଣ କରୁଛି..."
            : hi
              ? "स्क्रीन समझ रही हूँ..."
              : "Analyzing screen...";
        default:
          return or
            ? "ସ୍କ୍ରିନ୍ ଦେଖୁଛି — ଓଡ଼ିଆ, ହିନ୍ଦୀ କିମ୍ବା ଇଂରାଜୀରେ ପଚାରନ୍ତୁ"
            : hi
              ? "स्क्रीन देख रही हूँ — हिंदी, उड़िया या अंग्रेज़ी में पूछें"
              : "Watching screen — ask in Odia, Hindi, or English";
      }
    }
    switch (orbState) {
      case "connecting":
        return or
          ? "SWATI AI ସହିତ ସଂଯୋଗ ହେଉଛି..."
          : hi
            ? "SWATI AI से जुड़ रहे हैं..."
            : "Connecting to SWATI AI...";
      case "listening":
        return or
          ? "ଶୁଣୁଛି — ଓଡ଼ିଆ, ହିନ୍ଦୀ କିମ୍ବା ଇଂରାଜୀରେ କୁହନ୍ତୁ"
          : hi
            ? "सुन रही हूँ — हिंदी, उड़िया या अंग्रेज़ी में बोलें"
            : "Listening — speak in Odia, Hindi, or English";
      case "thinking":
        return or ? "ଚିନ୍ତା କରୁଛି..." : hi ? "सोच रही हूँ..." : "Thinking...";
      case "speaking":
        return or
          ? "SWATI AI କହୁଛି"
          : hi
            ? "SWATI AI बोल रही है"
            : "SWATI AI is speaking";
      case "error":
        return or
          ? "ସଂଯୋଗରେ ସମସ୍ୟା"
          : hi
            ? "कनेक्शन में समस्या आई"
            : "Attention needed";
      default:
        return or
          ? "କଥାବାର୍ତ୍ତା ଆରମ୍ଭ କରିବାକୁ SWATI AI ଉପରେ ଟ୍ୟାପ୍ କରନ୍ତୁ"
          : hi
            ? "वॉइस बात शुरू करने के लिए SWATI AI पर टैप करें"
            : "Tap SWATI AI to talk in Odia, Hindi, or English";
    }
  })();

  const hasConversation =
    messages.length > 0 ||
    liveUserTranscript.trim().length > 0 ||
    liveMayaTranscript.trim().length > 0;

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-[#040711] text-slate-100 overflow-hidden relative">
      {/* Subtle deep-space ambient radial backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_18%,rgba(37,99,235,0.16),transparent_60%)]"
      />

      {/* Compact Sticky Top Bar */}
      <header className="relative z-20 shrink-0 pt-safe border-b border-blue-500/10 bg-[#040711]/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-3.5 sm:px-6 h-14 flex items-center justify-between gap-2">
          <span className="font-[var(--font-display)] text-base sm:text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            SWATI <span className="text-blue-400">AI</span>
          </span>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Trilingual Language Switcher */}
            <div
              role="group"
              aria-label="Conversation language"
              className="flex items-center p-0.5 rounded-xl bg-[#0B1224] border border-slate-800/90"
            >
              {(
                [
                  { id: "auto", label: "Auto" },
                  { id: "en", label: "EN" },
                  { id: "hi", label: "हिन्दी" },
                  { id: "or", label: "ଓଡ଼ିଆ" },
                ] as const
              ).map((item) => {
                const active = language === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleLanguageChange(item.id)}
                    className={`min-h-[36px] px-2 sm:px-3 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      active
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setShowSettings(true)}
              aria-label="Voice and reply settings"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/70 transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Responsive Content Stage */}
      <main className="relative z-10 flex-1 min-h-0 max-w-6xl w-full mx-auto flex flex-col lg:grid lg:grid-cols-12 lg:gap-6 px-3.5 sm:px-6">
        {/* Left / Top: Main 3D Blue Energy Avatar Stage */}
        <section
          aria-label="SWATI AI Energy Avatar"
          className={`flex flex-col items-center justify-center shrink-0 lg:col-span-6 lg:h-full transition-all duration-300 ${
            hasConversation ? "py-1 sm:py-2 lg:py-4" : "py-2 sm:py-4 flex-1 lg:flex-none"
          }`}
        >
          <SwatiEnergyAvatar
            orbState={orbState}
            audioLevelRef={audioLevelRef}
            onTap={handleToggleVoice}
            compact={hasConversation}
            statusLabel={statusLabel}
          />

          {/* Live Voice Captions */}
          {(liveUserTranscript || liveMayaTranscript) && (
            <div className="mt-2.5 w-full max-w-md rounded-2xl bg-[#0A1124] border border-blue-500/20 px-4 py-3 text-sm space-y-1.5">
              {liveUserTranscript && (
                <p className="text-slate-300 leading-snug">
                  <span className="text-blue-400 font-medium mr-1.5">You:</span>
                  {liveUserTranscript}
                </p>
              )}
              {liveMayaTranscript && (
                <p className="text-blue-100 leading-snug">
                  <span className="text-sky-400 font-medium mr-1.5">SWATI AI:</span>
                  {liveMayaTranscript}
                </p>
              )}
            </div>
          )}

          {/* Live Screen Sharing Privacy Indicator & Preview Card (visible only with explicit user permission) */}
          {isWatchingScreen && (
            <div
              role="region"
              aria-label="Live screen sharing privacy indicator and controls"
              className="mt-2.5 w-full max-w-md rounded-2xl bg-[#0A1329] border border-emerald-400/35 p-3 shadow-lg space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-emerald-300 font-medium">
                  <span
                    aria-hidden="true"
                    className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0"
                  />
                  <span>
                    {language === "or"
                      ? "ସ୍କ୍ରିନ୍ ସେୟାରିଂ ଚାଲୁଅଛି · ରେକର୍ଡିଂ ହେଉନାହିଁ"
                      : language === "hi"
                        ? "स्क्रीन शेयरिंग चालू · रिकॉर्डिंग बंद"
                        : "Screen Sharing Active · Not Recording"}
                  </span>
                </div>
                <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0" />
              </div>

              <div className="flex items-center gap-3">
                <video
                  ref={screenVideoRef}
                  muted
                  playsInline
                  autoPlay
                  className="w-24 h-16 sm:w-28 sm:h-[72px] rounded-xl object-cover border border-blue-500/25 bg-[#040711] shrink-0"
                />

                <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleToggleWatchMic()}
                    className={`min-h-[38px] px-2.5 rounded-xl text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
                      isWatchMicMuted
                        ? "bg-amber-500/15 border-amber-400/35 text-amber-200 hover:bg-amber-500/25"
                        : "bg-blue-600/20 border-blue-400/40 text-blue-100 hover:bg-blue-600/30"
                    }`}
                  >
                    {isWatchMicMuted ? (
                      <>
                        <MicOff className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {language === "or"
                            ? "ମାଇକ୍ ବନ୍ଦ"
                            : language === "hi"
                              ? "माइक बंद"
                              : "Mic Muted"}
                        </span>
                      </>
                    ) : (
                      <>
                        <Mic className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {language === "or"
                            ? "ମାଇକ୍ ଚାଲୁ"
                            : language === "hi"
                              ? "माइक चालू"
                              : "Mic On"}
                        </span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setAutoDescribeScreen((prev) => !prev)}
                    className={`min-h-[38px] px-2.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                      autoDescribeScreen
                        ? "bg-[#0F1B38] border-blue-400/40 text-blue-200"
                        : "bg-[#070D1D] border-slate-700 text-slate-400"
                    }`}
                  >
                    {autoDescribeScreen
                      ? language === "or"
                        ? "ଅଟୋ ବର୍ଣ୍ଣନା: ଚାଲୁ"
                        : language === "hi"
                          ? "ऑटो वर्णन: चालू"
                          : "Auto-Describe: On"
                      : language === "or"
                        ? "ଅଟୋ ବର୍ଣ୍ଣନା: ବନ୍ଦ"
                        : language === "hi"
                          ? "ऑटो वर्णन: रुका"
                          : "Auto-Describe: Paused"}
                  </button>

                  <button
                    type="button"
                    onClick={handleDescribeScreenNow}
                    className="min-h-[38px] px-2.5 rounded-xl text-xs font-medium bg-[#0F1B38] border border-blue-500/30 text-blue-200 hover:bg-blue-600/25 transition-colors cursor-pointer"
                  >
                    {language === "or"
                      ? "ଏବେ ବୁଝାନ୍ତୁ"
                      : language === "hi"
                        ? "अभी बताएं"
                        : "Describe Now"}
                  </button>

                  <button
                    type="button"
                    onClick={stopVoiceSession}
                    className="min-h-[38px] px-3 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <EyeOff className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {language === "or"
                        ? "ଦେଖିବା ବନ୍ଦ କରନ୍ତୁ"
                        : language === "hi"
                          ? "देखना बंद करें"
                          : "Stop Watching"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Explicit Microphone Permission Alert Strip (when blocked/unavailable) */}
          {(micPermission === "denied" || micPermission === "unavailable") && (
            <button
              type="button"
              onClick={() => setShowPermissionSheet(true)}
              className="mt-3 min-h-[44px] px-4 py-2 rounded-xl bg-amber-500/12 border border-amber-400/30 text-amber-200 text-xs font-medium flex items-center gap-2 hover:bg-amber-500/20 transition-colors cursor-pointer"
            >
              <MicOff className="w-4 h-4 shrink-0 text-amber-300" />
              <span>
                {micPermission === "denied"
                  ? language === "or"
                    ? "ମାଇକ୍ରୋଫୋନ୍ ବନ୍ଦ ଅଛି — ଚାଲୁ କରିବାକୁ ଟ୍ୟାପ୍ କରନ୍ତୁ"
                    : language === "hi"
                      ? "माइक्रोफ़ोन बंद है — चालू करने के लिए टैप करें"
                      : "Microphone blocked — tap for permission steps"
                  : language === "or"
                    ? "ମାଇକ୍ରୋଫୋନ୍ ଉପଲବ୍ଧ ନାହିଁ — ଟେକ୍ସଟ୍ ଚାଟ୍ ଚାଲୁ ଅଛି"
                    : language === "hi"
                      ? "माइक्रोफ़ोन उपलब्ध नहीं है — टेक्स्ट चैट चालू है"
                      : "Microphone unavailable — text chat ready"}
              </span>
            </button>
          )}
        </section>

        {/* Right / Middle: Scrollable Conversation & Starter Prompts */}
        <section
          aria-label="Conversation"
          className={`flex flex-col min-h-0 lg:col-span-6 lg:py-4 ${
            hasConversation ? "flex-1" : "shrink-0 lg:flex-1 lg:justify-center"
          }`}
        >
          {errorBanner && (
            <div
              role="alert"
              className="mb-2.5 rounded-xl bg-rose-500/12 border border-rose-400/30 px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs text-rose-200 shrink-0"
            >
              <span>{errorBanner}</span>
              <button
                type="button"
                onClick={() => {
                  setErrorBanner(null);
                  if (orbState === "error") setOrbState("idle");
                }}
                className="min-h-[36px] px-2.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 font-medium shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {!hasConversation ? (
            <div className="pb-3 lg:pb-0 space-y-3">
              <div className="rounded-2xl bg-[#0B1328] border border-blue-500/15 px-4 py-3 text-sm sm:text-[15px] text-slate-100 leading-relaxed">
                {language === "or"
                  ? "ନମସ୍କାର! ମୁଁ SWATI AI। ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?"
                  : language === "hi"
                    ? "नमस्ते! मैं SWATI AI हूँ। मैं आपकी कैसे मदद कर सकती हूँ?"
                    : "Hello! I am SWATI AI. How can I help you?"}
              </div>
              <p className="text-xs font-medium text-slate-400 px-0.5">
                {language === "or"
                  ? "ଶୀଘ୍ର ପଚାରିବା ପାଇଁ ଟ୍ୟାପ୍ କରନ୍ତୁ"
                  : language === "hi"
                    ? "तुरंत पूछने के लिए टैप करें"
                    : "Quick prompts in Odia, Hindi & English"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {STARTER_PROMPTS[language].map((item) => (
                  <button
                    key={item.prompt}
                    type="button"
                    onClick={() => void sendTextMessage(item.prompt)}
                    className="min-h-[52px] px-3.5 py-2.5 rounded-2xl bg-[#0A1124]/90 border border-slate-800/90 hover:border-blue-500/40 active:scale-[0.99] text-left transition-all cursor-pointer"
                  >
                    <p className="text-xs font-semibold text-blue-300">
                      {item.label}
                    </p>
                    <p className="text-xs text-slate-300 line-clamp-1 mt-0.5">
                      {item.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto maya-scroll space-y-3 pr-1 pb-3">
              {messages.map((msg) => {
                const isUser = msg.role === "user";
                const isSpeakingThis = speakingMessageId === msg.id;

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      isUser ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`max-w-[88%] sm:max-w-[82%] rounded-2xl px-4 py-3 text-sm sm:text-[15px] leading-relaxed ${
                        isUser
                          ? "bg-blue-600 text-white rounded-br-md"
                          : "bg-[#0B1328] border border-blue-500/15 text-slate-100 rounded-bl-md"
                      }`}
                    >
                      {msg.imageDataUrl && (
                        <div className="mb-2.5 overflow-hidden rounded-xl border border-blue-500/20 bg-[#070D1E]">
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewImage({
                                url: msg.imageDataUrl!,
                                prompt: msg.imagePrompt,
                              })
                            }
                            aria-label="Preview generated image"
                            className="block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                          >
                            <img
                              src={msg.imageDataUrl}
                              alt={msg.imagePrompt || "Generated AI image"}
                              referrerPolicy="no-referrer"
                              className="w-full max-h-72 object-cover"
                            />
                          </button>
                          <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-t border-blue-500/15 bg-[#081024]">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewImage({
                                  url: msg.imageDataUrl!,
                                  prompt: msg.imagePrompt,
                                })
                              }
                              className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium text-blue-200 hover:bg-blue-500/15 flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                              <span>{language === "hi" ? "बड़ा देखें" : "Preview"}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                handleDownloadImage(msg.imageDataUrl!, msg.imagePrompt)
                              }
                              className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium bg-blue-600/20 hover:bg-blue-600/35 text-blue-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>{language === "hi" ? "डाउनलोड" : "Download"}</span>
                            </button>
                          </div>
                        </div>
                      )}

                      <p className="whitespace-pre-wrap break-words">
                        {msg.text}
                      </p>

                      <div
                        className={`mt-1.5 flex items-center gap-2 text-[11px] ${
                          isUser ? "text-blue-100/80 justify-end" : "text-slate-400"
                        }`}
                      >
                        <span>
                          {msg.source === "voice"
                            ? "Voice"
                            : msg.source === "screen"
                              ? "Screen"
                              : msg.source === "image"
                                ? "Image"
                                : "Text"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {formatTime(msg.timestamp)}
                        </span>

                        {!isUser && !msg.imageDataUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              void speakMessage(msg.id, msg.text, msg.audioBase64)
                            }
                            aria-label={
                              isSpeakingThis
                                ? "Stop voice playback"
                                : "Listen to reply"
                            }
                            className={`ml-auto min-h-[32px] px-2 rounded-lg flex items-center gap-1 transition-colors cursor-pointer ${
                              isSpeakingThis
                                ? "bg-blue-500/25 text-blue-200"
                                : "hover:bg-slate-800 text-slate-300 hover:text-white"
                            }`}
                          >
                            {isSpeakingThis ? (
                              <>
                                <Square className="w-3 h-3 fill-current" />
                                <span>Stop</span>
                              </>
                            ) : (
                              <>
                                <Volume2 className="w-3.5 h-3.5" />
                                <span>Listen</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {(isSendingText || isGeneratingImage) && (
                <div className="flex items-start">
                  <div className="rounded-2xl rounded-bl-md bg-[#0B1328] border border-blue-500/15 px-4 py-3 text-sm text-blue-200/80">
                    {isGeneratingImage
                      ? language === "or"
                        ? "SWATI AI ଛବି ତିଆରି କରୁଛି..."
                        : language === "hi"
                          ? "SWATI AI तस्वीर बना रही है..."
                          : "SWATI AI is generating your image..."
                      : language === "or"
                        ? "SWATI AI ଉତ୍ତର ପ୍ରସ୍ତୁତ କରୁଛି..."
                        : language === "hi"
                          ? "SWATI AI जवाब लिख रही है..."
                          : "SWATI AI is thinking..."}
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </section>
      </main>

      {/* Bottom Ergonomic Thumb-Zone Input & Mic Bar */}
      <footer className="relative z-20 shrink-0 border-t border-blue-500/15 bg-[#050914]/95 backdrop-blur-md pb-safe">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 pt-2 space-y-2">
          {/* Compact Action Row: Start/Stop Screen Watching + Generate Image */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  if (isWatchingScreen) {
                    stopVoiceSession();
                  } else {
                    setShowScreenConsent(true);
                  }
                }}
                className={`min-h-[40px] px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  isWatchingScreen
                    ? "bg-rose-600/90 border-rose-400/50 text-white hover:bg-rose-500"
                    : "bg-[#0B1224] border-blue-500/35 text-blue-200 hover:border-blue-400/60"
                }`}
              >
                {isWatchingScreen ? (
                  <>
                    <EyeOff className="w-4 h-4 shrink-0" />
                    <span>
                      {language === "or"
                        ? "ଦେଖିବା ବନ୍ଦ କରନ୍ତୁ"
                        : language === "hi"
                          ? "देखना बंद करें"
                          : "Stop Watching"}
                    </span>
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4 shrink-0" />
                    <span>
                      {language === "or"
                        ? "ସ୍କ୍ରିନ୍ ଦେଖିବା ଆରମ୍ଭ କରନ୍ତୁ"
                        : language === "hi"
                          ? "स्क्रीन देखना शुरू करें"
                          : "Start Watching"}
                    </span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleGenerateImageButton}
                disabled={isSendingText || isGeneratingImage}
                className={`min-h-[40px] px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  imageMode
                    ? "bg-blue-600/25 border-blue-400/60 text-blue-100"
                    : "bg-[#0B1224] border-slate-800 text-blue-300 hover:border-blue-500/40"
                }`}
              >
                <ImagePlus className="w-4 h-4 shrink-0" />
                <span>
                  {language === "or"
                    ? "ଛବି ତିଆରି କରନ୍ତୁ"
                    : language === "hi"
                      ? "तस्वीर बनाएं"
                      : "Generate Image"}
                </span>
              </button>
            </div>

            {imageMode && (
              <div className="flex items-center gap-1.5">
                {(["1:1", "16:9", "9:16"] as const).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setAspectRatio(ratio)}
                    className={`min-h-[34px] px-2.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      aspectRatio === ratio
                        ? "bg-blue-600 text-white"
                        : "bg-[#0B1224] text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-2"
          >
            {/* Spoken Voice Reply Toggle */}
            <button
              type="button"
              onClick={() => {
                if (autoSpeak) {
                  wavPlayerRef.current?.stop();
                  setSpeakingMessageId(null);
                  if (!isVoiceActiveRef.current) setOrbState("idle");
                }
                setAutoSpeak((v) => !v);
              }}
              aria-label={
                autoSpeak
                  ? "Disable spoken replies for text chat"
                  : "Enable spoken replies for text chat"
              }
              title={autoSpeak ? "Voice replies: On" : "Voice replies: Off"}
              className={`min-h-[48px] min-w-[44px] px-2.5 rounded-2xl border flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                autoSpeak
                  ? "bg-blue-600/15 border-blue-500/40 text-blue-300"
                  : "bg-[#0B1224] border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {autoSpeak ? (
                <Volume2 className="w-5 h-5" />
              ) : (
                <VolumeX className="w-5 h-5" />
              )}
            </button>

            {/* Text Chat Box */}
            <div
              className={`flex-1 min-w-0 flex items-end rounded-2xl bg-[#0B1224] border transition-colors px-3 py-1 ${
                imageMode
                  ? "border-blue-500/60"
                  : "border-slate-800 focus-within:border-blue-500/60"
              }`}
            >
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  imageMode
                    ? language === "or"
                      ? "କେଉଁ ଛବି ତିଆରି କରିବେ ଲେଖନ୍ତୁ..."
                      : language === "hi"
                        ? "कैसी तस्वीर बनवानी है, लिखें..."
                        : "Describe the image to generate..."
                    : isWatchingScreen
                      ? language === "or"
                        ? "ସ୍କ୍ରିନ୍ ବିଷୟରେ ପ୍ରଶ୍ନ ପଚାରନ୍ତୁ..."
                        : language === "hi"
                          ? "स्क्रीन के बारे में कोई सवाल पूछें..."
                          : "Ask about what is on your screen..."
                      : language === "or"
                        ? "SWATI AI କୁ ଓଡ଼ିଆ, ହିନ୍ଦୀ କିମ୍ବା ଇଂରାଜୀରେ ପଚାରନ୍ତୁ..."
                        : language === "hi"
                          ? "SWATI AI से कुछ पूछें या लिखें..."
                          : "Ask SWATI AI in Odia, Hindi, or English..."
                }
                aria-label="Message SWATI AI"
                className="w-full max-h-28 resize-none bg-transparent py-2.5 text-base text-slate-100 placeholder:text-slate-500 focus:outline-none leading-snug"
              />
            </div>

            {/* Send Text / Generate Button */}
            <button
              type="submit"
              disabled={!inputText.trim() || isSendingText || isGeneratingImage}
              aria-label={imageMode ? "Generate image" : "Send message"}
              className={`min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center transition-all shrink-0 ${
                inputText.trim() && !isSendingText && !isGeneratingImage
                  ? "bg-blue-600 hover:bg-blue-500 active:scale-95 text-white cursor-pointer"
                  : "bg-[#0B1224] border border-slate-800 text-slate-500 cursor-not-allowed"
              }`}
            >
              {imageMode ? (
                <ImagePlus className="w-5 h-5" />
              ) : (
                <SendHorizontal className="w-5 h-5" />
              )}
            </button>

            {/* Primary Thumb-Zone Voice Microphone Button */}
            <button
              type="button"
              onClick={handleToggleVoice}
              aria-label={
                isVoiceActive ? "Stop voice conversation" : "Start voice conversation"
              }
              className={`min-h-[48px] min-w-[52px] px-3 rounded-2xl flex items-center justify-center transition-all shrink-0 cursor-pointer ${
                isVoiceActive
                  ? "bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_24px_rgba(225,29,72,0.45)] active:scale-95"
                  : micPermission === "denied"
                    ? "bg-amber-500/20 border border-amber-400/40 text-amber-300 hover:bg-amber-500/30 active:scale-95"
                    : "bg-gradient-to-br from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 text-white shadow-[0_0_24px_rgba(37,99,235,0.45)] active:scale-95"
              }`}
            >
              {isVoiceActive ? (
                <Square className="w-5 h-5 fill-current" />
              ) : micPermission === "denied" ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </button>
          </form>
        </div>
      </footer>

      <ImagePreviewModal
        imageUrl={previewImage?.url ?? null}
        prompt={previewImage?.prompt}
        language={language}
        onDownload={handleDownloadImage}
        onClose={() => setPreviewImage(null)}
      />

      <PermissionSheet
        open={showPermissionSheet}
        permissionState={micPermission}
        errorMessage={micErrorDetail}
        language={language}
        onRetry={() => {
          setShowPermissionSheet(false);
          void startVoiceSession();
        }}
        onClose={() => setShowPermissionSheet(false)}
      />

      <ScreenWatchConsentSheet
        open={showScreenConsent}
        language={language}
        includeMic={includeMicOnWatch}
        onToggleIncludeMic={() => setIncludeMicOnWatch((v) => !v)}
        onConfirm={() => {
          setShowScreenConsent(false);
          void startScreenWatching();
        }}
        onCancel={() => setShowScreenConsent(false)}
      />

      <VoiceSettingsModal
        open={showSettings}
        voice={voice}
        autoSpeak={autoSpeak}
        language={language}
        hasMessages={messages.length > 0}
        onSelectVoice={(nextVoice) => {
          setVoice(nextVoice);
          if (isVoiceActiveRef.current) {
            stopVoiceSession();
          }
        }}
        onToggleAutoSpeak={() => setAutoSpeak((v) => !v)}
        onClearChat={() => {
          wavPlayerRef.current?.stop();
          setSpeakingMessageId(null);
          setMessages([]);
        }}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}
