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
