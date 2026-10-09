# 01: Create a Pending deposit

**What to build:** A member can request a deposit and receive a Pending deposit ID and opaque PSP reference while the wallet remains unchanged.

**Blocked by:** None (can start immediately).

**Status:** ready-for-human

- [x] Creation returns 201 with an ID and database-unique PSP reference associated with the mock provider.
- [x] The Pending deposit has no wallet balance change or ledger entry.
- [x] Amounts are positive, exactly representable decimal strings; the nonnegative integer multiplier defaults to one and accepts zero.
- [x] Invalid precision, overflow, or multiplier creates no deposit; an HTTP test against PostgreSQL demonstrates the successful path.
