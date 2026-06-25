import { db, STORES } from '../db/dexie';

const REPORT_CACHE_PREFIX = 'reports_cache:';

const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const hashString = (input = '') => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

const buildCacheKey = (reportType, filters = {}) => `${REPORT_CACHE_PREFIX}${reportType}:${hashString(stableStringify(filters || {}))}`;

export const reportsCacheService = {
  buildCacheKey,

  async saveSnapshot(reportType, filters, payload, source = {}) {
    if (!reportType || !payload) return null;
    if (!db.isOpen()) await db.open();

    const record = {
      key: buildCacheKey(reportType, filters),
      value: {
        reportType,
        filtersHash: hashString(stableStringify(filters || {})),
        filters: filters || {},
        payload,
        source,
        generatedAt: new Date().toISOString(),
        stale: false
      }
    };

    await db.table(STORES.SYNC_CACHE).put(record);
    return record.value;
  },

  async getSnapshot(reportType, filters = {}) {
    if (!reportType) return null;
    if (!db.isOpen()) await db.open();

    const record = await db.table(STORES.SYNC_CACHE).get(buildCacheKey(reportType, filters));
    if (!record?.value?.payload) return null;

    return {
      ...record.value,
      stale: true,
      payload: {
        ...record.value.payload,
        source: {
          ...(record.value.payload.source || record.value.source || {}),
          mode: 'cache',
          stale: true
        }
      }
    };
  },

  async invalidateReports() {
    if (!db.isOpen()) await db.open();
    const rows = await db.table(STORES.SYNC_CACHE)
      .filter((row) => String(row?.key || '').startsWith(REPORT_CACHE_PREFIX))
      .toArray();

    if (!rows.length) return 0;
    await db.table(STORES.SYNC_CACHE).bulkDelete(rows.map((row) => row.key));
    return rows.length;
  }
};

export default reportsCacheService;
