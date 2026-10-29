import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260916083608_license_expired_material_downgrade_r1.sql',
  import.meta.url
);
const sqlTestUrl = new URL(
  '../../supabase/tests/license_expired_material_downgrade_r1_test.sql',
  import.meta.url
);
const sessionConsistencyMigrationUrl = new URL(
  '../../supabase/migrations/20260924143303_license_downgrade_session_consistency_r1.sql',
  import.meta.url
);
const sessionConsistencySqlTestUrl = new URL(
  '../../supabase/tests/license_downgrade_session_consistency_r1_test.sql',
  import.meta.url
);

const [migration, sqlTest, sessionConsistencyMigration, sessionConsistencySqlTest] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(sqlTestUrl, 'utf8'),
  readFile(sessionConsistencyMigrationUrl, 'utf8'),
  readFile(sessionConsistencySqlTestUrl, 'utf8')
]);

const functionBody = (source, qualifiedName) => {
  const start = source.indexOf(`create or replace function ${qualifiedName}`);
  assert.ok(start >= 0, `${qualifiedName} must be versioned`);
  const end = source.indexOf('$function$;', start);
  assert.ok(end > start, `${qualifiedName} must have a complete body`);
  return source.slice(start, end + '$function$;'.length);
};

const financialRelations = new Set([
  'pos_cash_sessions',
  'cash_movements',
  'ledger'
]);
const financialColumns = new Set(['counted_cash', 'closing_counted_amount']);

const sqlWord = (token, value) => token?.kind === 'word' && token.value === value;
const sqlSymbol = (token, value) => token?.kind === 'symbol' && token.value === value;
const sqlIdentifier = (token) => {
  if (token?.kind === 'word') return token.value;
  if (token?.kind === 'quoted_identifier') return token.value;
  return null;
};

const readSqlString = (source, quoteIndex, backslashEscapes) => {
  let value = '';
  let cursor = quoteIndex + 1;

  while (cursor < source.length) {
    const char = source[cursor];
    if (backslashEscapes && char === '\\' && cursor + 1 < source.length) {
      const escaped = source[cursor + 1];
      if (/[0-7]/u.test(escaped)) {
        let digits = escaped;
        cursor += 2;
        while (digits.length < 3 && /[0-7]/u.test(source[cursor] ?? '')) {
          digits += source[cursor];
          cursor += 1;
        }
        value += String.fromCodePoint(Number.parseInt(digits, 8));
        continue;
      }
      if (escaped === 'x') {
        let digits = '';
        cursor += 2;
        while (digits.length < 2 && /[\da-f]/iu.test(source[cursor] ?? '')) {
          digits += source[cursor];
          cursor += 1;
        }
        value += digits ? String.fromCodePoint(Number.parseInt(digits, 16)) : 'x';
        continue;
      }
      if (escaped === 'u' || escaped === 'U') {
        const length = escaped === 'u' ? 4 : 8;
        const digits = source.slice(cursor + 2, cursor + 2 + length);
        if (digits.length !== length || !new RegExp(`^[\\da-f]{${length}}$`, 'iu').test(digits)) {
          throw new Error('Invalid Unicode escape in SQL escape string');
        }
        value += String.fromCodePoint(Number.parseInt(digits, 16));
        cursor += length + 2;
        continue;
      }
      const escapeValues = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      value += escapeValues[escaped] ?? escaped;
      cursor += 2;
      continue;
    }
    if (char === "'") {
      if (source[cursor + 1] === "'") {
        value += "'";
        cursor += 2;
        continue;
      }
      return { value, end: cursor + 1 };
    }
    value += char;
    cursor += 1;
  }

  throw new Error('Unterminated SQL string literal');
};

const readSqlIdentifier = (source, quoteIndex) => {
  let value = '';
  let cursor = quoteIndex + 1;

  while (cursor < source.length) {
    if (source[cursor] === '"') {
      if (source[cursor + 1] === '"') {
        value += '"';
        cursor += 2;
        continue;
      }
      return { value, end: cursor + 1 };
    }
    value += source[cursor];
    cursor += 1;
  }

  throw new Error('Unterminated quoted SQL identifier');
};

const skipSqlBlockComment = (source, start) => {
  let depth = 1;
  let cursor = start + 2;

  while (cursor < source.length && depth > 0) {
    if (source.startsWith('/*', cursor)) {
      depth += 1;
      cursor += 2;
    } else if (source.startsWith('*/', cursor)) {
      depth -= 1;
      cursor += 2;
    } else {
      cursor += 1;
    }
  }

  if (depth !== 0) throw new Error('Unterminated SQL block comment');
  return cursor;
};

const skipSqlTrivia = (source, start) => {
  let cursor = start;
  while (cursor < source.length) {
    if (/\s/u.test(source[cursor])) {
      cursor += 1;
    } else if (source.startsWith('--', cursor)) {
      cursor += 2;
      while (cursor < source.length && source[cursor] !== '\n' && source[cursor] !== '\r') cursor += 1;
    } else if (source.startsWith('/*', cursor)) {
      cursor = skipSqlBlockComment(source, cursor);
    } else {
      break;
    }
  }
  return cursor;
};

