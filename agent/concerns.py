"""SWIMS / Primero "Secondary Protection Concerns" vocabulary + free-text mapping.

Ported faithfully from the source runtime's concern mapper. SWIMS silently drops
protection_concerns values that are not real lookup codes, so every code we send
to Primero MUST come from CONCERN_CODES below. Source of truth on the server:
lookup-protection-concerns (refresh with GET /api/v2/lookups?per=999).
"""
from __future__ import annotations
import re

# code -> human label (order roughly matches the SWIMS form)
CONCERN_LABELS: dict[str, str] = {
    "child_maintenance": "Child maintenance",
    "child_custody": "Child custody/access",
    "abuse": "Child Abuse (excluding Child Sexual Abuse)",
    "abandonment": "Abandoned/Missing/Unaccompanied/Separated children",
    "family_welfare": "Family Welfare",
    "conflict_with_law": "Juvenile Offender",
    "female_genital_mutilation": "Female Genital Mutilation",
    "physical_abuse": "Physical abuse",
    "sexual_abuse": "Child Sexual Abuse",
    "economic_abuse": "Economic abuse",
    "emotional_verbal_or_psychological_abuse": "Domestic Violence",
    "harassment": "Harassment",
    "corporal_punishment_outside_school": "Corporal punishment outside school",
    "corporal_punishment_in_schools": "Corporal punishment in schools",
    "bullying": "Bullying",
    "rape": "Rape",
    "defilement_of_child_under_16_years_of_age": "Defilement of child under 16",
    "indecent_assault": "Indecent assault",
    "child_prostitution": "Child prostitution",
    "incest": "Incest",
    "sexual_exploitation": "Sexual exploitation",
    "adolescent_pregnancy": "Adolescent Pregnancy / Pregnant Girl",
    "child_marriage": "Child Marriage / Married Child",
    "abduction": "Abduction / Child Stealing / Kidnapping",
    "forced_marriage": "Forced marriage",
    "child_labour": "Child labour",
    "worst_forms_of_child_labour": "Worst Forms of Child Labour (incl. trafficking, CSEC)",
    "child_domestic_work": "Child domestic work",
    "child_trafficking": "Child trafficking",
    "human_trafficking": "Human trafficking",
    "coercion": "Coercion",
    "forced_child_labour": "Forced Child Labour",
    "slavery": "Slavery / Ritual Slavery / Debt bondage",
    "debt_bondage": "Debt bondage",
    "kidnapping": "Kidnapping",
    "human_smuggling": "Migrant Smuggling",
    "street_begging": "Street Begging",
    "street_hawking": "Street Hawking",
    "children_on_the_street_situations": "Child in Street Situations (begging & hawking)",
    "neglect_or_negligent_treatment": "Neglect or Negligent Treatment",
    "discrimination": "Discrimination / Marginalization",
    "child_stealing": "Child-Stealing",
    "children_without_birth_registration": "Children without Birth Registration",
    "lack_of_valid_nhis_cards": "Inactive NHIS Cards",
    "child_online_abuse": "Child Online Abuse",
    "online_child_sexual_abuse": "Online Child Sexual Abuse and Exploitation",
    "sexual_extortion": "Sexual Extortion",
    "grooming_or_online_grooming": "Grooming / online grooming",
    "child_sexual_abuse_material_child_sexual_exploitation_material": "Child sexual abuse/exploitation material",
    "sexting": "Sexting",
    "live_streaming_of_child_sexual_abuse": "Live streaming of child sexual abuse",
    "cyberbullying": "Other online protection issues",
    "paternity_dna": "Paternity / DNA",
    "children_with_special_disabilities": "Persons with disabilities",
    "children_in_situations_of_migration": "Children in situations of migration",
    "unaccompanied_children": "Unaccompanied children",
    "child_maltreatment": "Child maltreatment",
    "child_with_special_education_needs_e2c8dc9": "Child with Special Education Needs",
    "child_parent_1330983": "Child Parent",
    "_child_headed_household_496dbcb": "Child-headed Household",
    "child_at_risk_of_not_attending_school___school_drop_out_081c772": "At risk of not attending school / Drop-out",
    "child_witness_of_violence_to_other_e9583ee": "Child Witness of Violence",
    "mental_illness_f644d4d": "Mental Illness",
    "persons_with_hiv_aids_and_other_serious_illnesses_616e6fc": "HIV/AIDS & other serious illnesses",
    "sexual_violence_4537b7c": "Sexual Violence",
    "victims_of_online_sgbv_2d5cc77": "Victims of Online SGBV",
    "indigency_15bb867": "Indigency",
    "leap_related_concern_69eb0a9": "LEAP-related concern",
    "malnourished_child___malnutrition_8357119": "Malnourished child / Malnutrition",
    "other__please_specify_below__95a6071": "Other (please specify)",
    "asylum_seeker_1e74fec": "Asylum-seeker",
    "refugee_8ef7351": "Refugee",
    "displaced_persons_bae9773": "Displaced Persons",
    "emergency_situations__disaster_and_conflicts__a1bf623": "Emergency situations (disaster/conflict)",
}

