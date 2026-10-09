# 04: Place a wager without overdrawing

**What to build:** A member can wager from available funds, accruing turnover while the wallet and ledger remain consistent.

**Blocked by:** 02: Settle a deposit exactly once.

**Status:** ready-for-human

- [x] An accepted positive wager atomically writes its record and unique ledger debit and reduces the operational balance.
- [x] An insufficient-funds wager leaves the wager history, ledger, and balance unchanged.
- [x] Two wagers serialize so the accepted total never exceeds available funds.
- [x] A PostgreSQL HTTP test forces overlap and checks accepted wagers, balance, and reconstructible ledger total.
