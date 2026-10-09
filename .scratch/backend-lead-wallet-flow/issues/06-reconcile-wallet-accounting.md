# 06: Reconcile wallet accounting

**What to build:** An operator can detect a ledger-to-balance discrepancy and keep the affected wallet from moving more money.

**Blocked by:** 05: Withdraw only after turnover.

**Status:** ready-for-human

- [x] A manual reconciliation entry point reports the exact difference between signed ledger sum and operational balance.
- [x] A detected mismatch freezes the affected wallet for further money movement; a matching wallet stays usable.
- [x] An integration test introduces a discrepancy, runs reconciliation, and verifies the freeze and unchanged ledger.
- [x] The decision note records the detection gap and deferred automated schedule.
