export interface CatalogCategory {
  id: string;
  name: string;
  icon: string;
  priceFrom: number;
  items: EquipmentItem[];
}

export interface EquipmentItem {
  id: string;
  name: string;
  specs: string;
  pricePerDay: number;
  image?: string;
}

export const INSTRUMENT_TYPES = [
  'Перфоратор',
  'Болгарка (УШМ)',
  'Дрель / Шуруповёрт',
  'Бензопила',
  'Триммер / Мотокоса',
  'Газонокосилка',
  'Компрессор',
  'Генератор',
  'Тепловая пушка',
  'Мойка высокого давления',
  'Снегоуборщик',
  'Электродвигатель',
  'Другое',
] as const;

export const CATALOG: CatalogCategory[] = [
  {
    id: 'generators',
    name: 'Генераторы',
    icon: '⚡',
    priceFrom: 800,
    items: [
      { id: 'g1', name: 'FUBAG BS 6600 A ES', specs: '6.0 кВт, бензин, электростарт', pricePerDay: 1200 },
      { id: 'g2', name: 'FUBAG DS 5500', specs: '5.0 кВт, дизель', pricePerDay: 2500 },
      { id: 'g3', name: 'Huter DY6500L', specs: '5.5 кВт, бензин', pricePerDay: 1000 },
      { id: 'g4', name: 'CHAMPION GG7501E', specs: '6.5 кВт, бензин, электростарт', pricePerDay: 1300 },
    ],
  },
  {
    id: 'compressors',
    name: 'Компрессоры',
    icon: '💨',
    priceFrom: 600,
    items: [
      { id: 'c1', name: 'FUBAG B5200B/100', specs: '100л, 440 л/мин', pricePerDay: 800 },
      { id: 'c2', name: 'REMEZA СБ4/С-100', specs: '100л, 440 л/мин', pricePerDay: 700 },
      { id: 'c3', name: 'Aurora GALE-50', specs: '50л, 260 л/мин', pricePerDay: 600 },
    ],
  },
  {
    id: 'vibro',
    name: 'Виброплиты',
    icon: '🪨',
    priceFrom: 500,
    items: [
      { id: 'v1', name: 'CHAMPION PC-5431F', specs: '80 кг, 5.5 л.с.', pricePerDay: 700 },
      { id: 'v2', name: 'FUBAG VPT 300', specs: '100 кг, бензин', pricePerDay: 900 },
    ],
  },
  {
    id: 'perforators',
    name: 'Перфораторы',
    icon: '🔨',
    priceFrom: 400,
    items: [
      { id: 'p1', name: 'Makita HR2470', specs: 'SDS+, 780 Вт, 2.4 Дж', pricePerDay: 400 },
      { id: 'p2', name: 'Bosch GBH 2-26 DFR', specs: 'SDS+, 800 Вт, 2.7 Дж', pricePerDay: 500 },
      { id: 'p3', name: 'DeWALT D25133K', specs: 'SDS+, 800 Вт, 2.9 Дж', pricePerDay: 500 },
    ],
  },
  {
    id: 'heaters',
    name: 'Тепловые пушки',
    icon: '🔥',
    priceFrom: 500,
    items: [
      { id: 'h1', name: 'Ballu BHP-M-15', specs: '15 кВт, электро', pricePerDay: 500 },
      { id: 'h2', name: 'Master BLP 33 M', specs: '33 кВт, газовая', pricePerDay: 700 },
      { id: 'h3', name: 'Kerona P-5000E-T', specs: '41 кВт, дизель', pricePerDay: 1200 },
    ],
  },
  {
    id: 'cutters',
    name: 'Штроборезы',
    icon: '💎',
    priceFrom: 600,
    items: [
      { id: 's1', name: 'Makita SG1251J', specs: '1400 Вт, до 30 мм', pricePerDay: 800 },
      { id: 's2', name: 'Bosch GNF 35 CA', specs: '1400 Вт, до 35 мм', pricePerDay: 900 },
    ],
  },
  {
    id: 'vacuums',
    name: 'Пылесосы строит.',
    icon: '🌀',
    priceFrom: 400,
    items: [
      { id: 'vc1', name: 'Karcher WD 5', specs: '25 л, 1100 Вт', pricePerDay: 400 },
      { id: 'vc2', name: 'Bosch GAS 35 L SFC+', specs: '35 л, 1380 Вт', pricePerDay: 700 },
    ],
  },
  {
    id: 'saws',
    name: 'Бензопилы',
    icon: '🪚',
    priceFrom: 500,
    items: [
      { id: 'sw1', name: 'Husqvarna 135 Mark II', specs: '1600 Вт, 40 см шина', pricePerDay: 500 },
      { id: 'sw2', name: 'STIHL MS 180', specs: '1500 Вт, 35 см шина', pricePerDay: 500 },
    ],
  },
  {
    id: 'tilecutters',
    name: 'Плиткорезы',
    icon: '🔶',
    priceFrom: 500,
    items: [
      { id: 'tc1', name: 'DIAM SP-250', specs: 'электро, до 250 мм', pricePerDay: 500 },
      { id: 'tc2', name: 'Rubi DU-200-L', specs: 'электро, водяное охлаждение', pricePerDay: 700 },
    ],
  },
];
