// pg_get_constraintdef may render an implicitly typed string literal as an
// explicit ::text cast. Treat only that deparser spelling as equivalent in
// CHECK constraints; preserve every other catalog field and expression token.
export function canonicalizePostgresConstraints(constraints) {
  if (!Array.isArray(constraints)) {
    throw new TypeError('PostgreSQL constraints must be an array');
  }

  return constraints.map((constraint) => {
    if (!constraint || typeof constraint !== 'object'
      || typeof constraint.name !== 'string'
      || typeof constraint.type !== 'string'
      || typeof constraint.definition !== 'string') {
      throw new TypeError('Each PostgreSQL constraint must include name, type, and definition');
    }

    if (constraint.type !== 'c') return { ...constraint };

    return {
      ...constraint,
      definition: constraint.definition.replace(/'((?:[^']|'')*)'::text\b/g, "'$1'"),
    };
  });
}
