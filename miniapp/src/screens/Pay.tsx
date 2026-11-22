// /pay/:token — страница оплаты долга для клиента (ссылка из SMS). Без навигации.
// API: backend/extras/payments.py. /pay/demo и бэкенд без extras (404 без кода) — demo-режим.
import { Check, LockKeyhole } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, errorCode, isMissingEndpoint, type PayInfo } from "../lib/api";
import { money } from "../lib/format";
import { haptic } from "../lib/telegram";
import { Button } from "../ui/Button";
import { Chip, Logo, Skeleton } from "../ui/bits";
import { LangSwitch, t } from "../lib/i18n";

const DEMO: PayInfo = { business_name: "Alisher Savdo", person_name: "Jamshid", amount: 450_000, demo: true };

function normalize(raw: Record<string, unknown>): PayInfo {
  const get = (...keys: string[]) => keys.map((k) => raw[k]).find((v) => v !== undefined && v !== null);
  return {
    business_name: String(get("business_name", "shop_name", "shop", "business") ?? "Biznes"),
    person_name: String(get("person_name", "debtor", "name") ?? ""),
    amount: Number(get("amount", "remaining", "sum") ?? 0),
    status: get("status") as string | undefined,
  };
}

const ERRORS: Record<string, [string, string]> = {
  token_expired: ["Havola muddati o'tgan", "To'lov havolasi 7 kun amal qiladi. Biznes egasidan yangisini so'rang."],
  debt_closed: ["Qarz allaqachon yopilgan", "Bu qarz bo'yicha to'lov kerak emas. Rahmat!"],
  not_found: ["Havola topilmadi", "Havola noto'g'ri yoki hali faollashmagan. Biznes egasidan yangisini so'rang."],
  default: ["To'lov havolasi ishlamayapti", "Birozdan keyin qayta urinib ko'ring yoki biznes egasiga murojaat qiling."],
};

export function Pay() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [state, setState] = useState<"form" | "paying" | "done" | "error">("form");
  const [code, setCode] = useState<string | undefined>();

  useEffect(() => {
    if (token === "demo") {
      setInfo(DEMO);
      return;
    }
    api
      .payInfo(token)
      .then((r) => {
        const i = normalize(r);
        setInfo(i);
        if (i.status === "paid") setState("done");
        else if (i.status === "closed") {
          setCode("debt_closed");
          setState("error");
        }
      })
      .catch((e) => {
        if (isMissingEndpoint(e)) setInfo(DEMO);
        else {
          setCode(errorCode(e));
          setState("error");
        }
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
      haptic("error");
      setCode(errorCode(e));
      setState("error");
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center justify-between px-1">
          <Logo size={26} />
          <span className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-[13px] text-ink-3 min-[380px]:flex">
              <LockKeyhole size={14} strokeWidth={1.75} /> {t("Xavfsiz to'lov")}
            </span>
            <LangSwitch compact />
          </span>
        </div>

        <div className="panel overflow-hidden">
          {!info && state !== "error" && (
            <div className="space-y-4 p-6">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-12 w-56" />
              <Skeleton className="h-32" />
            </div>
          )}

          {state === "error" && (
            <div className="px-6 py-12 text-center">
              <div className="mb-1 text-[18px] font-semibold">{t(ERRORS[code ?? ""]?.[0] ?? ERRORS.default[0])}</div>
              <p className="text-[15px] text-ink-2">{t(ERRORS[code ?? ""]?.[1] ?? ERRORS.default[1])}</p>
            </div>
          )}

          {info && state === "done" && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="px-6 py-12 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-pos-soft text-pos-text">
                <Check size={30} strokeWidth={2} />
              </div>
              <div className="display text-[24px] font-semibold">{t("To'landi")}</div>
              <p className="num mt-2 text-[15px] text-ink-2">
                {money(info.amount)} · {info.business_name}
              </p>
              <p className="mt-6 text-[14px] text-ink-3">{t("Rahmat! Biznes egasiga xabar yuborildi.")}</p>
              {info.demo && <Chip className="mt-4">{t("demo")}</Chip>}
            </motion.div>
          )}

          {info && (state === "form" || state === "paying") && (
            <>
              <div className="bg-surface-2/60 px-6 pt-6 pb-5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-ink-3">{t("Qabul qiluvchi")}</span>
                  {info.demo && <Chip>{t("demo")}</Chip>}
                </div>
                <div className="mt-1 text-[18px] font-semibold">{info.business_name}</div>
              </div>
              <div className="px-6 py-6">
                <div className="text-[13px] text-ink-3">{t("To'lov summasi")}</div>
                <div className="display mt-1 text-[38px] leading-tight font-bold">{money(info.amount)}</div>
                <dl className="mt-5 divide-y divide-line text-[15px]">
                  {[
                    [t("To'lovchi"), info.person_name],
                    [t("Maqsad"), t("Qarzni qaytarish")],
                    [t("Komissiya"), money(0)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between py-3">
                      <dt className="text-ink-2">{k}</dt>
                      <dd className="num font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                <Button size="lg" className="mt-6 w-full" onClick={pay} loading={state === "paying"}>
                  {t("To'lash")} · {money(info.amount)}
                </Button>
              </div>
            </>
          )}
        </div>
        <p className="mt-4 text-center text-[13px] text-ink-3">{t("To'lov tasdiqlangach, qarz avtomatik yopiladi.")}</p>
      </div>
    </div>
  );
}
