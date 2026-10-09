# Backend Lead Wallet

This context tracks a member's wallet funds, deposits, wagers, withdrawals, and the turnover that governs withdrawals.

## Language

**Member**:
A person who owns one wallet and can deposit, wager, and request withdrawals.

**Wallet**:
A member's account for funds available to wager or withdraw.

**Ledger entry**:
An immutable record of a change to a wallet's funds.

**Deposit**:
A request to add funds to a member's wallet through a payment service provider. A deposit is completed when the payment is accepted and the wallet is credited.
_Avoid_: Funding transaction

**Payment service provider (PSP)**:
An external provider that reports the outcome of a deposit payment.

**Wager**:
An accepted stake paid from a member's wallet that accrues turnover.

**Turnover requirement**:
The cumulative amount a member must wager before withdrawing, increased by each completed deposit according to its turnover multiplier.

**Accrued turnover**:
The cumulative amount of a member's accepted wagers. Earlier wagering continues to count toward later deposits.

**Outstanding turnover**:
The positive difference between a member's turnover requirement and accrued turnover.

**Withdrawal**:
A request to pay funds out of a member's wallet. Its amount leaves the wallet when the request is created.
_Avoid_: Funding transaction
