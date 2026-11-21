// Цифры для блока «Muammo». Источники проверяет команда перед показом — правьте здесь, вёрстка подхватит.
export interface Fact {
  value: string;
  text: string;
  /** подпись под цифрой; null — без источника (качественное утверждение) */
  source: string | null;
}

export const FACTS: Fact[] = [
  {
    value: "50%+",
    text: "YaIMning yarmidan ko'pini kichik biznes va xususiy tadbirkorlik beradi",
    source: "O'zstat — tekshirilsin",
  },
  {
    value: "~¾",
    text: "band aholining taxminan to'rtdan uch qismi kichik biznesda ishlaydi",
    source: "O'zstat — tekshirilsin",
  },
  {
    value: "Daftar",
    text: "mikro biznesda hisob ko'pincha daftar va xotirada — pul yetmasligi to'lov kuni bilinadi",
    source: null,
  },
];
