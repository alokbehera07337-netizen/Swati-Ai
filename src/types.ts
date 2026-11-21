export type LanguageMode = "auto" | "en" | "hi" | "or";

export type VoiceName = "Kore" | "Zephyr" | "Puck" | "Charon" | "Fenrir";

export type OrbState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type MicPermissionState =
  | "checking"
  | "prompt"
  | "granted"
  | "denied"
  | "unavailable";

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: number;
  source: "voice" | "text" | "image" | "screen";
  audioBase64?: string;
  imageDataUrl?: string;
  imagePrompt?: string;
}
