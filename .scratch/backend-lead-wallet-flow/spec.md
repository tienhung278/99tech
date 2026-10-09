# Backend Lead Wallet Flow Specification

## Problem Statement

A member needs to deposit funds, wager, and withdraw eligible funds without losing money or receiving funds twice. PSP callbacks can be duplicated, concurrent, late, or inconsistent with the original deposit. Concurrent wagers and withdrawals can race over one wallet. The service needs an auditable record of every balance change and a clear explanation when turnover blocks a withdrawal.

The starter supports member and zero-balance wallet creation only. It has no deposit, wager, withdrawal, ledger, turnover, or settlement records. The exercise also asks for a design that makes future PSP integrations safe and routine.

## Solution

A member creates a Pending deposit and receives a generated PSP reference. A matching completed mock callback credits the wallet exactly once. An accepted wager debits the wallet and accrues turnover. A withdrawal succeeds only after lifetime accrued turnover meets lifetime required turnover, then debits the wallet and remains Pending for human approval. Each balance movement has an immutable signed ledger entry. Wallet operations serialize through the wallet row, and all related writes commit atomically.

Implement the specified mock PSP flow. Describe provider adapters, configuration, and fixture-based tests for future PSPs in a separate design note.

## User Stories

1. As a member, I want to request a deposit for a positive decimal amount, so that I can add funds to my wallet.
2. As a member, I want a new deposit to start Pending, so that my wallet is not credited before payment completes.
3. As a member, I want a deposit response to include its ID and opaque PSP reference, so that the payment outcome can be matched to my request.
4. As a member, I want the default turnover multiplier to be one, so that an omitted multiplier has predictable behavior.
5. As a member, I want a nonnegative integer multiplier, including zero, so that the deposit has the agreed wagering requirement.
6. As a member, I want invalid or unrepresentable money amounts rejected, so that no payment is silently rounded.
7. As a member, I want an accepted completed PSP callback to credit exactly the requested amount, so that my balance reflects the confirmed payment.
8. As a member, I want a repeated completed callback to leave my balance unchanged after the first credit, so that a provider retry cannot create extra funds.
9. As a member, I want simultaneous copies of a completed callback to produce one credit, so that concurrent delivery cannot create extra funds.
10. As a member, I want a failed deposit to leave my wallet unchanged, so that unreceived money is never available to spend.
11. As a member, I want a deposit marked Failed to stay terminal if a later completed callback arrives, so that its state cannot silently reverse.
12. As a member, I want a completed callback with the wrong amount to leave the deposit Pending and my wallet unchanged, so that an uncertain payment is investigated.
13. As a member, I want a later matching callback to complete a deposit left Pending after an amount mismatch, so that a valid payment can still settle.
14. As a PSP operator, I want an unknown PSP reference rejected and recorded, so that an unmatched callback is visible without moving money.
15. As a PSP operator, I want a matching duplicate outcome acknowledged, so that ordinary retries can stop without changing state.
16. As a PSP operator, I want a late pending event after completion recorded as stale and acknowledged, so that it cannot reverse settlement or cause endless retries.
17. As a PSP operator, I want contradictory terminal outcomes flagged for reconciliation, so that a possible external payment discrepancy is investigated.
18. As a member, I want an accepted wager to debit my wallet, so that my available funds reflect my stake.
19. As a member, I want a wager rejected when the wallet lacks funds, so that my balance cannot become negative.
20. As a member, I want simultaneous wagers serialized, so that together they cannot spend more than my available balance.
21. As a member, I want each accepted wager to accrue turnover equal to its stake, so that I can satisfy withdrawal requirements.
22. As a member, I want the wager, its ledger debit, and its balance update to commit together, so that a partial write cannot change my funds or eligibility.
23. As a member, I want each completed deposit to add its amount times its multiplier to required turnover, so that the withdrawal rule is predictable.
24. As a member, I want lifetime accrued turnover to count against lifetime required turnover, including turnover accrued before a later deposit, so that the stated rule is applied consistently.
25. As a member, I want a withdrawal blocked while turnover remains outstanding, so that I know why funds are locked.
26. As a member, I want a blocked withdrawal to return status 422 and the exact outstanding amount as a decimal string, so that the client can explain what remains.
27. As a member, I want a withdrawal allowed once accrued turnover meets required turnover, so that eligible funds can leave my wallet.
28. As a member, I want an accepted withdrawal to debit the wallet immediately and create a Pending withdrawal, so that funds are reserved for later approval.
29. As a member, I want simultaneous withdrawals serialized, so that they cannot overdraw my wallet.
30. As a member, I want a withdrawal check to observe a deposit that completed first on the same wallet, so that its new turnover requirement is enforced.
31. As an operator, I want every balance change represented by an immutable ledger entry, so that I can reconstruct a wallet's funds.
32. As an operator, I want to compare the ledger total with the operational balance and freeze a detected discrepancy, so that a damaged wallet is not used for further money movement.
33. As a PSP integrator, I want raw callbacks verified before their fields are trusted, so that forged callbacks cannot settle deposits.
34. As a PSP integrator, I want provider statuses and amount units normalized into one settlement event, so that provider quirks stay outside shared money logic.
35. As a PSP integrator, I want an unexpected currency rejected, so that the single-currency wallet never credits an unconverted amount.
36. As a PSP integrator, I want configuration validated at startup, so that missing verification settings fail before callbacks arrive.
37. As a PSP integrator, I want sanitized payload and signature fixtures plus shared settlement tests, so that an integration can be checked without live PSP access in CI.
38. As a developer, I want observable integration tests for retries, races, turnover, and ledger reconstruction, so that money correctness is demonstrated against the real database.

