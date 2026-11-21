// Моушн-утилиты: spotlight на стекле, магнитные кнопки, плавный скролл Lenis.
import Lenis from "lenis";
import { useEffect, type RefObject } from "react";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = () => window.matchMedia("(pointer: fine)").matches;

/**
 * Spotlight: одна делегированная подписка на документ. Световое пятно следует за курсором
 * по любой панели .glass (CSS-переменные --mx/--my/--spot-o читают ::before и ::after).
 */
export function useSpotlight() {
  useEffect(() => {
    if (reduced() || !finePointer()) return;
    let current: HTMLElement | null = null;
    let raf = 0;
    let ev: PointerEvent | null = null;
    const apply = () => {
      raf = 0;
      if (!ev) return;
      const el = (ev.target as Element | null)?.closest?.(".glass") as HTMLElement | null;
      if (current && current !== el) current.style.setProperty("--spot-o", "0");
      current = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${ev.clientX - r.left}px`);
      el.style.setProperty("--my", `${ev.clientY - r.top}px`);
      el.style.setProperty("--spot-o", "1");
    };
    const onMove = (e: PointerEvent) => {
      ev = e;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => current?.style.setProperty("--spot-o", "0");
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);
}

/** Магнит: элемент тянется к курсору (свойство translate; пружинный возврат — transition в .btn-fx). */
export function useMagnet(ref: RefObject<HTMLElement | null>, enabled = true, strength = 0.28, max = 12) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || reduced() || !finePointer()) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const cl = (v: number) => Math.max(-max, Math.min(max, v * strength));
      el.style.transitionDuration = "0.15s, 0.35s, 0.2s";
      el.style.translate = `${cl(dx)}px ${cl(dy)}px`;
    };
    const onLeave = () => {
      el.style.transitionDuration = "";
      el.style.translate = "0px 0px";
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [ref, enabled, strength, max]);
}

/** Плавный скролл (лендинг и /app). Отключён при prefers-reduced-motion и на тач-устройствах. */
export function useLenis() {
  useEffect(() => {
    if (reduced() || !finePointer()) return;
    const lenis = new Lenis({ autoRaf: true, lerp: 0.11, wheelMultiplier: 1 });
    return () => lenis.destroy();
  }, []);
}
