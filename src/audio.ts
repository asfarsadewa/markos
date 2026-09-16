import { assetUrl } from "./assets.ts";
export class Sound {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  musicGain: GainNode | null = null;
  engineGain: GainNode | null = null;
  muted = false;
  musicVolume = 0.45;
  buffers = new Map<string, AudioBuffer>();
  musicStarted = false;
  pending = new Map<string, { gain: number; rate: number; time: number }>();
  voice: AudioBufferSourceNode | null = null;
  private voiceName: string | null = null;
  private encoded = new Map<string, ArrayBuffer>();
  private preparing: Promise<void> | null = null;
  private unlocking: Promise<boolean> | null = null;
  private loops = new Map<string, AudioBufferSourceNode>();
  private readonly names = [
    "skyward",
    "engine",
    "transformation",
    "laser",
    "explosion",
    "launch",
    "transform",
    "contact",
    "complete",
  ];

  /** Fetch before entry, without creating an audio context or playing anything. */
  prepare(onProgress: () => void = () => {}) {
    if (this.preparing) return this.preparing;
    this.preparing = Promise.all(
      this.names.map(async (name) => {
        if (this.encoded.has(name) || this.buffers.has(name)) return;
        try {
          const extension = [
            "launch",
            "transform",
            "contact",
            "complete",
          ].includes(name)
            ? "wav"
            : "mp3";
          const response = await fetch(
            assetUrl(`/audio/${name}.${extension}`),
            {
              signal: AbortSignal.timeout(30000),
            },
          );
          if (!response.ok) throw new Error("Unavailable");
          this.encoded.set(name, await response.arrayBuffer());
        } catch {
          console.warn(`Audio unavailable: ${name}`);
        } finally {
          onProgress();
        }
      }),
    )
      .then(() => {})
      .finally(() => {
        this.preparing = null;
      });
    return this.preparing;
  }

  unlock(): Promise<boolean> {
    if (!this.unlocking)
      this.unlocking = this.activate().finally(() => {
        this.unlocking = null;
      });
    return this.unlocking;
  }

  private async activate() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        this.master.connect(this.context.destination);
        this.musicGain = this.context.createGain();
        this.musicGain.gain.value = 0;
        this.musicGain.connect(this.master);
        this.engineGain = this.context.createGain();
        this.engineGain.gain.value = 0;
        this.engineGain.connect(this.master);
      }
      // Called synchronously from the entry gesture, before fetching or decoding.
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.context.resume(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Audio needs another gesture")),
              4000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      if (this.context.state !== "running") return false;
      await this.prepare();
      await Promise.all(
        this.names.map(async (name) => {
          if (this.buffers.has(name)) return;
          try {
            const bytes = this.encoded.get(name);
            if (!bytes) return;
            this.buffers.set(
              name,
              await this.context!.decodeAudioData(bytes.slice(0)),
            );
            this.encoded.delete(name);
            const waiting = this.pending.get(name);
            if (waiting) {
              this.pending.delete(name);
              if (performance.now() - waiting.time < 8000)
                this.play(name, waiting.gain, waiting.rate);
            }
          } catch {
            this.encoded.delete(name);
            console.warn(`Audio unavailable: ${name}`);
          }
        }),
      );
      if (!this.buffers.has("skyward")) return false;
      this.loop("skyward");
      this.loop("engine");
      this.musicStarted = true;
      this.music(this.musicVolume);
      return true;
    } catch {
      return false;
    }
  }
  loop(name: string) {
    const b = this.buffers.get(name);
    if (!b || !this.context || this.loops.has(name)) return;
    const s = this.context.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.connect(name === "skyward" ? this.musicGain! : this.engineGain!);
    s.start();
    this.loops.set(name, s);
  }
  play(name: string, gain = 0.6, rate = 1) {
    const b = this.buffers.get(name);
    if (!b || !this.context || !this.master) {
      this.pending.set(name, { gain, rate, time: performance.now() });
      return;
    }
    const s = this.context.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    if (["launch", "transform", "contact", "complete"].includes(name)) {
      try {
        this.voice?.stop();
      } catch {}
      this.voice = s;
      this.voiceName = name;
    }
    const g = this.context.createGain();
    g.gain.value = gain;
    s.connect(g);
    g.connect(this.master);
    s.onended = () => {
      if (this.voice === s) {
        this.voice = null;
        this.voiceName = null;
      }
      s.disconnect();
      g.disconnect();
    };
    s.start();
  }
  cancel(name: string) {
    this.pending.delete(name);
    if (this.voiceName !== name) return;
    try {
      this.voice?.stop();
    } catch {}
    this.voice = null;
    this.voiceName = null;
  }
  toggle() {
    this.muted = !this.muted;
    if (this.master)
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : 0.7,
        this.context!.currentTime,
        0.04,
      );
    return this.muted;
  }
  music(value: number) {
    this.musicVolume = value;
    if (this.musicGain)
      this.musicGain.gain.setTargetAtTime(
        value * 0.35,
        this.context!.currentTime,
        0.1,
      );
  }
  engine(speed: number, paused: boolean) {
    if (this.engineGain)
      this.engineGain.gain.setTargetAtTime(
        paused ? 0 : 0.025 + speed * 0.00045,
        this.context!.currentTime,
        0.1,
      );
  }
}