const unicodeEscapeCharacter = (source, start) => {
  let cursor = skipSqlTrivia(source, start);
  if (!/^uescape\b/iu.test(source.slice(cursor))) return { character: '\\', end: start };
  cursor = skipSqlTrivia(source, cursor + 'uescape'.length);
  if (source[cursor] !== "'") throw new Error('Invalid UESCAPE clause');
  const escape = readSqlString(source, cursor, false);
  if ([...escape.value].length !== 1 || /[\da-f+'"\s]/iu.test(escape.value)) {
    throw new Error('Invalid UESCAPE character');
  }
  return { character: escape.value, end: escape.end };
};

const decodeUnicodeSqlString = (value, escapeCharacter) => {
  let decoded = '';
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    if (value[cursor] !== escapeCharacter) {
      decoded += value[cursor];
      continue;
    }
    if (value[cursor + 1] === escapeCharacter) {
      decoded += escapeCharacter;
      cursor += 1;
      continue;
    }
    const length = value[cursor + 1] === '+' ? 6 : 4;
    const digitsStart = cursor + (length === 6 ? 2 : 1);
    const digits = value.slice(digitsStart, digitsStart + length);
    if (digits.length !== length || !new RegExp(`^[\\da-f]{${length}}$`, 'iu').test(digits)) {
      throw new Error('Invalid Unicode escape in SQL Unicode string');
    }
    decoded += String.fromCodePoint(Number.parseInt(digits, 16));
    cursor = digitsStart + length - 1;
  }
  return decoded;
};

const isExecutableDollarBody = (tokens) => {
  const significant = tokens.filter((token) => token.kind !== 'literal');
  if (sqlWord(significant[0], 'do')) return true;
  return sqlWord(significant.at(-1), 'as')
    && significant.some((token) => sqlWord(token, 'function') || sqlWord(token, 'procedure'));
};

const isDynamicSqlLiteral = (tokens) => {
  const significant = tokens.filter((token) => token.kind !== 'literal');
  const last = significant.slice(-3);
  return sqlWord(last.at(-1), 'execute')
    || (sqlWord(last.at(-2), 'execute') && sqlSymbol(last.at(-1), '('))
    || (sqlWord(last.at(-3), 'execute')
      && sqlWord(last.at(-2), 'format')
      && sqlSymbol(last.at(-1), '('));
};

/*
 * This is a PostgreSQL-aware lexical guard, not a SQL parser. It checks static
 * DML and literal EXECUTE bodies; variable/format-built EXECUTE fails closed.
 * It does not infer effects of called functions (including trigger functions),
 * views, or triggers.
 */
