# Stage 5.3A — coherent layaway reads (HOLD until isolated validation)

Candidate: `supabase/migrations/20261126020000_layaway_coherent_read_v1.sql`.
Production was consulted read-only: PostgreSQL 17.6, ledger 369.
Original normalized definition MD5: get 570f28b1e06c106f9ad073e03b7cf551, pull 7a9382f6e4eefc6a6d51859cb9767bc3, frontier 51dae0e6767b826bf015ac09117aa7aa.
The exact normalized old definitions and execution context are in the rollback and isolated catalog fixture. The migration embeds preflight and postflight definition/owner/ACL/volatility/search-path checks, aborts on drift, and changes only the two existing public readers in a transaction. It retains the volatile auth/frontier calls; the aggregate is assembled in one statement using the existing stable serializers. A later visible event affecting a delivered aggregate defers the entire page with the previous cursor; unrelated later relevant events request a follow-up without advancing beyond the safe frontier. No new tables, locks on commercial rows, grants, mutation changes or frontend consumer.

## Validation

Existing PR338 financial fixture; the exact two installed readers, seven commercial executor/reservation functions, frontier allocator/locks/writer, guards and serialization helpers are overlaid from read-only catalog capture. The legacy fixture's schema/auth and other dependency functions are reused; no claim of full current Production schema parity. Tests invoke the actual private commercial executors with validated Admin context (not the public financial dispatcher), and both RPCs as anon/authenticated. Test-only serializer wrappers block on a real advisory lock; the observer must see the reader waiting before the second connection commits. No sleep-only race. After the fix the same aggregate must match the prior committed state and the next read the new committed state. A separate frontier barrier exercises a commit between frontier capture and statement snapshot. The fixture has no Production records or credentials. Run via existing focal GitHub Actions job; SHA-256 printed by the runner. Test-only wrappers restored before rollback.

## Installation / rollback (not authorized)

1. Recheck exact HEAD, Production ledger/version, file SHA-256 and that the migration is absent. Compare installed definitions/ACL against migration preflight. Do not use general db push.
2. Only after explicit installation authorization, apply the exact canonical migration as postgres. Its transaction aborts on drift or timeout. Verify ledger entry, function hashes/ACL, no unrelated changes; keep PR traceable.
3. If rollback explicitly authorized, run the guarded `docs/sync/20261126020000_layaway_coherent_read_v1.rollback.sql` against the exact installed candidate, not general rollback or ledger deletion. The rollback verifies both candidate and restored definitions. A subsequent migration/ledger reconciliation requires separate approval.
4. QA 5.3B and two-device business acceptance are separate; do not merge or install merely because CI is green.
