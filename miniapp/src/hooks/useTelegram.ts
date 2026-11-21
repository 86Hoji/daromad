// Нативные кнопки Telegram: BackButton на вложенных экранах, MainButton — главное подтверждение в листах.
import { useEffect, useRef } from "react";
import { tgBackButton, tgMainButton } from "../lib/telegram";

/** Показывает BackButton, пока компонент смонтирован и onBack задан. */
export function useTgBackButton(onBack: (() => void) | null) {
  const cb = useRef(onBack);
  cb.current = onBack;
  const active = onBack !== null;
  useEffect(() => {
    const b = tgBackButton();
    if (!b || !active) return;
    const handler = () => cb.current?.();
    b.onClick(handler);
    b.show();
    return () => {
      b.offClick(handler);
      b.hide();
    };
  }, [active]);
}

export interface MainButtonSpec {
  text: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

/** Есть ли нативная MainButton (то есть мы в Telegram). Тогда своя кнопка в листе не рисуется. */
export const hasMainButton = () => Boolean(tgMainButton());

export function useTgMainButton(spec: MainButtonSpec | null) {
  const cb = useRef(spec?.onClick);
  cb.current = spec?.onClick;
  const visible = spec !== null;
  useEffect(() => {
    const m = tgMainButton();
    if (!m || !visible) return;
    const handler = () => cb.current?.();
    m.onClick(handler);
    m.show();
    return () => {
      m.offClick(handler);
      m.hideProgress?.();
      m.hide();
    };
  }, [visible]);

  useEffect(() => {
    const m = tgMainButton();
    if (!m || !spec) return;
    const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#1c1d21";
    m.setParams ? m.setParams({ text: spec.text, color: brand, text_color: getComputedStyle(document.documentElement).getPropertyValue("--brand-ink").trim() || "#ffffff" }) : m.setText(spec.text);
    if (spec.loading) m.showProgress?.(false);
    else m.hideProgress?.();
    if (spec.disabled) m.disable?.();
    else m.enable?.();
  }, [spec?.text, spec?.loading, spec?.disabled, spec]);
}