## Implementation Decisions

- Preserve the specified HTTP contracts: deposit creation returns 201 with deposit ID and PSP reference; the mock callback accepts a PSP reference, status, and amount; wagers address a wallet; withdrawals address a member. The stated request bodies remain valid without an additional idempotency header.
- Create separate deposit, wager, withdrawal, and ledger records through migrations. Retain one wallet per member. A deposit stores its provider ID, database-unique generated PSP reference, requested amount, multiplier, and state.
- Money crosses JavaScript and JSON boundaries as decimal strings, uses BigNumber for arithmetic, and remains exactly representable within PostgreSQL DECIMAL(36,18). Reject nonpositive amounts, excess precision, overflow, and invalid multipliers before writing. Compare normalized amounts numerically, so equivalent decimal spellings match.
- Use explicit deposit states Pending, Completed, and Failed. Completed and Failed are terminal. A matching duplicate outcome is idempotent; an invalid transition changes no state or funds.
- A completed callback with a mismatched amount changes no money and leaves the deposit Pending. An unknown reference returns 404 and is recorded. A later valid callback may settle the Pending deposit. A stale pending event after completion is rejected by the state machine, recorded, and acknowledged at the HTTP boundary. Contradictory terminal outcomes are flagged for reconciliation.
- Use one database transaction for each operation that changes multiple records. Lock the affected wallet row before reading or changing its operational balance. Lock the deposit record during callback settlement and use a consistent lock order. A valid completed callback changes deposit state, appends one ledger credit, and updates the operational balance atomically. A failed write rolls the whole operation back; acknowledge completion only after commit.
- Use signed, append-only wallet movements rather than full double-entry accounting for this exercise. Give each movement a database-unique business event key as a second guard against duplicate credits or debits. The ledger is the accounting authority; the locked wallet balance is the operational balance used for spending decisions.
- An accepted wager writes its wager record and unique ledger debit and updates the balance atomically. The wallet lock prevents concurrent wagers from overdrawing it.
- Calculate lifetime required turnover from completed deposits and their stored multipliers. Calculate lifetime accrued turnover from accepted wagers. Earlier wagers continue to count against later requirements. Outstanding turnover is the positive difference between required and accrued turnover.
- Acquire the wallet lock before calculating withdrawal eligibility and available funds. A valid withdrawal appends a unique ledger debit, updates the balance, and creates a Pending withdrawal atomically. A withdrawal blocked by turnover returns 422 with the outstanding amount as a decimal string.
- Provide a reconciliation query or procedure to compare ledger sum with operational balance, and document how a detected mismatch freezes the wallet. Live decisions use the operational balance, so there is a detection gap until reconciliation runs.
- Keep the exercise's mock callback route. The PSP design note describes configured provider-specific routes that preserve raw bytes for signature verification and pass verified, normalized events into one provider-independent settlement service. Provider configuration maps provider ID to adapter, expected currency, secret reference, and status mapping and is validated at startup.
- Treat the mock provider's currency as configured because its callback omits currency. A provider-supplied currency must match the wallet currency; settlement performs no conversion.
- Complete the required flow and concurrency tests before optional work. Client creation-request idempotency, automated reconciliation scheduling, and withdrawal approval processing remain documented follow-ups.