const scanExecutableSql = (source, { plpgsql = false, dynamic = false } = {}) => {
  const statements = [];
  let statement = [];
  let cursor = 0;

  const finishStatement = () => {
    if (statement.some((token) => token.kind !== 'literal')) {
      statement.dynamic = dynamic;
      statements.push(statement);
    }
    statement = [];
  };

  while (cursor < source.length) {
    if (/\s/u.test(source[cursor])) {
      cursor += 1;
      continue;
    }
    if (source.startsWith('--', cursor)) {
      let newline = cursor + 2;
      while (newline < source.length && source[newline] !== '\n' && source[newline] !== '\r') newline += 1;
      if (newline >= source.length) {
        cursor = source.length;
      } else if (source[newline] === '\r' && source[newline + 1] === '\n') {
        cursor = newline + 2;
      } else {
        cursor = newline + 1;
      }
      continue;
    }
    if (source.startsWith('/*', cursor)) {
      cursor = skipSqlBlockComment(source, cursor);
      continue;
    }

    const stringPrefix = source.slice(cursor).match(/^(?:(?:[eE])|(?:[bBxX])|(?:[uU]&))?'/u)?.[0];
    if (stringPrefix) {
      const prefix = stringPrefix.slice(0, -1);
      const quoteIndex = cursor + prefix.length;
      const parsed = readSqlString(source, quoteIndex, /^e$/iu.test(prefix));
      const unicodeEscape = /^u&$/iu.test(prefix) ? unicodeEscapeCharacter(source, parsed.end) : null;
      const stringValue = unicodeEscape
        ? decodeUnicodeSqlString(parsed.value, unicodeEscape.character)
        : parsed.value;
      if (isExecutableDollarBody(statement)) {
        statements.push(...scanExecutableSql(stringValue, { plpgsql: true, dynamic }));
      } else if (plpgsql && isDynamicSqlLiteral(statement)) {
        statements.push(...scanExecutableSql(stringValue, { dynamic: true }));
      }
      statement.push({ kind: 'literal' });
      cursor = unicodeEscape?.end ?? parsed.end;
      continue;
    }

    if (source[cursor] === '"') {
      const parsed = readSqlIdentifier(source, cursor);
      statement.push({ kind: 'quoted_identifier', value: parsed.value });
      cursor = parsed.end;
      continue;
    }

    const unicodeIdentifierPrefix = source.slice(cursor).match(/^[uU]&"/u)?.[0];
    if (unicodeIdentifierPrefix) {
      const quoteIndex = cursor + unicodeIdentifierPrefix.length - 1;
      const parsed = readSqlIdentifier(source, quoteIndex);
      const escape = unicodeEscapeCharacter(source, parsed.end);
      statement.push({
        kind: 'quoted_identifier',
        value: decodeUnicodeSqlString(parsed.value, escape.character)
      });
      cursor = escape.end;
      continue;
    }

    const dollarDelimiter = source.slice(cursor).match(/^\$([\p{L}_][\p{L}\p{N}_]*)?\$/u)?.[0];
    if (dollarDelimiter) {
      const bodyStart = cursor + dollarDelimiter.length;
      const bodyEnd = source.indexOf(dollarDelimiter, bodyStart);
      if (bodyEnd < 0) throw new Error(`Unterminated dollar-quoted SQL body ${dollarDelimiter}`);
      const body = source.slice(bodyStart, bodyEnd);
      if (isExecutableDollarBody(statement)) {
        statements.push(...scanExecutableSql(body, { plpgsql: true, dynamic }));
      } else if (plpgsql && isDynamicSqlLiteral(statement)) {
        statements.push(...scanExecutableSql(body, { dynamic: true }));
      }
      statement.push({ kind: 'literal' });
      cursor = bodyEnd + dollarDelimiter.length;
      continue;
    }

    if (source[cursor] === ';') {
      finishStatement();
      cursor += 1;
      continue;
    }

    const identifier = source.slice(cursor).match(/^[\p{L}_][\p{L}\p{M}\p{N}_$]*/u)?.[0];
    if (identifier) {
      statement.push({ kind: 'word', value: identifier.toLowerCase() });
      cursor += identifier.length;
      continue;
    }

    statement.push({ kind: 'symbol', value: source[cursor] });
    cursor += 1;
  }

  finishStatement();
  return statements;
};

const mutationTarget = (tokens, operationIndex, operation) => {
  let cursor = operationIndex + 1;
  if (operation === 'insert' || operation === 'merge') {
    if (!sqlWord(tokens[cursor], 'into')) return null;
    cursor += 1;
  } else if (operation === 'delete') {
    if (!sqlWord(tokens[cursor], 'from')) return null;
    cursor += 1;
  } else if (operation === 'truncate' && sqlWord(tokens[cursor], 'table')) {
    cursor += 1;
  }

  if (operation === 'truncate') {
    const relations = [];
    while (cursor < tokens.length) {
      if (sqlWord(tokens[cursor], 'only')) cursor += 1;
      const first = sqlIdentifier(tokens[cursor]);
      if (first === null) break;
      let relation = first;
      cursor += 1;
      if (sqlSymbol(tokens[cursor], '.')) {
        relation = sqlIdentifier(tokens[cursor + 1]);
        if (relation === null) break;
        cursor += 2;
      }
      relations.push(relation);
      if (sqlSymbol(tokens[cursor], '*')) cursor += 1;
      if (!sqlSymbol(tokens[cursor], ',')) break;
      cursor += 1;
    }
    return relations.length > 0 ? { relations, nextIndex: cursor } : null;
  }

  if (sqlWord(tokens[cursor], 'only')) cursor += 1;
  const first = sqlIdentifier(tokens[cursor]);
  if (first === null) return null;

  if (sqlSymbol(tokens[cursor + 1], '.')) {
    const last = sqlIdentifier(tokens[cursor + 2]);
    if (last === null) return null;
    return { relations: [last], nextIndex: cursor + 3 };
  }
  return { relations: [first], nextIndex: cursor + 1 };
};

const writesFinancialColumn = (tokens, operationIndex, operation, target) => {
  const isFinancialColumn = (token) => financialColumns.has(sqlIdentifier(token));

  const assignmentWritesFinancialColumn = (start, end) => {
    let depth = 0;
    let equalsIndex = -1;
    for (let index = start; index < end; index += 1) {
      if (sqlSymbol(tokens[index], '(') || sqlSymbol(tokens[index], '[')) depth += 1;
      if (sqlSymbol(tokens[index], ')') || sqlSymbol(tokens[index], ']')) depth -= 1;
      if (depth === 0 && sqlSymbol(tokens[index], '=')) {
        equalsIndex = index;
        break;
      }
    }
    return equalsIndex >= 0
      && tokens.slice(start, equalsIndex).some((token) => isFinancialColumn(token));
  };

  const assignmentsWriteFinancialColumn = (setIndex, mergeAction = false) => {
    let segmentStart = setIndex + 1;
    let depth = 0;
    for (let index = segmentStart; index < tokens.length; index += 1) {
      const mergeWhen = mergeAction && sqlWord(tokens[index], 'when')
        && (sqlWord(tokens[index + 1], 'matched')
          || (sqlWord(tokens[index + 1], 'not') && sqlWord(tokens[index + 2], 'matched')));
      if (depth === 0 && (['from', 'where', 'returning'].some((clause) => sqlWord(tokens[index], clause)) || mergeWhen)) {
        return assignmentWritesFinancialColumn(segmentStart, index);
      }
      if (sqlSymbol(tokens[index], '(') || sqlSymbol(tokens[index], '[')) depth += 1;
      if (sqlSymbol(tokens[index], ')') || sqlSymbol(tokens[index], ']')) depth -= 1;
      if (depth === 0 && sqlSymbol(tokens[index], ',')) {
        if (assignmentWritesFinancialColumn(segmentStart, index)) return true;
        segmentStart = index + 1;
      }
    }
    return assignmentWritesFinancialColumn(segmentStart, tokens.length);
  };

  const insertColumnsWriteFinancialColumn = (start) => {
    let cursor = start;
    if (sqlSymbol(tokens[cursor], '*')) cursor += 1;
    if (sqlWord(tokens[cursor], 'as')) {
      cursor += 2;
    } else if (sqlIdentifier(tokens[cursor]) !== null
      && !['values', 'select', 'default', 'overriding', 'on'].some((keyword) => sqlWord(tokens[cursor], keyword))) {
      cursor += 1;
    }
    if (!sqlSymbol(tokens[cursor], '(')) return undefined;

    let depth = 0;
    for (let index = cursor; index < tokens.length; index += 1) {
      if (sqlSymbol(tokens[index], '(')) depth += 1;
      if (sqlSymbol(tokens[index], ')')) {
        depth -= 1;
        if (depth === 0) return false;
      }
      if (depth > 0 && isFinancialColumn(tokens[index])) return true;
    }
    return false;
  };

  if (operation === 'update') {
    const setIndex = tokens.findIndex((token, index) => index > operationIndex && sqlWord(token, 'set'));
    return setIndex >= 0 && assignmentsWriteFinancialColumn(setIndex);
  }

  if (operation === 'insert') {
    return insertColumnsWriteFinancialColumn(target.nextIndex);
  }

  if (operation === 'merge') {
    for (let index = operationIndex + 1; index < tokens.length; index += 1) {
      if (sqlWord(tokens[index], 'update') && sqlWord(tokens[index + 1], 'set')) {
        if (assignmentsWriteFinancialColumn(index + 1, true)) return true;
      }
      if (sqlWord(tokens[index], 'insert')) {
        const insertResult = insertColumnsWriteFinancialColumn(index + 1);
        if (insertResult !== false) return insertResult;
      }
    }
  }
  return false;
};

const findFinancialMutation = (source) => {
  const operations = new Set(['update', 'insert', 'delete', 'merge', 'truncate']);

  const isStaticTriggerFunctionInvocation = (tokens, executeIndex) => {
    let cursor = tokens.findIndex((token) => token.kind === 'word');
    if (!sqlWord(tokens[cursor], 'create')) return false;
    cursor += 1;
    if (!sqlWord(tokens[cursor], 'trigger') || sqlIdentifier(tokens[cursor + 1]) === null) return false;

    const triggerExecuteIndex = tokens.findIndex((token, index) => index > cursor && sqlWord(token, 'execute'));
    if (triggerExecuteIndex !== executeIndex) return false;
    cursor = executeIndex + 1;
    if (!sqlWord(tokens[cursor], 'function') && !sqlWord(tokens[cursor], 'procedure')) return false;

    cursor += 1;
    if (sqlIdentifier(tokens[cursor]) === null) return false;
    cursor += 1;
    if (sqlSymbol(tokens[cursor], '.')) {
      cursor += 1;
      if (sqlIdentifier(tokens[cursor]) === null) return false;
      cursor += 1;
      if (sqlSymbol(tokens[cursor], '.')) return false;
    }
    if (!sqlSymbol(tokens[cursor], '(')) return false;

    cursor += 1;
    if (sqlSymbol(tokens[cursor], ')')) return cursor === tokens.length - 1;
    while (cursor < tokens.length) {
      if (tokens[cursor]?.kind !== 'literal') return false;
      cursor += 1;
      if (sqlSymbol(tokens[cursor], ')')) return cursor === tokens.length - 1;
      if (!sqlSymbol(tokens[cursor], ',')) return false;
      cursor += 1;
    }
    return false;
  };

  for (const tokens of scanExecutableSql(source)) {
    const firstWordIndex = tokens.findIndex((token) => token.kind === 'word');
    const isExplain = sqlWord(tokens[firstWordIndex], 'explain');
    const explainCommandIndex = tokens.findIndex((token) => token.kind === 'word'
      && (operations.has(token.value) || sqlWord(token, 'execute')));
    const explainOptions = isExplain && explainCommandIndex >= 0
      ? tokens.slice(firstWordIndex + 1, explainCommandIndex)
      : [];
    const analyzeIndex = explainOptions.findIndex((token) => sqlWord(token, 'analyze'));
    const analyzeValueIndex = analyzeIndex >= 0 && sqlSymbol(explainOptions[analyzeIndex + 1], '=')
      ? analyzeIndex + 2
      : analyzeIndex + 1;
    const analyzeValue = explainOptions[analyzeValueIndex];
    const explainDoesNotExecute = isExplain && (analyzeIndex < 0
      || ['false', 'off', 'no', '0'].some((value) => sqlWord(analyzeValue, value)));

    for (let index = 0; index < tokens.length; index += 1) {
      const operation = tokens[index]?.kind === 'word' && tokens[index].value;
      if (!operations.has(operation)) continue;
      if (explainDoesNotExecute || sqlWord(tokens[firstWordIndex], 'prepare')) continue;
      const target = mutationTarget(tokens, index, operation);
      const protectedRelation = target?.relations.find((relation) => financialRelations.has(relation));
      if (protectedRelation) {
        return `${operation.toUpperCase()} targets protected financial relation ${protectedRelation}`;
      }
      if (tokens.dynamic && !target) {
        return `${operation.toUpperCase()} target in dynamic SQL cannot be resolved statically`;
      }
      if (target) {
        const columnWrite = writesFinancialColumn(tokens, index, operation, target);
        if (columnWrite === undefined) {
          return `${operation.toUpperCase()} column list cannot be resolved statically`;
        }
        if (columnWrite) return `${operation.toUpperCase()} writes a protected financial column`;
      }
    }

    const statementStart = tokens.find((token) => token.kind === 'word');
    if (sqlWord(statementStart, 'grant') || sqlWord(statementStart, 'revoke')) continue;
    for (let index = 0; index < tokens.length; index += 1) {
      if (!sqlWord(tokens[index], 'execute')) continue;
      if (explainDoesNotExecute || sqlWord(tokens[index - 1], 'grant') || sqlWord(tokens[index - 1], 'revoke')) continue;
      if (isStaticTriggerFunctionInvocation(tokens, index)) continue;
      const next = tokens[index + 1];
      if (next?.kind === 'literal') {
        if (sqlSymbol(tokens[index + 2], '||')) {
          return 'dynamic SQL cannot be resolved statically';
        }
        continue;
      }
      if (sqlWord(next, 'format')) {
        return 'dynamic SQL cannot be resolved statically';
      }
      if (sqlSymbol(next, '(') && tokens[index + 2]?.kind === 'literal'
        && sqlSymbol(tokens[index + 3], ')') && !sqlSymbol(tokens[index + 4], '||')) {
        continue;
      }
      return 'dynamic SQL cannot be resolved statically';
    }
  }

  return null;
};

const assertNoFinancialMutation = (source) => {
  const mutation = findFinancialMutation(source);
  assert.ok(!mutation, mutation ?? 'financial state must not be mutated');
};

test('materialization uses the canonical lifecycle after a row lock', () => {
  const body = functionBody(migration, 'private.materialize_expired_license_to_free_v1');
  const lock = body.indexOf('for update of l');
  const entitlement = body.indexOf('private.license_entitlement_state_v1', lock);
  assert.ok(lock >= 0, 'license row must be locked');
  assert.ok(entitlement > lock, 'canonical entitlement must be re-evaluated after lock');
  assert.match(body, /lifecycle_state <> 'expired'/u);
  assert.match(body, /is_entitled is not false/u);
  assert.match(body, /lower\(coalesce\(v_license\.status::text, ''\)\) <> 'active'/u);
});

test('primitive is single-license and has no scheduler or batch behavior', () => {
  const body = functionBody(migration, 'private.materialize_expired_license_to_free_v1');
  assert.match(body, /p_license_id uuid/u);
  assert.doesNotMatch(body, /cron\.|schedule\s*\(/iu);
  assert.doesNotMatch(body, /for\s+v_.*in\s+select[\s\S]*public\.licenses/iu);
  assert.doesNotMatch(migration, /cron\.schedule|insert\s+into\s+cron\.job/iu);
});

test('downgrade is non-destructive and explicitly preserves operational history', () => {
  const body = functionBody(migration, 'private.materialize_expired_license_to_free_v1');
  for (const table of [
    'ecommerce_orders',
    'ecommerce_order_items',
    'ecommerce_order_inventory_reservations',
    'ecommerce_portals',
    'license_staff_users',
    'license_devices'
  ]) {
    assert.doesNotMatch(body, new RegExp(`delete\\s+from\\s+public\\.${table}`, 'iu'));
  }
  assert.match(body, /PLAN_DOWNGRADE_PUBLICATION_LIMIT/u);
  assert.match(body, /display_order asc, pp\.created_at asc, pp\.id asc/u);
  assert.match(sqlTest, /historical\/active order changed/u);
  assert.match(sqlTest, /active reservation changed/u);
});

test('plan hooks use current device_mode and purge residual plan feature keys', () => {
  const snapshot = functionBody(migration, 'public.sync_license_plan_snapshot');
  const limits = functionBody(sessionConsistencyMigration, 'public.enforce_license_plan_limits_after_change');
  assert.match(snapshot, /jsonb_object_keys\(coalesce\(candidate\.features/u);
  assert.match(snapshot, /when v_plan\.code = 'free_trial' then 'free'/u);
  assert.match(limits, /d\.device_mode = 'staff_only'/u);
  assert.match(limits, /when 'admin_only' then 0[\s\S]*when 'shared' then 1/u);
  assert.match(limits, /d\.activated_at asc nulls last/u);
  assert.match(limits, /d\.last_used_at desc nulls last/u);
  assert.match(limits, /d\.id asc/u);
  assert.doesNotMatch(limits, /coalesce\(d\.device_role, 'staff'\)/u);
});

test('phase 2 revokes actor sessions in the same downgrade transaction', () => {
  const limits = functionBody(sessionConsistencyMigration, 'public.enforce_license_plan_limits_after_change');
  const deviceBlock = limits.indexOf("'PLAN_DOWNGRADE_DEVICE_LIMIT'");
  const adminRevoke = limits.indexOf('update public.license_admin_sessions');
  const staffRevokeByDevice = limits.lastIndexOf('update public.license_staff_sessions');

  assert.ok(deviceBlock >= 0, 'device limit block must remain explicit');
  assert.ok(adminRevoke > deviceBlock, 'Admin sessions must be reconciled after the deterministic device set is chosen');
  assert.ok(staffRevokeByDevice > adminRevoke, 'Staff sessions on removed devices must also be reconciled');
  assert.match(limits, /security_token = null/u);
  assert.match(limits, /previous_security_token = null/u);
  assert.match(limits, /d\.id = any\(v_blocked_device_ids\)/u);
  assert.match(limits, /'admin_sessions_revoked', v_admin_sessions_revoked/u);
  assert.match(limits, /'staff_sessions_revoked', v_staff_sessions_revoked/u);
  assert.match(limits, /'blocked_device_ids', to_jsonb\(v_blocked_device_ids\)/u);
  assert.match(limits, /'active_device_ids_after', to_jsonb\(v_active_device_ids\)/u);
});

test('phase 2 historical repair is narrow, idempotent and audit-producing', () => {
  assert.match(sessionConsistencyMigration, /s\.revoked_at is null/u);
  assert.match(sessionConsistencyMigration, /s\.expires_at > now\(\)/u);
  assert.match(sessionConsistencyMigration, /d\.is_active is false/u);
  assert.match(sessionConsistencyMigration, /PLAN_DOWNGRADE_DEVICE_LIMIT/u);
  assert.match(sessionConsistencyMigration, /PLAN_DOWNGRADE_STAFF_NOT_INCLUDED/u);
  assert.match(sessionConsistencyMigration, /license_downgrade_session_consistency_r1_backfill/u);
  assert.match(sessionConsistencyMigration, /PLAN_DOWNGRADE_SESSION_RECONCILED/u);
});

test('financial SQL guard ignores comments mentioning ledger', () => {
  assert.doesNotThrow(() => assertNoFinancialMutation('-- ledger must remain untouched\nselect 1;'));
});

test('financial SQL guard ignores comments mentioning cash_movements', () => {
  assert.doesNotThrow(() => assertNoFinancialMutation('/* cash_movements stay unchanged */ select 1;'));
});

test('financial SQL guard ignores strings and comments inside PL/pgSQL bodies', () => {
  const sql = `
    do $guard$
    begin
      -- ledger is only documentation here
      /* cash_movements /* nested ledger */ remains a comment */
      perform 'cash_movements -- UPDATE public.cash_movements';
      update public.license_devices set is_active = false;
    end;
    $guard$;
  `;
  assert.doesNotThrow(() => assertNoFinancialMutation(sql));
});

test('financial SQL guard ignores SQL-looking single and dollar-quoted data strings', () => {
  const sql = `
    select 'UPDATE public.cash_movements SET amount = 1';
    select $data$ DELETE FROM public.pos_cash_sessions; $data$;
  `;
  assert.doesNotThrow(() => assertNoFinancialMutation(sql));
});

test('financial SQL guard handles escape strings and Unicode dollar tags', () => {
  const sql = String.raw`select E'UPDATE public.cash_movements SET note = \'ledger\''; select $dátos$ DELETE FROM public.pos_cash_sessions; $dátos$;`;
  assert.doesNotThrow(() => assertNoFinancialMutation(sql));
});

test('financial SQL guard ends line comments on CR-only files', () => {
  const sql = '-- ledger comment\rDELETE FROM public.pos_cash_sessions;';
  assert.throws(() => assertNoFinancialMutation(sql), /DELETE targets protected financial relation pos_cash_sessions/u);
});

test('financial SQL guard rejects executable UPDATEs to protected relations', () => {
  const sql = 'do $guard$ begin update /* still SQL */ public.cash_movements set amount = 1; end; $guard$;';
  assert.throws(() => assertNoFinancialMutation(sql), /UPDATE targets protected financial relation cash_movements/u);
});

test('financial SQL guard scans DML in dollar-quoted function bodies', () => {
  const sql = `
    create function public.reconcile_finance() returns trigger language plpgsql as $body$
    begin
      insert into public.ledger (entry) values (1);
      return null;
    end;
    $body$;
  `;
  assert.throws(() => assertNoFinancialMutation(sql), /INSERT targets protected financial relation ledger/u);
});

test('financial SQL guard scans SQL-language procedure bodies', () => {
  const sql = 'create procedure public.reconcile_finance() language sql as $body$ delete from public.pos_cash_sessions; $body$;';
  assert.throws(() => assertNoFinancialMutation(sql), /DELETE targets protected financial relation pos_cash_sessions/u);
});

test('financial SQL guard recognizes case, spacing, comments and quoted relation names', () => {
  const sql = 'UpDaTe /* split */ "public" . "cash_movements" SET amount = 1;';
  assert.throws(() => assertNoFinancialMutation(sql), /UPDATE targets protected financial relation cash_movements/u);
});

test('financial SQL guard decodes Unicode escaped relation and column identifiers', () => {
  const relationSql = String.raw`update U&"public" . U&"cash\005Fmovements" set amount = 1;`;
  const columnSql = String.raw`update public.audit_rows set U&"counted\005Fcash" = 1;`;
  const insertColumnSql = String.raw`insert into U&"audit!005Frows" UESCAPE '!' (counted_cash) values (1);`;
  const unicodeSchemaSql = 'update schéma.cash_movements set amount = 1;';
  assert.throws(() => assertNoFinancialMutation(relationSql), /UPDATE targets protected financial relation cash_movements/u);
  assert.throws(() => assertNoFinancialMutation(columnSql), /UPDATE writes a protected financial column/u);
  assert.throws(() => assertNoFinancialMutation(insertColumnSql), /INSERT writes a protected financial column/u);
  assert.throws(() => assertNoFinancialMutation(unicodeSchemaSql), /UPDATE targets protected financial relation cash_movements/u);
});

test('financial SQL guard does not treat non-executing EXPLAIN as a mutation', () => {
  assert.doesNotThrow(() => assertNoFinancialMutation('EXPLAIN UPDATE public.cash_movements SET amount = 1;'));
  assert.doesNotThrow(() => assertNoFinancialMutation('EXPLAIN (ANALYZE FALSE) UPDATE public.cash_movements SET amount = 1;'));
  assert.doesNotThrow(() => assertNoFinancialMutation('EXPLAIN EXECUTE prepared_financial_change;'));
  assert.doesNotThrow(() => assertNoFinancialMutation("alter default privileges in schema public grant execute on functions to application_role;"));
  assert.doesNotThrow(() => assertNoFinancialMutation('PREPARE later_financial_change AS UPDATE public.cash_movements SET amount = 1;'));
  assert.throws(() => assertNoFinancialMutation('EXECUTE later_financial_change;'), /dynamic SQL cannot be resolved statically/u);
  assert.throws(
    () => assertNoFinancialMutation('EXPLAIN ANALYZE UPDATE public.cash_movements SET amount = 1;'),
    /UPDATE targets protected financial relation cash_movements/u
  );
});

test('financial SQL guard recognizes INSERT, DELETE and MERGE target variants', () => {
  const insertSql = 'iNsErT /* split */ INTO "public" . "ledger" (entry) values (1);';
  const deleteSql = 'DeLeTe /* split */ FROM ONLY "public" . "pos_cash_sessions" where id = 1;';
  const mergeSql = 'MeRgE INTO "public" . "cash_movements" target using source_rows source on target.id = source.id when matched then delete;';
  assert.throws(() => assertNoFinancialMutation(insertSql), /INSERT targets protected financial relation ledger/u);
  assert.throws(() => assertNoFinancialMutation(deleteSql), /DELETE targets protected financial relation pos_cash_sessions/u);
  assert.throws(() => assertNoFinancialMutation(mergeSql), /MERGE targets protected financial relation cash_movements/u);
});

test('financial SQL guard scans executable function bodies stored as strings', () => {
  const sql = "create function public.reconcile_finance() returns trigger language plpgsql as 'begin update public.cash_movements set amount = 1; return null; end;'";
  assert.throws(() => assertNoFinancialMutation(sql), /UPDATE targets protected financial relation cash_movements/u);
});

test('financial SQL guard decodes escaped SQL function body strings', () => {
  const escapeSql = String.raw`create function public.reconcile_finance() returns void language sql as E'\125PDATE public.cash_movements SET amount = 1';`;
  const hexEscapeSql = String.raw`create function public.reconcile_finance() returns void language sql as E'\x55PDATE public.cash_movements SET amount = 1';`;
  const unicodeSql = String.raw`create function public.reconcile_finance() returns void language sql as U&'\0055PDATE public.cash_movements SET amount = 1';`;
  const customUnicodeSql = String.raw`create function public.reconcile_finance() returns void language sql as U&'!0055PDATE public.cash_movements SET amount = 1' UESCAPE '!';`;
  assert.throws(() => assertNoFinancialMutation(escapeSql), /UPDATE targets protected financial relation cash_movements/u);
  assert.throws(() => assertNoFinancialMutation(hexEscapeSql), /UPDATE targets protected financial relation cash_movements/u);
  assert.throws(() => assertNoFinancialMutation(unicodeSql), /UPDATE targets protected financial relation cash_movements/u);
  assert.throws(() => assertNoFinancialMutation(customUnicodeSql), /UPDATE targets protected financial relation cash_movements/u);
});

test('financial SQL guard rejects executable INSERTs to protected relations', () => {
  const sql = 'do $guard$ begin insert into public.ledger (entry) values (1); end; $guard$;';
  assert.throws(() => assertNoFinancialMutation(sql), /INSERT targets protected financial relation ledger/u);
});

test('financial SQL guard rejects executable DELETEs to protected relations', () => {
  const sql = 'do $guard$ begin delete from public.pos_cash_sessions where id = 1; end; $guard$;';
  assert.throws(() => assertNoFinancialMutation(sql), /DELETE targets protected financial relation pos_cash_sessions/u);
});

test('financial SQL guard rejects TRUNCATE lists containing protected relations', () => {
  const sql = 'truncate table public.audit_rows, only public.ledger restart identity;';
  assert.throws(() => assertNoFinancialMutation(sql), /TRUNCATE targets protected financial relation ledger/u);
});

test('financial SQL guard catches protected financial column writes', () => {
  const sql = 'update public.license_devices set (counted_cash, status) = (1, \'blocked\');';
  assert.throws(() => assertNoFinancialMutation(sql), /UPDATE writes a protected financial column/u);
});

test('financial SQL guard does not treat a financial column read as a write', () => {
  const sql = "update public.license_devices set device_info = case when counted_cash = 1 then '{}'::jsonb else '{}'::jsonb end;";
  const arrayRead = 'update public.audit_rows set note = ARRAY[is_active, counted_cash = 1], status = 2;';
  const insertRead = 'insert into public.audit_rows (description) select closing_counted_amount from public.source_rows;';
  const mergeRead = 'merge into public.audit_rows target using public.source_rows source on source.counted_cash = target.counted_cash when matched then update set description = source.description;';
  assert.doesNotThrow(() => assertNoFinancialMutation(sql));
  assert.doesNotThrow(() => assertNoFinancialMutation(arrayRead));
  assert.doesNotThrow(() => assertNoFinancialMutation(insertRead));
  assert.doesNotThrow(() => assertNoFinancialMutation(mergeRead));
});

test('financial SQL guard checks every UPDATE assignment after CASE expressions', () => {
  const sql = "update public.audit_rows set note = case when status = 'x' then 'a' else 'b' end, counted_cash = 1;";
  assert.throws(() => assertNoFinancialMutation(sql), /UPDATE writes a protected financial column/u);
});

test('financial SQL guard recognizes quoted protected financial columns', () => {
  const sql = 'update public.audit_rows set "closing_counted_amount" = 0;';
  assert.throws(() => assertNoFinancialMutation(sql), /UPDATE writes a protected financial column/u);
});

test('financial SQL guard checks aliased INSERT column lists', () => {
  const sql = 'insert into public.audit_rows as audit (closing_counted_amount) values (1);';
  assert.throws(() => assertNoFinancialMutation(sql), /INSERT writes a protected financial column/u);
});

test('financial SQL guard refuses INSERT forms with implicit target columns', () => {
  const insertSql = 'insert into public.audit_rows values (1);';
  const mergeSql = 'merge into public.audit_rows target using public.source_rows source on target.id = source.id when not matched then insert values (1);';
  assert.throws(() => assertNoFinancialMutation(insertSql), /INSERT column list cannot be resolved statically/u);
  assert.throws(() => assertNoFinancialMutation(mergeSql), /MERGE column list cannot be resolved statically/u);
});

test('financial SQL guard checks upsert assignments and ignores column reads', () => {
  const mutation = 'insert into public.audit_rows (id) values (1) on conflict (id) do update set closing_counted_amount = excluded.closing_counted_amount;';
  const readOnly = 'insert into public.audit_rows (id) values (1) on conflict (id) do update set note = excluded.counted_cash;';
  assert.throws(() => assertNoFinancialMutation(mutation), /UPDATE writes a protected financial column/u);
  assert.doesNotThrow(() => assertNoFinancialMutation(readOnly));
});

test('financial SQL guard checks MERGE targets and financial insert columns', () => {
  const protectedTarget = 'merge into public.ledger as target using public.audit_rows as source on target.id = source.id when matched then delete;';
  const protectedColumn = 'merge into public.audit_rows as target using public.source_rows as source on target.id = source.id when not matched then insert (counted_cash) values (source.value);';
  const protectedUpdateColumn = 'merge into public.audit_rows target using public.source_rows source on target.id = source.id when matched then update set closing_counted_amount = source.amount;';
  assert.throws(() => assertNoFinancialMutation(protectedTarget), /MERGE targets protected financial relation ledger/u);
  assert.throws(() => assertNoFinancialMutation(protectedColumn), /MERGE writes a protected financial column/u);
  assert.throws(() => assertNoFinancialMutation(protectedUpdateColumn), /MERGE writes a protected financial column/u);
});

test('financial SQL guard scans direct EXECUTE string literals', () => {
  const sql = `do $guard$ begin execute 'DELETE FROM public.cash_movements WHERE id = 1'; end; $guard$;`;
  const updateSql = `do $guard$ begin execute 'UPDATE public.cash_movements SET amount = 1'; end; $guard$;`;
  const safeSql = "do $guard$ begin execute 'UPDATE public.license_devices SET is_active = false'; end; $guard$;";
  assert.throws(() => assertNoFinancialMutation(sql), /DELETE targets protected financial relation cash_movements/u);
  assert.throws(() => assertNoFinancialMutation(updateSql), /UPDATE targets protected financial relation cash_movements/u);
  assert.doesNotThrow(() => assertNoFinancialMutation(safeSql));
});

test('financial SQL guard refuses to certify variable or format-built EXECUTE targets', () => {
  const variableSql = 'do $guard$ begin execute v_sql; end; $guard$;';
  const formatSql = "do $guard$ begin execute format('UPDATE %I SET amount = 1', v_table); end; $guard$;";
  const concatenatedSql = "do $guard$ begin execute 'UPDATE public.' || v_table || ' SET amount = 1'; end; $guard$;";
  assert.throws(() => assertNoFinancialMutation(variableSql), /dynamic SQL cannot be resolved statically/u);
  assert.throws(() => assertNoFinancialMutation(formatSql), /dynamic SQL cannot be resolved statically/u);
  assert.throws(() => assertNoFinancialMutation(concatenatedSql), /dynamic SQL cannot be resolved statically/u);
});

test('financial SQL guard accepts static trigger EXECUTE FUNCTION syntax', () => {
  const sql = `CREATE TRIGGER reconcile_sessions
    AFTER UPDATE ON public.license_devices
    FOR EACH ROW
    EXECUTE FUNCTION public.reconcile_license_sessions();`;
  assert.doesNotThrow(() => assertNoFinancialMutation(sql));
});

test('financial SQL guard accepts legacy static trigger EXECUTE PROCEDURE syntax', () => {
  const sql = `CREATE TRIGGER reconcile_sessions
    AFTER UPDATE ON public.license_devices
    FOR EACH ROW
    EXECUTE PROCEDURE public.reconcile_license_sessions();`;
  assert.doesNotThrow(() => assertNoFinancialMutation(sql));
});

test('financial SQL guard allows legitimate license, device and session mutations', () => {
  const sql = `
    create or replace function public.reconcile_license_sessions()
    returns trigger language plpgsql as $function$
    begin
      update public.license_devices set is_active = false;
      update public.license_admin_sessions set revoked_at = now();
      update public.license_staff_sessions set revoked_at = now();
      insert into public.license_events (license_key, event_type) values ('test', 'LICENSE_UPDATE');
      return null;
    end;
    $function$;
  `;
  assert.doesNotThrow(() => assertNoFinancialMutation(sql));
});

test('phase 2 never mutates financial state', () => {
  assertNoFinancialMutation(sessionConsistencyMigration);
  assert.match(sessionConsistencySqlTest, /downgrade modified open cash sessions/u);
  assert.match(sessionConsistencySqlTest, /takeover modified open cash sessions/u);
});

test('phase 2 matrix covers sessions, tokens, ranking, retries, tenant isolation and phase 1 recovery', () => {
  for (const marker of [
    'Case A/B/C',
    'Case A/D',
    'Case C',
    'Case E',
    'Case audit',
    'Case F/G',
    'Case tenant isolation',
    'Case Phase 1 regression',
    'Case Phase 1 capacity regression',
    'Case finance',
    'Phase 2 trigger function ACL mismatch'
  ]) {
    assert.ok(sessionConsistencySqlTest.includes(marker), `${marker} coverage must be present`);
  }
  assert.match(sessionConsistencySqlTest, /FREE_DEVICE_TAKEOVER_REQUIRED/u);
  assert.match(sessionConsistencySqlTest, /FREE_DEVICE_TAKEOVER_SUCCESS/u);
  assert.match(sessionConsistencySqlTest, /DEVICE_LIMIT_REACHED/u);
  assert.match(sessionConsistencySqlTest, /begin;/iu);
  assert.match(sessionConsistencySqlTest, /rollback;/iu);
});

test('SQL matrix covers lifecycle, idempotency, limits, history, ACL, and rollback', () => {
  for (const marker of [
    'Case A', 'Case B', 'Case C', 'Case D', 'Case F', 'Cases G/H',
    'Case I', 'Case J', 'Case K', 'Case L', 'Case M',
    'exactly one transition event', 'Materialization primitive ACL mismatch'
  ]) {
    assert.ok(sqlTest.includes(marker), `${marker} coverage must be present`);
  }
  assert.match(sqlTest, /begin;/iu);
  assert.match(sqlTest, /rollback;/iu);
});
