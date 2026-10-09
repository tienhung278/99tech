# 05: Withdraw only after turnover

**What to build:** A member can withdraw available funds after accrued turnover meets required turnover, with eligibility and debit safe under concurrency.

**Blocked by:** 04: Place a wager without overdrawing.

**Status:** ready-for-human

- [x] Required turnover derives from completed deposits and multipliers; accrued turnover derives from accepted wagers, including wagers before later deposits.
- [x] A blocked withdrawal returns 422 with exact outstanding turnover as a decimal string and changes no funds.
- [x] An eligible withdrawal atomically creates a Pending withdrawal, writes a unique ledger debit, and reduces the operational balance.
- [x] Tests cover zero multiplier, blocking and unblocking, concurrent withdrawals, and a deposit completion racing with withdrawal.
