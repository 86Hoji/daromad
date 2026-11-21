// /pay/:token — страница оплаты долга для клиента. Без нижней навигации.
// Эндпоинты делает второй разработчик (backend/extras); при 404 — demo-режим.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, isNotFound, type PayInfo } from "../lib/api";
import { money } from "../lib/format";
import { haptic } from "../lib/telegram";
import { IconCheck, IconShield } from "../components/icons";
import { Badge, Button, Spinner } from "../components/ui";

const DEMO: PayInfo = { business_name: "Dilshod Biznes", person_name: "Alisher", amount: 450_000, demo: true };

function normalize(raw: Record<string, unknown>): PayInfo {
  const pick = (...keys: string[]) => keys.map((k) => raw[k]).find((v) => v !== undefined && v !== null);
  return {
    business_name: String(pick("business_name", "shop_name", "shop", "business") ?? "Biznes"),
    person_name: String(pick("person_name", "debtor", "name") ?? ""),
    amount: Number(pick("amount", "remaining", "sum") ?? 0),
    status: pick("status") as string | undefined,
  };
}

export function Pay() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [state, setState] = useState<"form" | "paying" | "done" | "error">("form");

  useEffect(() => {
    api
      .payInfo(token)
      .then((r) => {
        const i = normalize(r);
        setInfo(i);
        if (i.status === "paid") setState("done");
      })
      .catch((e) => {
        if (isNotFound(e)) setInfo(DEMO);
        else setState("error");
      });
  }, [token]);

  const pay = async () => {
    if (!info) return;
    setState("paying");
    try {
      if (!info.demo) await api.payConfirm(token);
      else await new Promise((r) => setTimeout(r, 900));
      haptic("success");
      setState("done");
    } catch (e) {
      if (isNotFound(e)) {
        setState("done");
      } else {
        haptic("error");
        setState("error");
      }
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-5 flex items-center justify-between px-1">
          <span className="text-[15px] font-bold tracking-tight">Daromad</span>
          <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
            <IconShield size={14} /> Xavfsiz to'lov
          </span>
        </div>

        <div className="card overflow-hidden">
          {!info && state !== "error" && (
            <div className="flex justify-center py-20 text-ink-3">
              <Spinner className="h-6 w-6" />
            </div>
          )}

          {state === "error" && (
            <div className="px-6 py-12 text-center">
              <div className="mb-1 text-[17px] font-semibold">To'lov havolasi ishlamayapti</div>
              <p className="text-[14px] text-ink-2">Havola eskirgan yoki noto'g'ri. Biznes egasidan yangisini so'rang.</p>
            </div>
          )}

          {info && state === "done" && (
            <div className="fade-enter px-6 py-12 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-pos-soft text-pos">
                <IconCheck size={32} />
              </div>
              <div className="text-[22px] font-bold tracking-tight">To'landi ✅</div>
              <p className="num mt-2 text-[15px] text-ink-2">
                {money(info.amount)} · {info.business_name}
              </p>
              <p className="mt-6 text-[13px] text-ink-3">Rahmat! Biznes egasiga xabar yuborildi.</p>
              {info.demo && (
                <div className="mt-4">
                  <Badge>demo</Badge>
                </div>
              )}
            </div>
          )}

          {info && (state === "form" || state === "paying") && (
            <>
              <div className="border-b border-line px-6 pt-6 pb-5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-ink-3">Qabul qiluvchi</span>
                  {info.demo && <Badge>demo</Badge>}
                </div>
                <div className="mt-1 text-[18px] font-semibold">{info.business_name}</div>
              </div>
              <div className="px-6 py-6">
                <div className="text-[13px] text-ink-3">To'lov summasi</div>
                <div className="num mt-1 text-[40px] font-bold leading-tight tracking-[-0.03em]">{money(info.amount)}</div>
                <div className="mt-5 rounded-2xl bg-surface-2 px-4">
                  <div className="flex justify-between border-b border-line py-3 text-[14px]">
                    <span className="text-ink-2">To'lovchi</span>
                    <span className="font-medium">{info.person_name}</span>
                  </div>
                  <div className="flex justify-between border-b border-line py-3 text-[14px]">
                    <span className="text-ink-2">Maqsad</span>
                    <span className="font-medium">Qarzni qaytarish</span>
                  </div>
                  <div className="flex justify-between py-3 text-[14px]">
                    <span className="text-ink-2">Komissiya</span>
                    <span className="num font-medium">0 so'm</span>
                  </div>
                </div>
                <Button className="mt-6 h-14 w-full text-[16px]" onClick={pay} loading={state === "paying"}>
                  To'lash · {money(info.amount)}
                </Button>
              </div>
            </>
          )}
        </div>
        <p className="mt-4 text-center text-[12px] text-ink-3">To'lov tasdiqlangach, qarz avtomatik yopiladi.</p>
      </div>
    </div>
  );
}
