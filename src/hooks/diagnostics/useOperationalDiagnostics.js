import { useEffect, useMemo, useState } from 'react';
import {
  buildDiagnosticResult,
  DEFAULT_BUSINESS_TIMEZONE,
  DIAGNOSTIC_TYPES,
  getDiagnosticPeriod,
  resolveDiagnosticSource
} from '../../services/diagnostics/diagnosticCalculations';
import { diagnosticLocalRepository } from '../../services/diagnostics/diagnosticLocalRepository';

const EMPTY_ARRAY = [];

export const useOperationalDiagnostics = ({
  diagnosticType,
  dateRange,
  timezone = DEFAULT_BUSINESS_TIMEZONE,
  sales = EMPTY_ARRAY,
  menu = EMPTY_ARRAY,
  customers = EMPTY_ARRAY,
  wasteLogs = EMPTY_ARRAY,
  reportSource = null,
  refreshKey = 0
} = {}) => {
  const [now] = useState(() => new Date());
  const [supplements, setSupplements] = useState({ batches: [], inventoryEvents: [] });
  const [isSupplementLoading, setIsSupplementLoading] = useState(diagnosticType === DIAGNOSTIC_TYPES.INVENTORY);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    if (diagnosticType !== DIAGNOSTIC_TYPES.INVENTORY) {
      setSupplements({ batches: [], inventoryEvents: [] });
      setIsSupplementLoading(false);
      return () => { active = false; };
    }

    setIsSupplementLoading(true);
    diagnosticLocalRepository.getInventorySupplements()
      .then((result) => {
        if (!active) return;
        setSupplements(result);
        setError(null);
      })
      .catch((reason) => {
        if (!active) return;
        setSupplements({ batches: [], inventoryEvents: [] });
        setError(reason?.message || 'No se pudieron cargar los datos complementarios de inventario.');
      })
      .finally(() => {
        if (active) setIsSupplementLoading(false);
      });

    return () => { active = false; };
  }, [diagnosticType, refreshKey]);

  const period = useMemo(
    () => getDiagnosticPeriod(dateRange, { now, timezone }),
    [dateRange, now, timezone]
  );

  const source = useMemo(() => resolveDiagnosticSource(reportSource, {
    sales,
    products: menu,
    customers,
    wasteLogs
  }), [customers, menu, reportSource, sales, wasteLogs]);

  const calculation = useMemo(() => {
    try {
      return {
        diagnostic: buildDiagnosticResult({
          diagnosticType,
          period,
          timezone,
          source,
          sales,
          menu,
          customers,
          wasteLogs,
          batches: supplements.batches,
          inventoryEvents: supplements.inventoryEvents
        }),
        error: null
      };
    } catch (reason) {
      return {
        diagnostic: null,
        error: reason?.message || 'No se pudo calcular el diagnóstico.'
      };
    }
  }, [customers, diagnosticType, menu, period, sales, source, supplements.batches, supplements.inventoryEvents, timezone, wasteLogs]);

  useEffect(() => {
    setError(calculation.error);
  }, [calculation.error]);

  return {
    diagnostic: calculation.diagnostic,
    period,
    isLoading: isSupplementLoading,
    error
  };
};

export default useOperationalDiagnostics;