## Testing Decisions

- Test at the HTTP boundary through the application with Supertest and a real PostgreSQL test database. This is the highest existing test seam and follows the starter's member-creation integration tests. Exercise services and transactions through observable responses and database state rather than mocking row locks or asserting private calls.
- Exercise deposit creation and settlement, wallet wagering, and withdrawal through that HTTP seam. The PSP design note specifies a separate fixture-based contract seam for future provider adapters.
- Cover the required sequential duplicate callback, concurrent duplicate callbacks, concurrent wagers that cannot overdraw, and turnover lock that blocks then allows a withdrawal.
- Force meaningful overlap in concurrency tests by holding a relevant database row lock while both requests begin, then releasing it. Assert final state, wallet balance, ledger count and sum, and accepted wager or withdrawal count.
- Test the end-to-end deposit to wager to withdrawal flow, including exact decimal values and the 422 outstanding-turnover response.
- After required tests, prioritize callback amount mismatch and contradictory terminal state. Verify a later matching callback can settle a previously mismatched Pending deposit. Assert ledger reconstruction of the final balance.
- Test that a failed multirow write leaves all related state unchanged when a practical failure seam exists. Avoid tests that merely mirror validation or internal implementation.
- In the PSP design note, specify sanitized provider fixtures for valid and invalid signatures, each status vocabulary, minor-unit amounts, missing or mismatched currency, and stale or repeated delivery. Run a shared settlement contract with a fake provider; CI need not call a live PSP.

## Out of Scope

- Building the human approval or rejection workflow for Pending withdrawals. A future rejection must return funds with a uniquely tied compensating ledger credit.
- Implementing dozens of PSP adapters or a production provider registry in this exercise; their interfaces, configuration, and test approach belong in the design note.
- Client creation-request idempotency keys. The stated request contracts remain valid, and the risk of a client retry creating a second deposit or withdrawal is recorded for follow-up.
- Full double-entry accounting, multiple wallet currencies, currency conversion, wager reversals, and automated reconciliation scheduling.
- Authentication, deployment, queue infrastructure, Docker hardening, UI, and exhaustive tests of trivial behavior.

## Further Notes

- The exercise is timeboxed to about four hours. A submission should include a concise decision note explaining locking, schema choices, known gaps, future work, and AI assistance, plus a one-page PSP design note with a sketch. Incomplete implementation should be described honestly at the limit.
- The mock PSP supplies no signature scheme. Runtime signature verification for it is not specified; the PSP design note defines where verification belongs for real providers.
- Lifetime turnover carryover follows the exercise's literal cumulative rule. It may weaken the intended anti-abuse control when earlier wagering satisfies a later deposit; this assumption should be explicit in the decision note.
- The ledger can detect and explain a balance discrepancy, but periodic reconciliation does not prevent every incorrect decision before detection. Production monitoring and alerting need a defined frequency and response.
