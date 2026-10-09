# 02: Settle a deposit exactly once

**What to build:** A completed mock PSP callback credits a member's wallet once, while a failed callback leaves funds unchanged.

**Blocked by:** 01: Create a Pending deposit.

**Status:** ready-for-human

- [x] A valid completed callback atomically marks the deposit Completed, writes one ledger credit, and updates the operational balance.
- [x] A failed callback marks a Pending deposit Failed with no balance movement; Completed and Failed are terminal.
- [x] Sequential and concurrent duplicate completed callbacks produce one credit, guarded by transaction locking and a unique ledger event key.
- [x] Failed writes roll back to Pending; PostgreSQL HTTP tests assert state, balance, ledger count, and sum under forced concurrent delivery.
