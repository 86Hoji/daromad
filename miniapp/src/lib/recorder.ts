// Запись голоса: MediaRecorder (webm/ogg/mp4 — что умеет браузер) -> WAV 16 кГц моно.
// Gemini надёжно принимает WAV, а контейнеры браузеров у всех разные.

export function micSupported(): boolean {
  // в небезопасном контексте (http не localhost) и в части WebView mediaDevices отсутствует
  return typeof navigator.mediaDevices?.getUserMedia === "function" && typeof window.MediaRecorder !== "undefined";
}

export interface Recording {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

/** onLevel(0..1) ~30 раз в секунду — громкость для живой волны на кнопке микрофона. */
export async function startRecording(onLevel?: (level: number) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
  const rec = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();

  let meterCtx: AudioContext | null = null;
  let raf = 0;
  if (onLevel) {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      meterCtx = new Ctx();
      const analyser = meterCtx.createAnalyser();
      analyser.fftSize = 512;
      meterCtx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (t: number) => {
        if (t - last > 33) {
          last = t;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      /* без индикатора громкости запись всё равно идёт */
    }
  }

  const release = () => {
    cancelAnimationFrame(raf);
    meterCtx?.close().catch(() => undefined);
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        rec.onstop = async () => {
          release();
          try {
            const raw = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
            resolve(await toWav(raw));
          } catch (e) {
            reject(e);
          }
        };
        rec.stop();
      }),
    cancel: () => {
      rec.onstop = null;
      if (rec.state !== "inactive") rec.stop();
      release();
    },
  };
}

const TARGET_RATE = 16_000;

async function toWav(blob: Blob): Promise<Blob> {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const decoded = await ctx.decodeAudioData(buf.slice(0));
  await ctx.close();

  const length = Math.ceil(decoded.duration * TARGET_RATE);
  const offline = new OfflineAudioContext(1, Math.max(1, length), TARGET_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), TARGET_RATE);
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