CONCERN_CODES = set(CONCERN_LABELS.keys())
FALLBACK_CONCERN = "other__please_specify_below__95a6071"

# keyword/phrase -> code. Ordered: more specific phrases first. Substring match.
SYNONYMS: list[tuple[str, str]] = [
    ("worst form", "worst_forms_of_child_labour"),
    ("hazardous work", "worst_forms_of_child_labour"),
    ("csec", "worst_forms_of_child_labour"),
    ("human traffic", "human_trafficking"),
    ("traffick", "child_trafficking"),
    ("smuggl", "human_smuggling"),
    ("forced labour", "forced_child_labour"),
    ("forced to work", "forced_child_labour"),
    ("debt bondage", "debt_bondage"),
    ("bondage", "slavery"),
    ("trokosi", "slavery"),
    ("ritual", "slavery"),
    ("slavery", "slavery"),
    ("domestic work", "child_domestic_work"),
    ("house help", "child_domestic_work"),
    ("housemaid", "child_domestic_work"),
    ("house maid", "child_domestic_work"),
    ("galamsey", "child_labour"),
    ("mining", "child_labour"),
    ("quarry", "child_labour"),
    ("rock crusher", "child_labour"),
    ("fishing", "child_labour"),
    ("cocoa", "child_labour"),
    ("farm", "child_labour"),
    ("herd", "child_labour"),
    ("child labour", "child_labour"),
    ("child labor", "child_labour"),
    ("working at", "child_labour"),
    ("kayaye", "street_hawking"),
    ("head porter", "street_hawking"),
    ("hawk", "street_hawking"),
    ("begging", "street_begging"),
    ("street child", "children_on_the_street_situations"),
    ("on the street", "children_on_the_street_situations"),
    ("defilement", "defilement_of_child_under_16_years_of_age"),
    ("defiled", "defilement_of_child_under_16_years_of_age"),
    ("rape", "rape"),
    ("incest", "incest"),
    ("indecent assault", "indecent_assault"),
    ("prostitut", "child_prostitution"),
    ("sexual exploitation", "sexual_exploitation"),
    ("sexually exploit", "sexual_exploitation"),
    ("sexual extortion", "sexual_extortion"),
    ("sexual violence", "sexual_violence_4537b7c"),
    ("sexual abuse", "sexual_abuse"),
    ("sexually abuse", "sexual_abuse"),
    ("online grooming", "grooming_or_online_grooming"),
    ("grooming", "grooming_or_online_grooming"),
    ("sexting", "sexting"),
    ("live stream", "live_streaming_of_child_sexual_abuse"),
    ("online sexual", "online_child_sexual_abuse"),
    ("online sgbv", "victims_of_online_sgbv_2d5cc77"),
    ("cyberbull", "cyberbullying"),
    ("online abuse", "child_online_abuse"),
    ("forced marriage", "forced_marriage"),
    ("child marriage", "child_marriage"),
    ("married", "child_marriage"),
    ("pregnan", "adolescent_pregnancy"),
    ("fgm", "female_genital_mutilation"),
    ("genital mutilation", "female_genital_mutilation"),
    ("circumcis", "female_genital_mutilation"),
    ("cutting", "female_genital_mutilation"),
    ("domestic violence", "emotional_verbal_or_psychological_abuse"),
    ("emotional abuse", "emotional_verbal_or_psychological_abuse"),
    ("psychological abuse", "emotional_verbal_or_psychological_abuse"),
    ("verbal abuse", "emotional_verbal_or_psychological_abuse"),
    ("physical abuse", "physical_abuse"),
    ("beaten", "physical_abuse"),
    ("beating", "physical_abuse"),
    ("economic abuse", "economic_abuse"),
    ("harass", "harassment"),
    ("corporal punishment in school", "corporal_punishment_in_schools"),
    ("caning", "corporal_punishment_in_schools"),
    ("flogg", "corporal_punishment_in_schools"),
    ("corporal punishment", "corporal_punishment_outside_school"),
    ("bully", "bullying"),
    ("neglect", "neglect_or_negligent_treatment"),
    ("negligent", "neglect_or_negligent_treatment"),
    ("maltreat", "child_maltreatment"),
    ("witness of violence", "child_witness_of_violence_to_other_e9583ee"),
    ("child abuse", "abuse"),
    ("maintenance", "child_maintenance"),
    ("upkeep", "child_maintenance"),
    ("custody", "child_custody"),
    ("access to child", "child_custody"),
    ("paternity", "paternity_dna"),
    ("dna", "paternity_dna"),
    ("abandon", "abandonment"),
    ("missing child", "abandonment"),
    ("separated", "abandonment"),
    ("unaccompanied", "unaccompanied_children"),
    ("child headed", "_child_headed_household_496dbcb"),
    ("child parent", "child_parent_1330983"),
    ("family welfare", "family_welfare"),
    ("juvenile", "conflict_with_law"),
    ("conflict with law", "conflict_with_law"),
    ("in conflict with the law", "conflict_with_law"),
    ("arrested", "conflict_with_law"),
    ("abduct", "abduction"),
    ("kidnap", "kidnapping"),
    ("child steal", "child_stealing"),
    ("stealing child", "child_stealing"),
    ("special education", "child_with_special_education_needs_e2c8dc9"),
    ("drop out", "child_at_risk_of_not_attending_school___school_drop_out_081c772"),
    ("dropout", "child_at_risk_of_not_attending_school___school_drop_out_081c772"),
    ("not attending school", "child_at_risk_of_not_attending_school___school_drop_out_081c772"),
    ("out of school", "child_at_risk_of_not_attending_school___school_drop_out_081c772"),
    ("disab", "children_with_special_disabilities"),
    ("mental", "mental_illness_f644d4d"),
    ("psychiatric", "mental_illness_f644d4d"),
    ("hiv", "persons_with_hiv_aids_and_other_serious_illnesses_616e6fc"),
    ("aids", "persons_with_hiv_aids_and_other_serious_illnesses_616e6fc"),
    ("malnourish", "malnourished_child___malnutrition_8357119"),
    ("malnutrition", "malnourished_child___malnutrition_8357119"),
    ("birth registration", "children_without_birth_registration"),
    ("birth certificate", "children_without_birth_registration"),
    ("not registered", "children_without_birth_registration"),
    ("nhis", "lack_of_valid_nhis_cards"),
    ("health insurance", "lack_of_valid_nhis_cards"),
    ("indigen", "indigency_15bb867"),
    ("leap", "leap_related_concern_69eb0a9"),
    ("discriminat", "discrimination"),
    ("marginal", "discrimination"),
    ("stigma", "discrimination"),
    ("refugee", "refugee_8ef7351"),
    ("asylum", "asylum_seeker_1e74fec"),
    ("displaced", "displaced_persons_bae9773"),
    ("migration", "children_in_situations_of_migration"),
    ("migrant", "children_in_situations_of_migration"),
    ("disaster", "emergency_situations__disaster_and_conflicts__a1bf623"),
    ("flood", "emergency_situations__disaster_and_conflicts__a1bf623"),
    ("emergency", "emergency_situations__disaster_and_conflicts__a1bf623"),
    ("education_exclusion", "child_at_risk_of_not_attending_school___school_drop_out_081c772"),
]


