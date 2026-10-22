# Cursor sessions

Corvale Health's three hospitals are generated data, and Cursor's agent (`cursor-agent`, model Auto) wrote the generator. Both sessions ran headless against written specs, and their full stream logs (`*.jsonl`) are kept beside this file in the local checkout.

## Session 1: build the hospital generator

- Session `9c40599f-bff6-4e05-a69d-d67beea8e07b`, Oct 22 2026, 11.5 minutes, finished successfully.
- Prompt: implement [`data/hospital/SPEC.md`](../../data/hospital/SPEC.md) completely, run the generator against the real FDA inputs, run the tests and fix anything that fails. Do not change the spec; do not commit.
- What it did:
  - 14 file edits;
  - 24 shell runs (generator and test runs);
  - 7 searches and 4 reads.
- Files it wrote:
  - [`data/hospital/generate.py`](../../data/hospital/generate.py), [`common_generics.txt`](../../data/hospital/common_generics.txt), [`scenarios.example.json`](../../data/hospital/scenarios.example.json), [`test_generate.py`](../../data/hospital/test_generate.py).

## Session 2: apply the pharmacist's fixes

- Session `329b3dc5-3c5e-476e-9963-3035a4d4d499`, Oct 22 2026.
- Prompt: apply every fix in [`data/hospital/FIXES-1.md`](../../data/hospital/FIXES-1.md) (a pharmacist's review of session 1's output), write `scenarios.json`, re-run until the tests pass.
- What it did: 8 edits to `generate.py` and 5 shell runs.
- How it ended: Cursor's free plan stopped the session ("You've hit your usage limit"). The remaining fixes in FIXES-1 were finished by hand outside Cursor, and [`data/hospital/audit.py`](../../data/hospital/audit.py) checks them. There are 18 tests in `test_generate.py`.

## What Cursor did not do

The agent, the Zetaris setup, the Meterless engines and the site were written outside Cursor.
