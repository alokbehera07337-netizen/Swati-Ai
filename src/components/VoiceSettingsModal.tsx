import { Trash2, Volume2, X } from "lucide-react";
import type { LanguageMode, VoiceName } from "../types";

interface VoiceSettingsModalProps {
  open: boolean;
  voice: VoiceName;
  autoSpeak: boolean;
  language: LanguageMode;
  hasMessages: boolean;
  onSelectVoice: (voice: VoiceName) => void;
  onToggleAutoSpeak: () => void;
  onClearChat: () => void;
  onClose: () => void;
}

const VOICES: Array<{ id: VoiceName; label: string; desc: string }> = [
  { id: "Kore", label: "Kore", desc: "Warm & balanced" },
  { id: "Zephyr", label: "Zephyr", desc: "Bright & natural" },
  { id: "Puck", label: "Puck", desc: "Expressive & lively" },
  { id: "Charon", label: "Charon", desc: "Calm & deep" },
  { id: "Fenrir", label: "Fenrir", desc: "Clear & steady" },
];

export function VoiceSettingsModal({
  open,
  voice,
  autoSpeak,
  language,
  hasMessages,
  onSelectVoice,
  onToggleAutoSpeak,
  onClearChat,
  onClose,
}: VoiceSettingsModalProps) {
  if (!open) return null;

  const isHindi = language === "hi";
  const isOdia = language === "or";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-settings-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[#0B1224] border border-blue-500/20 p-5 pb-safe shadow-2xl">
        <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-4 sm:hidden" />

        <div className="flex items-center justify-between gap-3">
          <h2
            id="voice-settings-title"
            className="text-base font-semibold text-slate-100"
          >
            {isOdia
              ? "ଭଏସ୍ ଏବଂ ଉତ୍ତର ସେଟିଂସ୍"
              : isHindi
                ? "वॉइस और उत्तर सेटिंग्स"
                : "Voice & Reply Settings"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-5">
          <div>
            <p className="text-xs font-medium text-slate-400 mb-2.5">
              {isOdia
                ? "SWATI AI ର ସ୍ୱର ବାଛନ୍ତୁ"
                : isHindi
                  ? "SWATI AI की आवाज़ चुनें"
                  : "SWATI AI Voice Persona"}
            </p>
            <div className="grid grid-cols-1 gap-2">
              {VOICES.map((item) => {
                const selected = item.id === voice;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectVoice(item.id)}
                    className={`min-h-[46px] px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between transition-colors cursor-pointer ${
                      selected
                        ? "bg-blue-600/20 border-blue-500/60 text-blue-100"
                        : "bg-[#070C1A] border-slate-800 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="text-xs text-slate-400">{item.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <div className="flex items-center gap-2.5">
              <Volume2 className="w-4 h-4 text-blue-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-200">
                  {isOdia
                    ? "ଟେକ୍ସଟ୍ ଚାଟ୍‌ରେ ଭଏସ୍ ଉତ୍ତର"
                    : isHindi
                      ? "टेक्स्ट चैट में बोलकर उत्तर दें"
                      : "Spoken replies for text chat"}
                </p>
                <p className="text-xs text-slate-400">
                  {isOdia
                    ? "ଟାଇପ୍ କରାଯାଇଥିବା ଉତ୍ତରକୁ ସ୍ୱୟଂଚାଳିତ ଭାବେ ଶୁଣନ୍ତୁ"
                    : isHindi
                      ? "टेक्स्ट संदेशों के बाद SWATI AI जवाब पढ़कर सुनाएगी"
                      : "Automatically read typed answers aloud"}
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoSpeak}
              onClick={onToggleAutoSpeak}
              className={`min-h-[44px] min-w-[56px] px-1 flex items-center rounded-full transition-colors cursor-pointer ${
                autoSpeak ? "bg-blue-600 justify-end" : "bg-slate-700 justify-start"
              }`}
            >
              <span className="w-6 h-6 rounded-full bg-white shadow-sm block" />
            </button>
          </div>

          {hasMessages && (
            <button
              type="button"
              onClick={() => {
                onClearChat();
                onClose();
              }}
              className="w-full min-h-[46px] px-4 py-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/15 text-rose-200 text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>
                {isOdia
                  ? "ଚାଟ୍ ଇତିହାସ ସଫା କରନ୍ତୁ"
                  : isHindi
                    ? "चैट इतिहास साफ़ करें"
                    : "Clear Conversation"}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
