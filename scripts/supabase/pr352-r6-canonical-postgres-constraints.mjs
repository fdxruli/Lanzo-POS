import assert from 'node:assert/strict';

const DEFAULT_KITCHEN_CHECK = {
  name: 'pos_preparation_stations_default_code',
  type: 'c',
  definition: "CHECK (is_default IS FALSE OR code = 'kitchen')",
};
const PG_DEPARSED_KITCHEN_CHECK = {
  ...DEFAULT_KITCHEN_CHECK,
  definition: "CHECK (is_default IS FALSE OR code = 'kitchen'::text)",
};

function constraintByName(constraints, name, label) {
  assert.ok(Array.isArray(constraints), `${label} constraints must be an array`);
  const matches = constraints.filter((constraint) => constraint?.name === name);
  assert.equal(matches.length, 1, `${label} must contain exactly one ${name} constraint`);
  return matches[0];
}

function assertCodeColumnIsText(columns, label) {
  assert.ok(Array.isArray(columns), `${label} columns must be an array`);
  const matches = columns.filter((column) => column?.name === 'code');
  assert.equal(matches.length, 1, `${label} must contain exactly one code column`);
  assert.equal(matches[0].type, 'text', `${label} code column must be text before CHECK equivalence is allowed`);
}

/**
 * Compare the full live Cocina catalog with its reviewed manifest. The only
 * accepted deparser spelling difference is the implicit text cast on the
 * exact default-Kitchen CHECK, and only after both catalogs prove code is text.
 */
export function assertEquivalentPreparationStationCatalog(actual, expected) {
  assert.ok(actual && typeof actual === 'object', 'Actual Cocina catalog must be an object');
  assert.ok(expected && typeof expected === 'object', 'Expected Cocina catalog must be an object');
  assert.equal(expected.table?.columns?.length, 18, 'Reviewed Cocina catalog must contain 18 columns');
  assert.equal(expected.table?.constraints?.length, 9, 'Reviewed Cocina catalog must contain nine constraints');
  assert.equal(expected.table?.indexes?.length, 5, 'Reviewed Cocina catalog must contain five indexes');
  assert.equal(expected.triggers?.length, 0, 'Reviewed Cocina catalog must not add user triggers');
  assert.equal(expected.policies?.length, 0, 'Reviewed Cocina catalog must not add policies');
  assert.equal(expected.functions?.length, 6, 'Reviewed Cocina catalog must include six helper functions');
  assert.equal(actual.table?.columns?.length, 18, 'Live Cocina catalog must contain 18 columns');
  assert.equal(actual.table?.constraints?.length, 9, 'Live Cocina catalog must contain nine constraints');
  assert.equal(actual.table?.indexes?.length, 5, 'Live Cocina catalog must contain five indexes');
  assert.equal(actual.triggers?.length, 0, 'Live Cocina catalog must not add user triggers');
  assert.equal(actual.policies?.length, 0, 'Live Cocina catalog must not add policies');
  assert.equal(actual.functions?.length, 6, 'Live Cocina catalog must include six helper functions');

  assertCodeColumnIsText(actual.table.columns, 'Live');
  assertCodeColumnIsText(expected.table.columns, 'Reviewed');

  const expectedCheck = constraintByName(
    expected.table.constraints,
    DEFAULT_KITCHEN_CHECK.name,
    'Reviewed',
  );
  const actualCheck = constraintByName(
    actual.table.constraints,
    DEFAULT_KITCHEN_CHECK.name,
    'Live',
  );
  assert.deepEqual(expectedCheck, DEFAULT_KITCHEN_CHECK,
    'Reviewed manifest must retain the exact default-Kitchen CHECK expression');
  assert.ok(
    actualCheck.type === 'c'
      && (actualCheck.definition === DEFAULT_KITCHEN_CHECK.definition
        || actualCheck.definition === PG_DEPARSED_KITCHEN_CHECK.definition),
    'Live default-Kitchen CHECK must match the reviewed expression, optionally with only PostgreSQL’s redundant text cast',
  );

  let comparableActual = actual;
  if (actualCheck.definition === PG_DEPARSED_KITCHEN_CHECK.definition) {
    comparableActual = {
      ...actual,
      table: {
        ...actual.table,
        constraints: actual.table.constraints.map((constraint) => constraint === actualCheck
          ? { ...constraint, definition: DEFAULT_KITCHEN_CHECK.definition }
          : constraint),
      },
    };
  }

  // Every other field remains byte-for-byte/JSON-value exact: columns,
  // constraints, FKs, indexes, ACL, RLS, triggers, policies, and function rows.
  assert.deepEqual(comparableActual, expected,
    'Cocina catalog differs outside the single reviewed CHECK rendering');
}
