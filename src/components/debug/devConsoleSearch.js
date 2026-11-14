const SEARCHABLE_ENTRY_FIELDS = [
  'text', 'evidence', 'severity', 'code', 'category', 'errorType', 'operation', 'source',
  'filename', 'fileName', 'functionName', 'function',
];
const SEARCHABLE_TECHNICAL_FIELDS = [
  'message', 'name', 'type', 'code', 'stack', 'filename', 'fileName', 'functionName', 'function',
];

const readOwnDataValue = (object, field) => {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;

  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, field);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
};

const appendStringFields = (parts, object, fields) => {
  fields.forEach((field) => {
    const value = readOwnDataValue(object, field);
    if (typeof value === 'string') parts.push(value);
  });
};

export const matchesDevConsoleFilter = (entry, field, expectedValue) => {
  if (field !== 'level' && field !== 'category') return false;
  return readOwnDataValue(entry, field) === expectedValue;
};

// Only inspect allowlisted own string fields; never enumerate or stringify a log payload.
export const buildDevConsoleSearchText = (entry) => {
  const parts = [];
  appendStringFields(parts, entry, SEARCHABLE_ENTRY_FIELDS);
  appendStringFields(parts, readOwnDataValue(entry, 'technical'), SEARCHABLE_TECHNICAL_FIELDS);
  return parts.join(' ').toLowerCase();
};
