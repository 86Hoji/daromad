// Тексты блока «Muammo». Цифру проверяет команда перед показом — правьте здесь, вёрстка подхватит.
export interface Thesis {
  title: string;
  text: string;
}

export const THESES: Thesis[] = [
  {
    title: "Hisob daftar va xotirada",
    text: "Savdo, xarajat va qarzlar tarqoq yoziladi yoki umuman yozilmaydi. «Bugun qancha bo'sh pul bor?» degan savolga aniq javob yo'q.",
  },
  {
    title: "Kamomad to'lov kuni bilinadi",
    text: "Payshanba kuni tovar uchun to'lov esda turadi, lekin o'sha kuni pul yetmasligi — yo'q. Bilinganda kech bo'ladi.",
  },
  {
    title: "Bank uchun ko'rinmas",
    text: "Hisobot ham, pul oqimi tarixi ham yo'q — kredit qimmat yoki umuman berilmaydi.",
  },
];

/** Единственная цифра на лендинге. */
export const CREDIT_FACT = {
  value: 10,
  text: "kichik korxonalarning taxminan o'ndan birida bank krediti bor",
  source: "Jahon banki — tekshirilsin",
};
