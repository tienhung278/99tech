# 07: Document safe PSP integration

**What to build:** A junior engineer has a concise design for adding a provider without changing shared settlement behavior.

**Blocked by:** None (can start immediately).

**Status:** ready-for-human

- [x] A one-page note and sketch define the adapter, verified canonical event, and shared settlement boundary.
- [x] The note covers provider selection, raw-byte signature checks, status and amount normalization, expected currency, and startup configuration validation.
- [x] The fixture plan covers signatures, status and amount variants, stale events, and a shared fake-provider contract without live CI calls.
- [x] The note distinguishes the unsigned mock callback from real provider verification and keeps secret values outside source control.
