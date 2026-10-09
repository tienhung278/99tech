# 03: Handle exceptional PSP callbacks

**What to build:** Unmatched, inconsistent, stale, and contradictory callbacks have explicit outcomes without silently changing funds.

**Blocked by:** 02: Settle a deposit exactly once.

**Status:** ready-for-human

- [x] An amount mismatch leaves the deposit Pending and wallet unchanged; a later matching callback can settle it, and equivalent decimal spellings match.
- [x] An unknown PSP reference returns 404, is recorded, and changes no wallet state.
- [x] A late pending event after completion is recorded as stale and acknowledged without applying a transition.
- [x] A contradictory terminal outcome is rejected and flagged; integration tests assert unchanged state, balance, and ledger.
