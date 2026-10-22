# Fix list 1 for generate.py (pharmacist review, Oct 22)

A hospital pharmacist found these problems in the first output. Fix every item, keep all existing tests passing, and add a test for each numbered fix.

1. **Shortage injectables must be injectables.**
   - For items that come from the shortage list, pick package NDCs only where the dosage form or route is parenteral: INJECTION*, *FOR INJECTION*, EMULSION, INTRAVENOUS, INTRAMUSCULAR, SUBCUTANEOUS, EPIDURAL, INTRATHECAL, INFILTRATION, INTRA-ARTERIAL, INTRA-ARTICULAR, INTRAVITREAL.
   - Ophthalmic, oral, topical and oropharyngeal products must not appear under a shortage injectable.
   - **Prefer the NDCs FDA itself lists for that shortage.** The `ndcs` column of the shortage CSV holds the package NDCs. Normalise them and match them to the directory's `packaging.package_ndc`, so the hospital stocks the exact products named in FDA's listing. Fall back to directory search only when none match.
   - Record on each item which path it took, as `ndc_source`: `fda_shortage_listing` or `directory_search`.
2. **Interchange rules must be clinically honest.** Rebuild `cg.therapeutic_interchange` with exactly these rule types, in order of preference:
   - `same product, alternate manufacturer`: same active ingredient, strength, dosage form and route, different labeler. This is the first move in a real shortage. Generate it wherever the formulary has two labelers of the same product, adding a second labeler NDC for shortage drugs if needed.
   - `same molecule, alternate concentration or vial size`: same ingredient and the **same route**, different strength or package. The notes must say "recalculate dose and volume; pharmacist verification required".
   - `IV-to-PO conversion per P&T protocol`: only for these classic pairs, and only when both items exist: pantoprazole, metronidazole, levetiracetam, famotidine, linezolid, azithromycin, fluconazole, levofloxacin, ciprofloxacin, acetaminophen. Never for anything else.
   - `protocol-specific, oncologist approval`: different molecules only, and only for cisplatin → carboplatin. The note must say "not interchangeable in all regimens; per treating oncologist".
   - Never pair two items whose routes differ, except under the IV-to-PO rule.
   - Never pair an item with itself or with the same NDC.
   - Never use the oncology rule for the same molecule.
3. **Units follow ISMP's list of error-prone abbreviations.**
   - In every human-readable strength or description, write `ug` and `µg` as `mcg`.
   - Write `[iU]` and `[IU]` as `units` and `[USP'U]` as `USP units`.
   - Remove leading-decimal strengths: `.1 mg/mL` becomes `0.1 mg/mL`. Trailing zeros were never in the data; keep it that way.
   - Store the raw FDA strength in a separate `strength_raw` column in `formulary_master.csv` only.
4. **Therapeutic classes.** Use an anticholinergic class for atropine and glycopyrrolate. Make sure vasopressin, phenylephrine, norepinephrine, epinephrine and dopamine are vasopressors, and that midazolam and lorazepam injections are benzodiazepines (add that class). These map to syringe-label colours in the UI.
5. **Scenarios.** Write `data/hospital/scenarios.json` (the real file, not the example), so the default demo has stories. It needs:
   - Cisplatin Injection: General 9 days on hand; East 14 surplus packages; absent at Lakeside.
   - Carboplatin Injection: General 31 days on hand.
   - Lidocaine Hydrochloride injection: General 6 days on hand; East 3 surplus packages; Lakeside low.
   - Methotrexate injection: General 12 days on hand.
   - Fentanyl Citrate Injection: General 18 days on hand.

   Implement `lakeside: {"days_on_hand": n}` too. Re-run the generator with scenarios applied and confirm the numbers in a test.
6. **Lakeside descriptions use Tall Man lettering from the FDA and ISMP list** wherever the drug is on that list. Embed the list as a dict in the generator, e.g. CISplatin, CARBOplatin, vinBLAStine, vinCRIStine, hydrALAZINE, hydrOXYzine, HYDROmorphone, morphine, DOBUTamine, DOPamine, NIFEdipine, niCARdipine, OXcarbazepine, carBAMazepine, PENTobarbital, PHENobarbital, glipiZIDE, glyBURIDE, predniSONE, prednisoLONE, methylPREDNISolone, KETorolac. Leave epinephrine in normal case, because it is not on the list. Only apply the casing on Lakeside's free-text descriptions; keep FDA names elsewhere.

Then run `python3 data/hospital/generate.py` and `python3 -m unittest data/hospital/test_generate.py -v`. Finish with a summary of:
- the new counts;
- interchange counts by rule;
- a printed audit showing that no interchange pair breaks rule 2.
