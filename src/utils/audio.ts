export function resampleFloat32(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    return input;
  }
  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, input.length - 1);
    const frac = srcIndex - low;
    result[i] = input[low] * (1 - frac) + input[high] * frac;
  }
  return result;
}

export function float32ToPcm16Base64(float32: Float32Array): string {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function pcm16Base64ToFloat32(
  base64: string
): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const byteLength = binary.length;
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const sampleCount = Math.floor(byteLength / 2);
  const float32 = new Float32Array(new ArrayBuffer(sampleCount * 4));
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(i * 2, true);
    float32[i] = int16 / 32768;
  }
  return float32;
}

export function computeRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, rms * 3.5);
}

export class GaplessPcmPlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private nextStartTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private onSpeakingChange?: (isSpeaking: boolean) => void;

  constructor(onSpeakingChange?: (isSpeaking: boolean) => void) {
    this.onSpeakingChange = onSpeakingChange;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext({ sampleRate: 24000 });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.75;
      this.analyser.connect(this.ctx.destination);
      this.freqData = new Uint8Array(
        new ArrayBuffer(this.analyser.frequencyBinCount)
      );
      this.nextStartTime = this.ctx.currentTime;
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public unlock(): void {
    this.ensureContext();
  }

  public enqueuePcm16Base64(base64: string): void {
    const ctx = this.ensureContext();
    const float32 = pcm16Base64ToFloat32(base64);
    if (float32.length === 0) return;

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    if (this.analyser) {
      source.connect(this.analyser);
    } else {
      source.connect(ctx.destination);
    }

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.015, this.nextStartTime);
    this.nextStartTime = startAt + audioBuffer.duration;

    if (this.activeSources.size === 0) {
      this.onSpeakingChange?.(true);
    }

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      if (this.activeSources.size === 0) {
        this.onSpeakingChange?.(false);
      }
    };

    source.start(startAt);
  }

  public interrupt(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Already stopped
      }
    }
    this.activeSources.clear();
    if (this.ctx) {
      this.nextStartTime = this.ctx.currentTime;
    }
    this.onSpeakingChange?.(false);
  }

  public getOutputLevel(): number {
    if (!this.analyser || !this.freqData || this.activeSources.size === 0) {
      return 0;
    }
    this.analyser.getByteFrequencyData(this.freqData);
    let total = 0;
    const bins = Math.min(24, this.freqData.length);
    for (let i = 0; i < bins; i++) {
      total += this.freqData[i];
    }
    return Math.min(1, total / (bins * 170));
  }

  public dispose(): void {
    this.interrupt();
    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.close();
    }
    this.ctx = null;
    this.analyser = null;
    this.freqData = null;
  }
}

export class WavSpeechPlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private isPlaying = false;

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.75;
      this.analyser.connect(this.ctx.destination);
      this.freqData = new Uint8Array(
        new ArrayBuffer(this.analyser.frequencyBinCount)
      );
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public async playWavBase64(
    base64: string,
    onStart?: () => void,
    onEnd?: () => void
  ): Promise<void> {
    this.stop();
    const ctx = this.ensureContext();
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    if (this.analyser) {
      source.connect(this.analyser);
    } else {
      source.connect(ctx.destination);
    }
    this.currentSource = source;
    this.isPlaying = true;
    onStart?.();

    await new Promise<void>((resolve) => {
      source.onended = () => {
        if (this.currentSource === source) {
          this.currentSource = null;
          this.isPlaying = false;
        }
        onEnd?.();
        resolve();
      };
      source.start(0);
    });
  }

  public stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // Already stopped
      }
      this.currentSource = null;
    }
    this.isPlaying = false;
  }

  public getOutputLevel(): number {
    if (!this.analyser || !this.freqData || !this.isPlaying) {
      return 0;
    }
    this.analyser.getByteFrequencyData(this.freqData);
    let total = 0;
    const bins = Math.min(24, this.freqData.length);
    for (let i = 0; i < bins; i++) {
      total += this.freqData[i];
    }
    return Math.min(1, total / (bins * 170));
  }

  public dispose(): void {
    this.stop();
    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.close();
    }
    this.ctx = null;
    this.analyser = null;
    this.freqData = null;
  }
}
