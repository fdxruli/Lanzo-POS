function parsePostgresArrayLiteral(value) {
  if (value === '{}') return [];
  if (typeof value !== 'string' || value.length < 2 || value[0] !== '{' || value.at(-1) !== '}') {
    throw new TypeError('PostgreSQL ACL must be a brace-delimited array literal');
  }

  const entries = [];
  let entry = '';
  let quotedArrayEntry = false;
  let arrayEntryClosed = false;

  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index];

    if (quotedArrayEntry) {
      if (character === '\\') {
        index += 1;
        if (index >= value.length - 1) throw new TypeError('Invalid escape at end of PostgreSQL ACL array');
        entry += value[index];
      } else if (character === '"') {
        quotedArrayEntry = false;
        arrayEntryClosed = true;
      } else {
        entry += character;
      }
      continue;
    }

    if (arrayEntryClosed && character !== ',') {
      throw new TypeError('Unexpected characters after a quoted PostgreSQL ACL array entry');
    }

    if (character === ',') {
      entries.push(entry);
      entry = '';
      arrayEntryClosed = false;
    } else if (character === '"' && entry.length === 0) {
      quotedArrayEntry = true;
    } else if (character === '\\') {
      index += 1;
      if (index >= value.length - 1) throw new TypeError('Invalid escape at end of PostgreSQL ACL array');
      entry += value[index];
    } else {
      entry += character;
    }
  }

  if (quotedArrayEntry) throw new TypeError('Unterminated quoted PostgreSQL ACL array entry');
  entries.push(entry);
  return entries;
}

export function canonicalizePostgresAcl(value) {
  if (value === '<default>') return ['<default>'];
  return parsePostgresArrayLiteral(value).sort();
}
