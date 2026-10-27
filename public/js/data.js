/**
 * data.js — static lists used by the dropdowns + government scheme info.
 *
 * COMMODITIES: the most-traded AGMARKNET crops (with the exact official
 * spellings the API expects). Farmers can also be advised to try others.
 *
 * SCHEMES: plain-language summaries of well-known central government
 * schemes. Links go to the official portals.
 */

export const COMMODITIES = [
  'Onion', 'Potato', 'Tomato', 'Wheat', 'Paddy', 'Maize', 'Bajra', 'Jowar', 'Barley',
  'Cotton', 'Soybean', 'Sugarcane', 'Mustard', 'Groundnut', 'Sesame Seed',
  'Gram', 'Arhar (Tur)', 'Moong', 'Urad', 'Masoor',
  'Banana', 'Mango', 'Grapes', 'Apple', 'Sweet Orange', 'Pomegranate',
  'Chilli', 'Garlic', 'Ginger', 'Coriander', 'Turmeric',
  'Castor Seed', 'Sunflower Seed', 'Linseed', 'Coconut',
];

export const STATES = [
  'Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jammu & Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan',
  'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

export const SCHEMES = [
  {
    name: 'PM-KISAN (PM Kisan Samman Nidhi)',
    description:
      'Income support of ₹6,000 per year paid directly to landholding farmer families in three instalments of ₹2,000, straight into their bank accounts.',
    eligibility: 'Landholding farmer families (cultivable land in their name). Excludes income-tax payers and institutional landholders.',
    benefit: '₹6,000/year direct bank transfer.',
    url: 'https://pmkisan.gov.in',
  },
  {
    name: 'PMFBY (Pradhan Mantri Fasal Bima Yojana)',
    description:
      'Crop insurance against natural calamities, pests and diseases. Farmers pay a small premium (1.5–2% for food crops) and get compensation if the crop fails.',
    eligibility: 'All farmers, including sharecroppers and tenant farmers, growing notified crops in notified areas.',
    benefit: 'Full sum-insured payout on crop loss; very low premium.',
    url: 'https://pmfby.gov.in',
  },
  {
    name: 'Kisan Credit Card (KCC)',
    description:
      'Short-term crop loans at subsidised interest (around 7% with a 3% prompt-repayment subvention, so effectively ~4%) up to a ₹3 lakh limit, for seeds, fertiliser and other inputs.',
    eligibility: 'All farmers — owners, tenants, sharecroppers, SHG members.',
    benefit: 'Cheap, instant credit for farming needs; animal husbandry and fisheries also covered.',
    url: 'https://www.myscheme.gov.in/en/schemes/kisan-credit-card',
  },
  {
    name: 'Soil Health Card Scheme',
    description:
      'Free soil testing of your farm with a card showing nutrient levels (N, P, K and micronutrients) and a fertiliser recommendation tailored to your soil and crop.',
    eligibility: 'All farmers; samples are collected cycle-wise by the agriculture department.',
    benefit: 'Correct fertiliser use — saves money and improves yield.',
    url: 'https://soilhealth.dac.gov.in',
  },
  {
    name: 'e-NAM (National Agriculture Market)',
    description:
      'Online trading platform linking APMC mandis across India. Farmers can see bids from buyers in other states and get better prices through transparent online auctions.',
    eligibility: 'Any farmer can register; needs a bank account and mobile number.',
    benefit: 'Access to buyers beyond your local mandi; online payment direct to your bank.',
    url: 'https://enam.gov.in',
  },
  {
    name: 'PM-KUSUM (solar pumps)',
    description:
      'Subsidy support (30% central + 30% state + 30% loan, farmer pays ~10%) for standalone solar agriculture pumps and solarisation of existing pump sets.',
    eligibility: 'Individual farmers, FPOs, panchayats, cooperatives, water-user associations.',
    benefit: 'Cheap daytime irrigation power; sell extra solar electricity to DISCOM for income.',
    url: 'https://pmkusum.mnre.gov.in',
  },
  {
    name: 'Paramparagat Krishi Vikas Yojana (PKVY)',
    description:
      'Support for organic farming: ₹50,000 per hectare over 3 years for organic inputs, certification (PGS-India) and marketing.',
    eligibility: 'Farmers willing to form clusters (20+ hectares) and practise organic farming.',
    benefit: 'Reduced input cost + premium price for certified organic produce.',
    url: 'https://pgsindia-ncof.gov.in',
  },
  {
    name: 'SMAM (Agricultural Mechanization)',
    description:
      'Subsidy (40–50%, higher for SC/ST/women/small farmers) on tractors, rotavators, seed drills, harvesters and other machinery.',
    eligibility: 'Individual small/marginal farmers, SHGs, FPOs, custom hiring centres.',
    benefit: 'Affordable machinery; custom hiring centres let you rent equipment.',
    url: 'https://agrimachinery.nic.in',
  },
];

/* ════════════════════════════════════════════════════════════════
   Farm data — crop cycle + production costs (v15)
   ════════════════════════════════════════════════════════════════ */

/** Typical days from sowing to harvest (Indian averages). */
export const CROP_DAYS = {
  Wheat: 130, Paddy: 120, Maize: 100, Bajra: 80, Jowar: 110, Barley: 120,
  Onion: 120, Potato: 90, Tomato: 110, Chilli: 150, Garlic: 130, Ginger: 210,
  Cotton: 180, Soybean: 100, Sugarcane: 330, Mustard: 110, Groundnut: 120,
  Gram: 110, 'Arhar (Tur)': 160, Moong: 70, Urad: 80, Masoor: 110,
  Banana: 330, Mango: 365, Grapes: 150, Pomegranate: 300,
  Turmeric: 240, Coriander: 90, Sesame: 90, Coconut: 365,
};
export const DEFAULT_CROP_DAYS = 120;

/** The five phases of a crop's life, as fractions of the season. */
export const CROP_STAGES = [
  { key: 'stage_sowing',     to: 0.10, icon: 'sprout' },
  { key: 'stage_vegetative', to: 0.45, icon: 'leaf' },
  { key: 'stage_flowering',  to: 0.70, icon: 'flower' },
  { key: 'stage_maturity',   to: 0.90, icon: 'wheat' },
  { key: 'stage_harvest',    to: 1.01, icon: 'truck' },
];

/** Categories for production-cost rows. */
export const EXPENSE_CATEGORIES = [
  { key: 'exp_seed',       icon: 'sprout' },
  { key: 'exp_fertiliser', icon: 'flask' },
  { key: 'exp_pesticide',  icon: 'shieldAlert' },
  { key: 'exp_labour',     icon: 'user' },
  { key: 'exp_machinery',  icon: 'gauge' },
  { key: 'exp_irrigation', icon: 'droplets' },
  { key: 'exp_transport',  icon: 'truck' },
  { key: 'exp_other',      icon: 'coins' },
];

export const AREA_UNITS = ['acre', 'hectare', 'guntha', 'bigha'];

export const cropDays = (commodity) => CROP_DAYS[commodity] || DEFAULT_CROP_DAYS;

/**
 * Work out where a crop is in its life cycle from its sowing date
 * (and optional expected-harvest date).
 * Returns { daysSince, daysToHarvest, progress (0-1), stageIndex, stage }.
 */
export function cropStage(crop) {
  const sown = crop.sowingDate ? new Date(crop.sowingDate + 'T00:00:00') : null;
  const now = new Date();
  const daysSince = sown ? Math.max(0, Math.floor((now - sown) / 86400000)) : 0;

  let harvest = null;
  if (crop.expectedHarvestDate) harvest = new Date(crop.expectedHarvestDate + 'T00:00:00');
  else if (sown) harvest = new Date(sown.getTime() + cropDays(crop.commodity) * 86400000);

  const daysToHarvest = harvest ? Math.round((harvest - now) / 86400000) : null;
  const totalDays = sown && harvest ? Math.max(1, Math.round((harvest - sown) / 86400000)) : cropDays(crop.commodity);
  const progress = sown ? Math.min(1, Math.max(0, daysSince / totalDays)) : 0;

  let stageIndex = CROP_STAGES.length - 1;
  for (let i = 0; i < CROP_STAGES.length; i++) {
    if (progress <= CROP_STAGES[i].to) { stageIndex = i; break; }
  }
  return { daysSince, daysToHarvest, progress, stageIndex, stage: CROP_STAGES[stageIndex], totalDays };
}
