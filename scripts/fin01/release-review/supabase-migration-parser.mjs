// Lab-only port of Supabase CLI v2.79.0 pkg/parser SplitAndTrim.
// Source: https://github.com/supabase/cli/tree/v2.79.0/pkg/parser
// It preserves statement text, strips terminal semicolons, then trims whitespace.

class ReadyState {
  next(character, data) {
    if (character === '$') return new TagState(data.length - 1);
    if (character === "'" || character === '"') return new QuoteState(character);
    if (character === '-') return new CommentState();
    if (character === '/') return new BlockState();
    if (character === '\\') return new EscapeState();
    if (character === ';') return null;
    if (character === '(') return new AtomicState(new ReadyState(), ')');
    if ((character === 'c' || character === 'C') && data.length >= 6
        && data.slice(-6).toUpperCase() === 'ATOMIC') {
      return new AtomicState(new ReadyState(), 'END');
    }
    return this;
  }
}

class CommentState {
  next(character) {
    if (character === '-') return new DollarState('\n');
    return new ReadyState().next(character, character);
  }
}

class BlockState {
  constructor(depth = 0) { this.depth = depth; }
  next(_character, data) {
    const window = data.slice(-2);
    if (window === '/*') { this.depth += 1; return this; }
    if (this.depth === 0) return new ReadyState().next(data.at(-1), data);
    if (window === '*/') {
      this.depth -= 1;
      if (this.depth === 0) return new ReadyState();
    }
    return this;
  }
}

class QuoteState {
  constructor(delimiter, escaped = false) { this.delimiter = delimiter; this.escaped = escaped; }
  next(character, data) {
    if (this.escaped) {
      if (character === this.delimiter) { this.escaped = false; return this; }
      return new ReadyState().next(character, data);
    }
    if (character === this.delimiter) this.escaped = true;
    return this;
  }
}

class DollarState {
  constructor(delimiter) { this.delimiter = delimiter; }
  next(_character, data) {
    return data.endsWith(this.delimiter) ? new ReadyState() : this;
  }
}

class TagState {
  constructor(offset) { this.offset = offset; }
  next(character, data) {
    if (character === '$') return new DollarState(data.slice(this.offset));
    if (/^[\p{L}\p{N}_]$/u.test(character)) return this;
    return new ReadyState().next(character, data);
  }
}

class EscapeState {
  next() { return new ReadyState(); }
}

class AtomicState {
  constructor(previous, delimiter) { this.previous = previous; this.delimiter = delimiter; }
  next(character, data) {
    const next = this.previous.next(character, data);
    if (next !== null) this.previous = next;
    if (this.previous instanceof ReadyState && data.slice(-this.delimiter.length).toUpperCase() === this.delimiter) {
      return new ReadyState();
    }
    return this;
  }
}

export function splitAndTrim(sql) {
  const statements = [];
  let statement = '';
  let state = new ReadyState();
  for (const character of sql) {
    statement += character;
    state = state.next(character, statement);
    if (state === null) {
      const trimmed = statement.replace(/;+$/u, '').trim();
      if (trimmed) statements.push(trimmed);
      statement = '';
      state = new ReadyState();
    }
  }
  const tail = statement.trim();
  if (tail) statements.push(tail);
  return statements;
}

export function transactionBody(statements, filename) {
  const stripLeadingComments = (input) => input
    .replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/gu, '')
    .trim()
    .toLowerCase();
  const first = statements[0] ?? '';
  const last = statements.at(-1) ?? '';
  if (stripLeadingComments(first) === 'begin' && stripLeadingComments(last) === 'commit') {
    return { statements: statements.slice(1, -1), strippedOuterTransaction: true };
  }
  if (stripLeadingComments(first) === 'begin' || stripLeadingComments(last) === 'commit') {
    throw new Error(`MIGRATION_TRANSACTION_WRAPPER_INCOMPLETE:${filename}`);
  }
  if (statements.some((statement) => /^(?:begin|commit|rollback)\b/iu.test(stripLeadingComments(statement)))) {
    throw new Error(`MIGRATION_TRANSACTION_CONTROL_UNEXPECTED:${filename}`);
  }
  return { statements, strippedOuterTransaction: false };
}
