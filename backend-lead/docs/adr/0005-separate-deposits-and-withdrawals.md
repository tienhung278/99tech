# Store deposits and withdrawals separately

Deposits and withdrawals both move money across the platform boundary, but they have different fields, validation, and lifecycles. Separate records make each state machine explicit and avoid a shared table full of conditional or nullable columns. The shared concept is a wallet movement, not a generic funding transaction type.