def _slug(s: str) -> str:
    return re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", str(s or "").lower().strip()))


def _haystack(s: str) -> str:
    raw = str(s or "").lower()
    return f"{raw} {raw.replace('_', ' ')}"


def resolve_concern(term: str) -> str | None:
    """Resolve a single free-text term to a concern code, or None."""
    if not term:
        return None
    s = _slug(term)
    if s in CONCERN_CODES:
        return s
    hay = _haystack(term)
    for kw, code in SYNONYMS:
        if kw in hay:
            return code
    return None


def infer_concerns(text: str) -> list[str]:
    """Scan a narrative and return all concern codes it implies."""
    if not text:
        return []
    hay = _haystack(text)
    out: list[str] = []
    for kw, code in SYNONYMS:
        if kw in hay and code not in out:
            out.append(code)
    return out


def normalize_concerns(provided, narrative: str = "") -> dict:
    """Normalise loose concern input to valid SWIMS codes.

    Returns {"codes": [...], "dropped": [...]}; codes always has >=1 entry
    (falls back to narrative inference, then the generic 'other' code).
    """
    items = provided if isinstance(provided, list) else str(provided or "").split(",")
    codes: list[str] = []
    dropped: list[str] = []
    for item in items:
        t = str(item or "").strip()
        if not t:
            continue
        code = resolve_concern(t)
        if code and code not in codes:
            codes.append(code)
        elif not code:
            dropped.append(t)
    if not codes and narrative:
        for c in infer_concerns(narrative):
            if c not in codes:
                codes.append(c)
    if not codes:
        codes = [FALLBACK_CONCERN]
    return {"codes": codes, "dropped": dropped}
