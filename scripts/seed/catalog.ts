// Seed catalogue constants (implementationplan.md §5.4, §5.5).
// Hand-written lists of common generic names; nothing here is copied from a
// reference file. P05 adds the generator's name lists to this file.

export const CATEGORIES = [
  "analgesic",
  "antibiotic",
  "antidiabetic",
  "cardiac",
  "gastro",
  "respiratory",
  "vitamins",
  "dermatology",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Composition keyword → therapeutic category. Matched case-insensitively as a
 * substring of short_composition1, then short_composition2. First match wins,
 * in the order written here (so put more specific keywords first). No match → "other".
 */
export const CATEGORY_KEYWORDS: ReadonlyArray<readonly [keyword: string, category: Category]> = [
  // antidiabetic (before vitamins: "insulin", metformin combos)
  ["insulin", "antidiabetic"],
  ["metformin", "antidiabetic"],
  ["glimepiride", "antidiabetic"],
  ["gliclazide", "antidiabetic"],
  ["glibenclamide", "antidiabetic"],
  ["glipizide", "antidiabetic"],
  ["sitagliptin", "antidiabetic"],
  ["vildagliptin", "antidiabetic"],
  ["teneligliptin", "antidiabetic"],
  ["linagliptin", "antidiabetic"],
  ["dapagliflozin", "antidiabetic"],
  ["empagliflozin", "antidiabetic"],
  ["pioglitazone", "antidiabetic"],
  ["voglibose", "antidiabetic"],
  ["acarbose", "antidiabetic"],

  // antibiotic / anti-infective
  ["amoxycillin", "antibiotic"],
  ["amoxicillin", "antibiotic"],
  ["ampicillin", "antibiotic"],
  ["cloxacillin", "antibiotic"],
  ["azithromycin", "antibiotic"],
  ["clarithromycin", "antibiotic"],
  ["erythromycin", "antibiotic"],
  ["roxithromycin", "antibiotic"],
  ["cefixime", "antibiotic"],
  ["cefpodoxime", "antibiotic"],
  ["cefuroxime", "antibiotic"],
  ["ceftriaxone", "antibiotic"],
  ["cefoperazone", "antibiotic"],
  ["cefadroxil", "antibiotic"],
  ["cephalexin", "antibiotic"],
  ["cefdinir", "antibiotic"],
  ["ciprofloxacin", "antibiotic"],
  ["ofloxacin", "antibiotic"],
  ["levofloxacin", "antibiotic"],
  ["moxifloxacin", "antibiotic"],
  ["norfloxacin", "antibiotic"],
  ["doxycycline", "antibiotic"],
  ["minocycline", "antibiotic"],
  ["linezolid", "antibiotic"],
  ["meropenem", "antibiotic"],
  ["piperacillin", "antibiotic"],
  ["amikacin", "antibiotic"],
  ["gentamicin", "antibiotic"],
  ["metronidazole", "antibiotic"],
  ["tinidazole", "antibiotic"],
  ["ornidazole", "antibiotic"],
  ["nitrofurantoin", "antibiotic"],
  ["faropenem", "antibiotic"],
  ["cotrimoxazole", "antibiotic"],
  ["sulfamethoxazole", "antibiotic"],

  // dermatology (before analgesic: topical steroid/antifungal combos)
  ["clotrimazole", "dermatology"],
  ["ketoconazole", "dermatology"],
  ["luliconazole", "dermatology"],
  ["sertaconazole", "dermatology"],
  ["miconazole", "dermatology"],
  ["terbinafine", "dermatology"],
  ["itraconazole", "dermatology"],
  ["fluconazole", "dermatology"],
  ["mupirocin", "dermatology"],
  ["fusidic acid", "dermatology"],
  ["clobetasol", "dermatology"],
  ["betamethasone", "dermatology"],
  ["mometasone", "dermatology"],
  ["fluticasone", "dermatology"],
  ["adapalene", "dermatology"],
  ["tretinoin", "dermatology"],
  ["isotretinoin", "dermatology"],
  ["benzoyl peroxide", "dermatology"],
  ["permethrin", "dermatology"],
  ["minoxidil", "dermatology"],
  ["salicylic acid", "dermatology"],

  // cardiac / cardiovascular
  ["amlodipine", "cardiac"],
  ["cilnidipine", "cardiac"],
  ["nifedipine", "cardiac"],
  ["telmisartan", "cardiac"],
  ["olmesartan", "cardiac"],
  ["losartan", "cardiac"],
  ["valsartan", "cardiac"],
  ["irbesartan", "cardiac"],
  ["ramipril", "cardiac"],
  ["enalapril", "cardiac"],
  ["metoprolol", "cardiac"],
  ["bisoprolol", "cardiac"],
  ["atenolol", "cardiac"],
  ["nebivolol", "cardiac"],
  ["carvedilol", "cardiac"],
  ["propranolol", "cardiac"],
  ["atorvastatin", "cardiac"],
  ["rosuvastatin", "cardiac"],
  ["simvastatin", "cardiac"],
  ["fenofibrate", "cardiac"],
  ["clopidogrel", "cardiac"],
  ["prasugrel", "cardiac"],
  ["ticagrelor", "cardiac"],
  ["aspirin", "cardiac"],
  ["warfarin", "cardiac"],
  ["apixaban", "cardiac"],
  ["rivaroxaban", "cardiac"],
  ["torsemide", "cardiac"],
  ["furosemide", "cardiac"],
  ["spironolactone", "cardiac"],
  ["hydrochlorothiazide", "cardiac"],
  ["chlorthalidone", "cardiac"],
  ["isosorbide", "cardiac"],
  ["ranolazine", "cardiac"],
  ["trimetazidine", "cardiac"],

  // gastro
  ["pantoprazole", "gastro"],
  ["rabeprazole", "gastro"],
  ["omeprazole", "gastro"],
  ["esomeprazole", "gastro"],
  ["lansoprazole", "gastro"],
  ["ranitidine", "gastro"],
  ["famotidine", "gastro"],
  ["domperidone", "gastro"],
  ["ondansetron", "gastro"],
  ["itopride", "gastro"],
  ["levosulpiride", "gastro"],
  ["mosapride", "gastro"],
  ["sucralfate", "gastro"],
  ["lactulose", "gastro"],
  ["bisacodyl", "gastro"],
  ["ursodeoxycholic", "gastro"],
  ["simethicone", "gastro"],
  ["dicyclomine", "gastro"],
  ["drotaverine", "gastro"],
  ["loperamide", "gastro"],
  ["racecadotril", "gastro"],
  ["lactobacillus", "gastro"],
  ["saccharomyces", "gastro"],
  ["pancreatin", "gastro"],

  // respiratory / allergy
  ["montelukast", "respiratory"],
  ["levocetirizine", "respiratory"],
  ["cetirizine", "respiratory"],
  ["fexofenadine", "respiratory"],
  ["bilastine", "respiratory"],
  ["desloratadine", "respiratory"],
  ["loratadine", "respiratory"],
  ["chlorpheniramine", "respiratory"],
  ["phenylephrine", "respiratory"],
  ["ambroxol", "respiratory"],
  ["bromhexine", "respiratory"],
  ["guaifenesin", "respiratory"],
  ["dextromethorphan", "respiratory"],
  ["levosalbutamol", "respiratory"],
  ["salbutamol", "respiratory"],
  ["terbutaline", "respiratory"],
  ["formoterol", "respiratory"],
  ["salmeterol", "respiratory"],
  ["budesonide", "respiratory"],
  ["tiotropium", "respiratory"],
  ["ipratropium", "respiratory"],
  ["doxofylline", "respiratory"],
  ["theophylline", "respiratory"],
  ["acebrophylline", "respiratory"],

  // analgesic / anti-inflammatory
  ["paracetamol", "analgesic"],
  ["diclofenac", "analgesic"],
  ["aceclofenac", "analgesic"],
  ["ibuprofen", "analgesic"],
  ["naproxen", "analgesic"],
  ["etoricoxib", "analgesic"],
  ["nimesulide", "analgesic"],
  ["mefenamic acid", "analgesic"],
  ["ketorolac", "analgesic"],
  ["tramadol", "analgesic"],
  ["tapentadol", "analgesic"],
  ["piroxicam", "analgesic"],
  ["lornoxicam", "analgesic"],
  ["indomethacin", "analgesic"],
  ["thiocolchicoside", "analgesic"],
  ["chlorzoxazone", "analgesic"],
  ["serratiopeptidase", "analgesic"],
  ["pregabalin", "analgesic"],
  ["gabapentin", "analgesic"],

  // vitamins / supplements (last: very common words)
  ["methylcobalamin", "vitamins"],
  ["cyanocobalamin", "vitamins"],
  ["cholecalciferol", "vitamins"],
  ["vitamin", "vitamins"],
  ["folic acid", "vitamins"],
  ["calcium", "vitamins"],
  ["zinc", "vitamins"],
  ["ferrous", "vitamins"],
  ["iron", "vitamins"],
  ["multivitamin", "vitamins"],
  ["biotin", "vitamins"],
  ["pyridoxine", "vitamins"],
  ["thiamine", "vitamins"],
  ["riboflavin", "vitamins"],
  ["niacinamide", "vitamins"],
  ["l-methylfolate", "vitamins"],
  ["coenzyme q10", "vitamins"],
  ["omega", "vitamins"],
];

/** Returns the first matching category for the compositions, or "other". */
export function categoryFromComposition(...compositions: Array<string | null | undefined>): Category | "other" {
  for (const text of compositions) {
    if (!text) continue;
    const lower = text.toLowerCase();
    for (const [keyword, category] of CATEGORY_KEYWORDS) {
      if (lower.includes(keyword)) return category;
    }
  }
  return "other";
}

/**
 * The catalogue's price is a listed retail price (like MRP), not the price to
 * retailer. PTR estimate = listed price × this factor (approximate 20% retailer
 * margin). An assumption, recorded in profile.json.
 */
export const PTR_FROM_LISTED_FACTOR = 0.8;

// ---------------------------------------------------------------------------
// Generator lists (P05). Hand-written; nothing copied from a reference file.
// ---------------------------------------------------------------------------

export const FORMS = ["tablet", "capsule", "syrup", "injection", "ointment", "drops"] as const;
export type Form = (typeof FORMS)[number];

/** Display word per form, used in brand names ("Paracip 650 Tablet"). */
export const FORM_LABEL: Record<Form, string> = {
  tablet: "Tablet",
  capsule: "Capsule",
  syrup: "Syrup",
  injection: "Injection",
  ointment: "Ointment",
  drops: "Drops",
};

/** Pack-size units per form (for the display label, e.g. "strip of 10 tablets"). */
export const PACK_UNIT: Record<Form, string> = {
  tablet: "tablets",
  capsule: "capsules",
  syrup: "ml",
  injection: "vial",
  ointment: "gm",
  drops: "ml",
};

export type Generic = { name: string; strengths: readonly string[]; forms: readonly Form[] };

/** Common generic molecules per category with typical strengths and plausible forms. */
export const GENERICS: Record<Category, readonly Generic[]> = {
  analgesic: [
    { name: "Paracetamol", strengths: ["500mg", "650mg", "125mg/5ml"], forms: ["tablet", "syrup", "drops"] },
    { name: "Diclofenac", strengths: ["50mg", "75mg", "1% w/w"], forms: ["tablet", "injection", "ointment"] },
    { name: "Aceclofenac", strengths: ["100mg", "200mg"], forms: ["tablet", "capsule"] },
    { name: "Ibuprofen", strengths: ["200mg", "400mg", "100mg/5ml"], forms: ["tablet", "syrup"] },
    { name: "Etoricoxib", strengths: ["60mg", "90mg", "120mg"], forms: ["tablet"] },
    { name: "Tramadol", strengths: ["50mg", "100mg"], forms: ["tablet", "capsule", "injection"] },
    { name: "Pregabalin", strengths: ["75mg", "150mg"], forms: ["capsule", "tablet"] },
  ],
  antibiotic: [
    { name: "Amoxicillin", strengths: ["250mg", "500mg", "125mg/5ml"], forms: ["capsule", "tablet", "syrup"] },
    { name: "Azithromycin", strengths: ["250mg", "500mg", "200mg/5ml"], forms: ["tablet", "syrup"] },
    { name: "Cefixime", strengths: ["100mg", "200mg", "50mg/5ml"], forms: ["tablet", "syrup"] },
    { name: "Cefpodoxime", strengths: ["100mg", "200mg"], forms: ["tablet", "syrup"] },
    { name: "Ceftriaxone", strengths: ["500mg", "1g"], forms: ["injection"] },
    { name: "Ciprofloxacin", strengths: ["250mg", "500mg", "0.3% w/v"], forms: ["tablet", "drops"] },
    { name: "Levofloxacin", strengths: ["250mg", "500mg", "750mg"], forms: ["tablet"] },
    { name: "Doxycycline", strengths: ["100mg"], forms: ["capsule", "tablet"] },
    { name: "Metronidazole", strengths: ["200mg", "400mg"], forms: ["tablet", "syrup"] },
    { name: "Amikacin", strengths: ["250mg", "500mg"], forms: ["injection"] },
  ],
  antidiabetic: [
    { name: "Metformin", strengths: ["500mg", "850mg", "1000mg"], forms: ["tablet"] },
    { name: "Glimepiride", strengths: ["1mg", "2mg", "4mg"], forms: ["tablet"] },
    { name: "Gliclazide", strengths: ["40mg", "80mg"], forms: ["tablet"] },
    { name: "Sitagliptin", strengths: ["50mg", "100mg"], forms: ["tablet"] },
    { name: "Vildagliptin", strengths: ["50mg"], forms: ["tablet"] },
    { name: "Dapagliflozin", strengths: ["5mg", "10mg"], forms: ["tablet"] },
    { name: "Insulin Glargine", strengths: ["100IU/ml"], forms: ["injection"] },
  ],
  cardiac: [
    { name: "Amlodipine", strengths: ["2.5mg", "5mg", "10mg"], forms: ["tablet"] },
    { name: "Telmisartan", strengths: ["20mg", "40mg", "80mg"], forms: ["tablet"] },
    { name: "Losartan", strengths: ["25mg", "50mg"], forms: ["tablet"] },
    { name: "Metoprolol", strengths: ["25mg", "50mg"], forms: ["tablet"] },
    { name: "Atorvastatin", strengths: ["10mg", "20mg", "40mg"], forms: ["tablet"] },
    { name: "Rosuvastatin", strengths: ["5mg", "10mg", "20mg"], forms: ["tablet"] },
    { name: "Clopidogrel", strengths: ["75mg"], forms: ["tablet"] },
    { name: "Torsemide", strengths: ["10mg", "20mg"], forms: ["tablet"] },
  ],
  gastro: [
    { name: "Pantoprazole", strengths: ["20mg", "40mg"], forms: ["tablet", "injection"] },
    { name: "Rabeprazole", strengths: ["10mg", "20mg"], forms: ["tablet"] },
    { name: "Omeprazole", strengths: ["20mg"], forms: ["capsule"] },
    { name: "Domperidone", strengths: ["10mg", "1mg/ml"], forms: ["tablet", "syrup"] },
    { name: "Ondansetron", strengths: ["4mg", "8mg", "2mg/5ml"], forms: ["tablet", "syrup", "injection"] },
    { name: "Sucralfate", strengths: ["1g/10ml"], forms: ["syrup"] },
    { name: "Lactulose", strengths: ["10g/15ml"], forms: ["syrup"] },
  ],
  respiratory: [
    { name: "Montelukast", strengths: ["4mg", "5mg", "10mg"], forms: ["tablet"] },
    { name: "Levocetirizine", strengths: ["5mg", "2.5mg/5ml"], forms: ["tablet", "syrup"] },
    { name: "Fexofenadine", strengths: ["120mg", "180mg"], forms: ["tablet"] },
    { name: "Ambroxol", strengths: ["30mg", "15mg/5ml"], forms: ["tablet", "syrup"] },
    { name: "Salbutamol", strengths: ["2mg", "4mg", "2mg/5ml"], forms: ["tablet", "syrup"] },
    { name: "Budesonide", strengths: ["0.5mg/2ml"], forms: ["drops"] },
    { name: "Doxofylline", strengths: ["400mg"], forms: ["tablet"] },
  ],
  vitamins: [
    { name: "Methylcobalamin", strengths: ["500mcg", "1500mcg"], forms: ["tablet", "injection"] },
    { name: "Cholecalciferol", strengths: ["60000IU"], forms: ["capsule"] },
    { name: "Folic Acid", strengths: ["5mg"], forms: ["tablet"] },
    { name: "Calcium Carbonate", strengths: ["500mg", "1250mg"], forms: ["tablet"] },
    { name: "Ferrous Ascorbate", strengths: ["100mg", "30mg/5ml"], forms: ["tablet", "syrup"] },
    { name: "Zinc Sulphate", strengths: ["20mg", "20mg/5ml"], forms: ["tablet", "syrup"] },
  ],
  dermatology: [
    { name: "Clotrimazole", strengths: ["1% w/w"], forms: ["ointment"] },
    { name: "Mupirocin", strengths: ["2% w/w"], forms: ["ointment"] },
    { name: "Clobetasol", strengths: ["0.05% w/w"], forms: ["ointment"] },
    { name: "Ketoconazole", strengths: ["2% w/w"], forms: ["ointment"] },
    { name: "Terbinafine", strengths: ["250mg", "1% w/w"], forms: ["tablet", "ointment"] },
    { name: "Adapalene", strengths: ["0.1% w/w"], forms: ["ointment"] },
    { name: "Fluconazole", strengths: ["150mg"], forms: ["tablet"] },
  ],
};

/** Common fixed-dose combinations: [primary, partner, partner strength, forms]. */
export const COMBINATIONS: Record<Category, ReadonlyArray<readonly [string, string, string, readonly Form[]]>> = {
  analgesic: [["Aceclofenac", "Paracetamol", "325mg", ["tablet"]], ["Diclofenac", "Paracetamol", "325mg", ["tablet"]]],
  antibiotic: [["Amoxicillin", "Clavulanic Acid", "125mg", ["tablet", "syrup"]], ["Cefixime", "Ofloxacin", "200mg", ["tablet"]]],
  antidiabetic: [["Metformin", "Glimepiride", "2mg", ["tablet"]], ["Metformin", "Sitagliptin", "50mg", ["tablet"]]],
  cardiac: [["Telmisartan", "Amlodipine", "5mg", ["tablet"]], ["Atorvastatin", "Aspirin", "75mg", ["capsule"]]],
  gastro: [["Pantoprazole", "Domperidone", "30mg", ["capsule"]], ["Rabeprazole", "Domperidone", "30mg", ["capsule"]]],
  respiratory: [["Montelukast", "Levocetirizine", "5mg", ["tablet", "syrup"]], ["Ambroxol", "Levosalbutamol", "1mg/5ml", ["syrup"]]],
  vitamins: [["Calcium Carbonate", "Vitamin D3", "250IU", ["tablet"]], ["Methylcobalamin", "Pregabalin", "75mg", ["capsule"]]],
  dermatology: [["Clobetasol", "Neomycin", "0.5% w/w", ["ointment"]], ["Clotrimazole", "Beclometasone", "0.025% w/w", ["ointment"]]],
};

/** Brand names = prefix + suffix + strength number, e.g. "Paracip 650". */
export const BRAND_PREFIXES = [
  "Ara", "Bexo", "Calo", "Davi", "Eno", "Feva", "Glyco", "Hemo", "Iva", "Juvo", "Kelo", "Lumo",
  "Mevi", "Novo", "Orvi", "Pera", "Quino", "Revo", "Savi", "Tervo", "Ulva", "Vexo", "Wyno", "Zeli",
] as const;
export const BRAND_SUFFIXES = [
  "cip", "zol", "mox", "dex", "lin", "cort", "pra", "tor", "vex", "fen", "zyn", "lix", "dor", "mel", "sar", "quil",
] as const;

/** Fictional company name parts. */
export const MANUFACTURER_PARTS = {
  first: ["Nirvaan", "Sarvodaya", "Aaroha", "Kshitij", "Vedanta", "Shubh", "Anvaya", "Trishul", "Prakriti", "Akshar", "Samanvay", "Ojas"],
  last: ["Pharma", "Lifesciences", "Healthcare", "Remedies", "Formulations", "Labs"],
} as const;
export const SUPPLIER_PARTS = {
  first: ["Shreeji", "Om Sai", "Mahalaxmi", "Navkar", "Siddhivinayak", "Jagdamba", "Padmavati", "Gurukrupa", "Ambika", "Kalpataru"],
  last: ["Distributors", "Pharma Agencies", "Medical Agencies", "Drug House", "Enterprises"],
} as const;
