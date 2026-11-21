// Живой «жидкий» фон: 6 крупных пятен (серебро, графит, белый, тень бирюзы и граната) плавают и перетекают.
// Canvas рисуется в низком разрешении (дёшево), CSS blur сливает пятна; поверх — анимированное зерно.
// Параллакс за курсором; prefers-reduced-motion — один статичный кадр.
import { useEffect, useRef } from "react";

type Blob = { c: number; x: number; y: number; r: number; ax: number; ay: number; fx: number; fy: number; ph: number; depth: number; a: number };

// c — индекс цвета --liq-1..6; x/y/r в долях экрана; ax/ay — амплитуда; fx/fy — частота; depth — сила параллакса
const BLOBS: Blob[] = [
  { c: 1, x: 0.18, y: 0.2, r: 0.55, ax: 0.12, ay: 0.1, fx: 0.11, fy: 0.09, ph: 0, depth: 0.6, a: 1 },
  { c: 3, x: 0.78, y: 0.28, r: 0.42, ax: 0.1, ay: 0.14, fx: 0.08, fy: 0.12, ph: 1.7, depth: 1, a: 0.85 },
  { c: 2, x: 0.5, y: 0.78, r: 0.6, ax: 0.16, ay: 0.08, fx: 0.07, fy: 0.1, ph: 3.1, depth: 0.4, a: 0.95 },
  { c: 4, x: 0.88, y: 0.85, r: 0.4, ax: 0.08, ay: 0.12, fx: 0.13, fy: 0.07, ph: 4.4, depth: 0.8, a: 0.9 },
  { c: 5, x: 0.3, y: 0.62, r: 0.28, ax: 0.14, ay: 0.12, fx: 0.09, fy: 0.13, ph: 2.2, depth: 1.3, a: 0.7 },
  { c: 6, x: 0.68, y: 0.12, r: 0.24, ax: 0.12, ay: 0.1, fx: 0.12, fy: 0.08, ph: 5.3, depth: 1.5, a: 0.55 },
];

const SCALE = 6; // во сколько раз canvas меньше экрана

// ускорение фона (финальный CTA лендинга): плавно тянется к цели
let boostTarget = 1;
export function setLiquidBoost(v: number) {
  boostTarget = v;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readColors() {
  const s = getComputedStyle(document.documentElement);
  const g = (n: string) => s.getPropertyValue(n).trim() || "#888888";
  return { base: g("--liq-base"), c: [1, 2, 3, 4, 5, 6].map((i) => hexToRgb(g(`--liq-${i}`))) };
}

export function LiquidBg({ speed = 1, grain = true, blur = 80 }: { speed?: number; grain?: boolean; blur?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d", { alpha: false })!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let colors = readColors();
    let w = 0;
    let h = 0;
    const resize = () => {
      w = Math.max(32, Math.round((window.innerWidth * 1.12) / SCALE));
      h = Math.max(32, Math.round((window.innerHeight * 1.12) / SCALE));
      cv.width = w;
      cv.height = h;
    };
    resize();

    const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      ptr.tx = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };

    let t = Math.random() * 100;
    let boost = 1;
    let last = performance.now();
    let raf = 0;

    const draw = () => {
      ctx.fillStyle = colors.base;
      ctx.fillRect(0, 0, w, h);
      const m = Math.max(w, h);
      for (const b of BLOBS) {
        const [r, g, bl] = colors.c[b.c - 1];
        const x = (b.x + b.ax * Math.sin(t * b.fx + b.ph) + ptr.x * 0.035 * b.depth) * w;
        const y = (b.y + b.ay * Math.cos(t * b.fy + b.ph * 0.7) + ptr.y * 0.035 * b.depth) * h;
        const rad = b.r * m * (1 + 0.08 * Math.sin(t * 0.21 + b.ph));
        const grd = ctx.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, `rgba(${r},${g},${bl},${b.a})`);
        grd.addColorStop(0.55, `rgba(${r},${g},${bl},${b.a * 0.45})`);
        grd.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      if (dt < 1 / 40) return; // ~30-40 fps хватает медленному фону
      last = now;
      boost += (boostTarget - boost) * 0.03;
      t += dt * speed * boost;
      ptr.x += (ptr.tx - ptr.x) * 0.04;
      ptr.y += (ptr.ty - ptr.y) * 0.04;
      draw();
    };

    draw();
    const mo = new MutationObserver(() => {
      colors = readColors();
      draw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("resize", resize);

    const onVis = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === "visible" && !reduce) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    if (!reduce) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("visibilitychange", onVis);
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [speed]);

  return (
    <div className="liquid" aria-hidden style={{ ["--liq-blur" as string]: `${blur}px` }}>
      <canvas ref={canvas} />
      {grain && <div className="grain" />}
    </div>
  );
}
