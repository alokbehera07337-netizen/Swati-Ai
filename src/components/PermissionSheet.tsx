import { MicOff, RefreshCw, ShieldAlert, X } from "lucide-react";
import type { LanguageMode, MicPermissionState } from "../types";

interface PermissionSheetProps {
  open: boolean;
  permissionState: MicPermissionState;
  errorMessage: string | null;
  language: LanguageMode;
  onRetry: () => void;
  onClose: () => void;
}

export function PermissionSheet({
  open,
  permissionState,
  errorMessage,
  language,
  onRetry,
  onClose,
}: PermissionSheetProps) {
  if (!open) return null;

  const isHindi = language === "hi";
  const isOdia = language === "or";
  const isDenied = permissionState === "denied";
  const isUnavailable = permissionState === "unavailable";

  const title = isUnavailable
    ? isOdia
      ? "ମାଇକ୍ରୋଫୋନ୍ ଉପଲବ୍ଧ ନାହିଁ"
      : isHindi
        ? "माइक्रोफ़ोन उपलब्ध नहीं है"
        : "Microphone Unavailable"
    : isDenied
      ? isOdia
        ? "ମାଇକ୍ରୋଫୋନ୍ ଅନୁମତି ବନ୍ଦ ଅଛି"
        : isHindi
          ? "माइक्रोफ़ोन की अनुमति बंद है"
          : "Microphone Access Blocked"
      : isOdia
        ? "ମାଇକ୍ରୋଫୋନ୍ ଅନୁମତି ଆବଶ୍ୟକ"
        : isHindi
          ? "माइक्रोफ़ोन की अनुमति आवश्यक है"
          : "Microphone Access Needed";

  const subtitle =
    errorMessage ||
    (isUnavailable
      ? isOdia
        ? "ଏହି ଡିଭାଇସ୍ କିମ୍ବା ବ୍ରାଉଜର୍‌ରେ ମାଇକ୍ରୋଫୋନ୍ ମିଳିଲା ନାହିଁ। ଆପଣ ତଳେ ଟେକ୍ସଟ୍ ଚାଟ୍ ଦ୍ୱାରା SWATI AI ସହ କଥା ହୋଇପାରିବେ।"
        : isHindi
          ? "इस डिवाइस या ब्राउज़र में माइक्रोफ़ोन नहीं मिला। आप नीचे टेक्स्ट चैट से SWATI AI से बात कर सकते हैं।"
          : "No microphone was detected on this device or browser. You can still chat with SWATI AI using the text box below."
      : isOdia
        ? "SWATI AI ସହ ଓଡ଼ିଆ, ହିନ୍ଦୀ କିମ୍ବା ଇଂରାଜୀରେ କଥା ହେବା ପାଇଁ ମାଇକ୍ରୋଫୋନ୍ ଅନୁମତି ଦିଅନ୍ତୁ।"
        : isHindi
          ? "SWATI AI से हिंदी या अंग्रेज़ी में वॉइस बात करने के लिए माइक्रोफ़ोन की अनुमति दें।"
          : "Allow microphone access so SWATI AI can hear your voice in Odia, Hindi, or English.");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mic-permission-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[#0B1224] border border-blue-500/20 p-5 pb-safe shadow-2xl">
        <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-4 sm:hidden" />

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-400/25 flex items-center justify-center text-amber-300 shrink-0">
              {isDenied || isUnavailable ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <ShieldAlert className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2
                id="mic-permission-title"
                className="text-base font-semibold text-slate-100"
              >
                {title}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isOdia
                  ? "Android ଏବଂ ବ୍ରାଉଜର୍ ଅନୁମତି"
                  : isHindi
                    ? "Android / ब्राउज़र अनुमति"
                    : "Android & Browser Permission"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close permission dialog"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-300">
          {subtitle}
        </p>

        {isDenied && (
          <div className="mt-4 rounded-xl bg-[#070C1A] border border-slate-800 p-3.5 text-xs text-slate-300 space-y-2">
            <p className="font-semibold text-blue-300">
              {isOdia
                ? "Android Chrome ରେ ଅନୁମତି କିପରି ଚାଲୁ କରିବେ:"
                : isHindi
                  ? "Android Chrome में अनुमति कैसे चालू करें:"
                  : "How to enable on Android Chrome:"}
            </p>
            <ol className="list-decimal list-inside space-y-1 text-slate-400 leading-relaxed">
              <li>
                {isOdia
                  ? "ଏଡ୍ରେସ୍ ବାର୍ ପାଖରେ ଥିବା ଲକ୍ କିମ୍ବା ଟ୍ୟୁନ୍ ଆଇକନ୍ ଉପରେ ଟ୍ୟାପ୍ କରନ୍ତୁ।"
                  : isHindi
                    ? "एड्रेस बार के बाईं ओर ट्यून या लॉक आइकन पर टैप करें।"
                    : "Tap the tune or lock icon next to the address bar."}
              </li>
              <li>
                {isOdia
                  ? "Permissions ଖୋଲନ୍ତୁ ଏବଂ Microphone କୁ Allow କରନ୍ତୁ।"
                  : isHindi
                    ? "Permissions (अनुमतियां) खोलें और Microphone चालू करें।"
                    : "Open Permissions and switch Microphone to Allow."}
              </li>
              <li>
                {isOdia
                  ? "ତଳେ 'ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ' ବଟନ୍ ଦବାନ୍ତୁ।"
                  : isHindi
                    ? "नीचे 'दोबारा प्रयास करें' बटन दबाएं।"
                    : "Tap Retry Microphone below."}
              </li>
            </ol>
          </div>
        )}

        <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
          {!isUnavailable && (
            <button
              type="button"
              onClick={onRetry}
              className="flex-1 min-h-[46px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>
                {isOdia
                  ? "ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ"
                  : isHindi
                    ? "दोबारा प्रयास करें"
                    : "Retry Microphone"}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-800 text-slate-200 text-sm font-medium transition-colors cursor-pointer"
          >
            {isOdia
              ? "ଟେକ୍ସଟ୍ ଚାଟ୍ ବ୍ୟବହାର କରନ୍ତୁ"
              : isHindi
                ? "टेक्स्ट चैट उपयोग करें"
                : "Use Text Chat Instead"}
          </button>
        </div>
      </div>
    </div>
  );
}
