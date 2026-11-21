// Фон из медленно плывущих мягких пятен. Дешёвый: radial-gradient + transform, без filter: blur.
// prefers-reduced-motion скрывает его целиком (см. .ambient в index.css).
const BLOBS = {
  landing: [
    { c: "--blob-a", x: "-8%", y: "-12%", s: "62vmax", dur: "34s", dx: "8vw", dy: "6vh", o: 0.95 },
    { c: "--blob-b", x: "55%", y: "8%", s: "48vmax", dur: "26s", dx: "-7vw", dy: "9vh", o: 0.8 },
    { c: "--blob-c", x: "18%", y: "55%", s: "56vmax", dur: "40s", dx: "10vw", dy: "-6vh", o: 0.85 },
    { c: "--blob-b", x: "70%", y: "70%", s: "40vmax", dur: "22s", dx: "-5vw", dy: "-8vh", o: 0.6 },
  ],
  // /app — почти незаметно: меньше пятен, медленнее, бледнее
  app: [
    { c: "--blob-a", x: "-10%", y: "-15%", s: "60vmax", dur: "80s", dx: "4vw", dy: "3vh", o: 0.9 },
    { c: "--blob-b", x: "60%", y: "40%", s: "52vmax", dur: "95s", dx: "-4vw", dy: "4vh", o: 0.55 },
    { c: "--blob-c", x: "10%", y: "65%", s: "50vmax", dur: "110s", dx: "5vw", dy: "-3vh", o: 0.6 },
  ],
};

export function AmbientBg({ variant, grain = false }: { variant: keyof typeof BLOBS; grain?: boolean }) {
  return (
    <div className="ambient" aria-hidden>
      {BLOBS[variant].map((b, i) => (
        <span
          key={i}
          className="blob"
          style={
            {
              left: b.x,
              top: b.y,
              width: b.s,
              height: b.s,
              opacity: b.o,
              background: `radial-gradient(circle at center, var(${b.c}) 0%, transparent 68%)`,
              "--dur": b.dur,
              "--dx": b.dx,
              "--dy": b.dy,
            } as React.CSSProperties
          }
        />
      ))}
      {grain && <span className="grain" />}
    </div>
  );
}
