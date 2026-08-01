begin;

select plan(4);

select is(
  private.ecommerce_source_revision_decision(
    'version',
    1785550194238,
    'version:1785550194238',
    'old-hash',
    'version',
    1785550194238,
    'version:1785550194238',
    'new-image-hash'
  ),
  'apply',
  'legacy epoch-millisecond versions may accept a changed public projection'
);

select is(
  private.ecommerce_source_revision_decision(
    'version',
    5,
    'version:5',
    'old-hash',
    'version',
    5,
    'version:5',
    'different-hash'
  ),
  'conflict',
  'ordinary equal versions remain strict when their payload hashes differ'
);

select is(
  private.ecommerce_source_revision_decision(
    'version',
    1785550194238,
    'version:1785550194238',
    'same-hash',
    'version',
    1785550194238,
    'version:1785550194238',
    'same-hash'
  ),
  'idempotent',
  'legacy timestamp-shaped versions remain idempotent for identical payloads'
);

select is(
  private.ecommerce_source_revision_decision(
    'version',
    1785550194238,
    'version:1785550194238',
    'old-hash',
    'version',
    1785550194237,
    'version:1785550194237',
    'older-hash'
  ),
  'stale',
  'older legacy revisions remain stale'
);

select * from finish();
rollback;
