import { Eye, Mic, ShieldCheck, X } from "lucide-react";
import type { LanguageMode } from "../types";

interface ScreenWatchConsentSheetProps {
  open: boolean;
  language: LanguageMode;
  includeMic: boolean;
  onToggleIncludeMic: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ScreenWatchConsentSheet({
  open,
  language,
  includeMic,
  onToggleIncludeMic,
  onConfirm,
  onCancel,
}: ScreenWatchConsentSheetProps) {
  if (!open) return null;

  const isHi = language === "hi";
  const isOr = language === "or";

  const title = isOr
    ? "ଲାଇଭ୍ ସ୍କ୍ରିନ୍ ଦେଖିବା ଅନୁମତି"
    : isHi
      ? "लाइव स्क्रीन देखने की अनुमति"
      : "Live Screen Sharing Permission";

  const subtitle = isOr
    ? "ଆପଣଙ୍କ ସ୍ପଷ୍ଟ ଅନୁମତି ପରେ SWATI AI Android MediaProjection / ସ୍କ୍ରିନ୍ ସେୟାରିଂ ମାଧ୍ୟମରେ ସ୍କ୍ରିନ୍ ଦେଖିବ।"
    : isHi
      ? "आपकी स्पष्ट अनुमति के बाद ही SWATI AI Android MediaProjection / स्क्रीन शेयरिंग से स्क्रीन देखेगी।"
      : "SWATI AI only views your screen after you approve Android MediaProjection / screen sharing.";

  const bullets = isOr
    ? [
        "ପ୍ରତି ୨–୩ ସେକେଣ୍ଡରେ କେବଳ ଅସ୍ଥାୟୀ ସ୍ନାପ୍‌ସଟ୍ ବିଶ୍ଳେଷଣ ହୁଏ — କୌଣସି ସ୍କ୍ରିନ୍ ରେକର୍ଡିଂ କିମ୍ବା ଭିଡିଓ ସେଭ୍ ହୁଏ ନାହିଁ।",
        "ସ୍କ୍ରିନ୍ ସେୟାରିଂ ଚାଲୁଥିବା ସମୟରେ ସବୁବେଳେ ଏକ ସ୍ପଷ୍ଟ ପ୍ରାଇଭେସି ସୂଚକ ଏବଂ Stop Watching ବଟନ୍ ଦେଖାଯିବ।",
        "ଆପଣ ଓଡ଼ିଆ, ହିନ୍ଦୀ କିମ୍ବା ଇଂରାଜୀରେ ସ୍କ୍ରିନ୍ ବିଷୟରେ ପ୍ରଶ୍ନ ପଚାରିପାରିବେ।",
      ]
    : isHi
      ? [
          "हर 2–3 सेकंड में केवल अस्थायी स्क्रीन स्नैपशॉट का विश्लेषण होता है — कोई स्क्रीन रिकॉर्डिंग या वीडियो सेव नहीं किया जाता।",
          "स्क्रीन शेयरिंग चालू रहने पर हमेशा एक स्पष्ट प्राइवेसी इंडिकेटर और Stop Watching बटन दिखाई देगा।",
          "आप स्क्रीन पर दिख रही चीज़ों के बारे में उड़िया, हिंदी या अंग्रेज़ी में पूछ सकते हैं।",
        ]
      : [
          "Only transient snapshots (~2.5s intervals) are analyzed in real time — nothing is recorded or saved.",
          "A clear Screen Sharing Active privacy indicator and Stop Watching button stay visible at all times.",
          "Ask questions about your visible screen in Odia, Hindi, or English.",
        ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="screen-watch-consent-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[#0B1224] border border-blue-500/25 p-5 pb-safe shadow-2xl">
        <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-4 sm:hidden" />

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-600/20 border border-blue-400/30 flex items-center justify-center text-blue-300 shrink-0">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="screen-watch-consent-title"
                className="text-base font-semibold text-slate-100"
              >
                {title}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isOr
                  ? "Android MediaProjection · ପ୍ରାଇଭେସି ପ୍ରଥମେ"
                  : isHi
                    ? "Android MediaProjection · गोपनीयता सुरक्षा"
                    : "Android MediaProjection · Privacy First"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            aria-label="Close consent dialog"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="mt-3.5 text-sm leading-relaxed text-slate-300">
          {subtitle}
        </p>

        <ul className="mt-3.5 rounded-xl bg-[#070C1A] border border-slate-800 p-3.5 space-y-2 text-xs text-slate-300 leading-relaxed">
          {bullets.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="mt-3.5 flex items-center justify-between gap-3 rounded-xl bg-[#070C1A] border border-slate-800 px-3.5 py-2.5">
          <div className="flex items-center gap-2.5">
            <Mic className="w-4 h-4 text-blue-400 shrink-0" />
            <div>
              <p className="text-xs font-medium text-slate-200">
                {isOr
                  ? "କଥାବାର୍ତ୍ତା ପାଇଁ ମାଇକ୍ରୋଫୋନ୍ ଚାଲୁ ରଖନ୍ତୁ"
                  : isHi
                    ? "बोलकर पूछने के लिए माइक्रोफ़ोन चालू रखें"
                    : "Enable microphone for spoken questions"}
              </p>
              <p className="text-[11px] text-slate-400">
                {isOr
                  ? "ଆପଣ ପରେ ମଧ୍ୟ ମାଇକ୍ ମ୍ୟୁଟ୍/ଅନମ୍ୟୁଟ୍ କରିପାରିବେ"
                  : isHi
                    ? "आप कभी भी माइक्रोफ़ोन म्यूट या अनम्यूट कर सकते हैं"
                    : "You can mute or unmute anytime while watching"}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={includeMic}
            onClick={onToggleIncludeMic}
            className={`min-h-[36px] min-w-[52px] px-1 flex items-center rounded-full transition-colors cursor-pointer shrink-0 ${
              includeMic ? "bg-blue-600 justify-end" : "bg-slate-700 justify-start"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white shadow-sm block" />
          </button>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Eye className="w-4 h-4" />
            <span>
              {isOr
                ? "ଅନୁମତି ଦିଅନ୍ତୁ ଓ ଦେଖିବା ଆରମ୍ଭ କରନ୍ତୁ"
                : isHi
                  ? "अनुमति दें और देखना शुरू करें"
                  : "Allow & Start Watching"}
            </span>
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="sm:w-32 min-h-[48px] px-4 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-800 text-slate-200 text-sm font-medium transition-colors cursor-pointer"
          >
            {isOr ? "ବାତିଲ୍" : isHi ? "रद्द करें" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
