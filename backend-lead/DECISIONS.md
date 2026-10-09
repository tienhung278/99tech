# Wallet flow decisions

## Money and concurrency

The signed, append-only `wallet_ledger_entries` are the accounting authority. `wallets.balance` is a fast operational copy used for spending decisions; a ledger entry and its balance update commit in one PostgreSQL transaction. The ledger table rejects updates and deletes. Its database-unique `event_key` (`deposit:<id>`, `wager:<id>`, or `withdrawal:<id>`) provides a second guard against duplicate movements.

Deposits, wagers, and withdrawals have separate tables because their fields and lifecycles differ. Deposits hold a unique opaque PSP reference, provider ID, requested amount, multiplier, and `Pending | Completed | Failed` state. Callback audits record exceptional events separately. Withdrawals are debited immediately and remain `Pending`; approval is outside this implementation.

Every wallet writer locks the wallet row through commit. Callback settlement first locates the deposit's wallet, then locks the **wallet before the deposit** and rechecks the deposit under lock. Wagers, withdrawals, and reconciliation use the same wallet lock. This serializes concurrent callbacks and spending, and lets withdrawal eligibility observe earlier committed deposits and wagers. Rollback leaves related rows unchanged if a write fails.

Money enters and leaves JavaScript as decimal strings, uses BigNumber for arithmetic, and is stored as `DECIMAL(36,18)`. Routes reject nonpositive, over-precision, and unrepresentable amounts instead of rounding; callback amounts are compared numerically, so equivalent decimal spellings match. A completed deposit adds `amount × multiplier` to lifetime required turnover; accepted wagers add their stake to lifetime accrued turnover. Withdrawal returns 422 with the exact positive difference until accrued turnover meets the requirement. Earlier wagers count against later deposits under the challenge's cumulative rule. This carryover can weaken the intended anti-abuse control; a per-deposit rule would need a different model and product decision.

## PSP exceptions and reconciliation

The mock callback is unsigned and carries no currency field; this flow assumes one wallet currency and performs no conversion. `DESIGN-PSP.md` specifies verification, currency checks, and normalization for future real providers; those adapters are not implemented here. A matching completed retry is acknowledged without another credit. An unknown PSP reference returns 404 and is audited. A completed callback with an amount mismatch on a Pending deposit returns 409, leaves it Pending, and permits a later matching callback. A failed callback marks a Pending deposit Failed without moving money, even when its reported amount differs. `Failed` is terminal. A stale `pending` event after a terminal outcome is audited and acknowledged; a contradictory terminal outcome returns 409 and is flagged for reconciliation. No exception silently moves funds.

`POST /wallets/:walletId/reconcile` manually compares ledger sum with operational balance and reports `ledgerTotal - operationalBalance` exactly. A mismatch freezes the wallet in the same transaction. Wagers and withdrawals return 423. A matching completed callback for a Pending deposit also returns 423 before moving money or changing deposit state. Callback processing still locks the wallet and deposit to acknowledge duplicate or pending events, mark a Pending deposit Failed, and record stale, mismatched, or contradictory callbacks. This keeps exception evidence available while a damaged wallet is frozen. Reconciliation runs only when called: an incorrect operational balance can affect decisions before detection. Automated scheduling, alerts, investigation, and a controlled unfreeze procedure remain to be built.

## Verification and remaining work

The implementation includes deposit creation and exactly-once settlement, atomic wagers and turnover-gated withdrawals, callback exception audits, and manual reconciliation with a freeze. The review checkout passed `npm run build` and all 41 tests against PostgreSQL. Tests exercise sequential and concurrent callback retries, concurrent spending, exact turnover and carryover, exceptional callbacks, ledger reconstruction, rollback, and discrepancy freeze.

Client retries of deposit or withdrawal creation can still create a second request; creation idempotency keys are a follow-up. Withdrawal approval/rejection and its compensating credit, full double-entry accounting, production PSP adapters and signature verification, and automated reconciliation/monitoring are also unfinished. These are material production gaps, not guarantees supplied by the passing tests.

AI assistance was used to implement and review the flow, tests, PSP design, and this note. The choices and limitations above were checked against the code and its database tests.
