import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import '../../../store/installEcommerceOrderStore';
import { useAppStore } from '../../../store/useAppStore';
import { canAccessEcommerceOrders } from '../../../services/ecommerce/ecommerceOrderCapabilities';
import {
  canPrepareEcommercePosDraft,
  getEcommercePosContextIdentity
} from '../../../services/ecommerce/ecommercePosDraftService';
import { installEcommercePosActiveOrderGuards } from '../../../services/ecommerce/installEcommercePosActiveOrderGuards';
import { useActiveOrders } from '../../../hooks/pos/useActiveOrders';

installEcommercePosActiveOrderGuards();

const getLicenseIdentity = (licenseDetails = {}) => (
  licenseDetails?.license_key
  || licenseDetails?.licenseKey
  || licenseDetails?.details?.license_key
  || licenseDetails?.details?.licenseKey
  || null
);

export default function EcommerceOrdersRuntime() {
  const location = useLocation();
  const timerRef = useRef(null);
  const previousLicenseRef = useRef(null);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const loadSummary = useAppStore((state) => state.loadEcommerceOrderSummary);
  const refreshOrders = useAppStore((state) => state.refreshEcommerceOrders);
  const invalidateOrders = useAppStore((state) => state.invalidateEcommerceOrdersCache);
  const resetOrders = useAppStore((state) => state.resetEcommerceOrdersState);

  const staffSession = { currentDeviceRole, currentStaffUser };
  const canAccess = canAccessEcommerceOrders(licenseDetails, staffSession);
  const licenseIdentity = getLicenseIdentity(licenseDetails);
  const pageIsOpen = location.pathname.startsWith('/pedidos-online');
  const posContextState = { licenseDetails, currentDeviceRole, currentStaffUser };
  const posContextIdentity = getEcommercePosContextIdentity(posContextState);
  const canPrepareInPos = canPrepareEcommercePosDraft(posContextState);

  useEffect(() => {
    useActiveOrders.getState().pruneEcommerceDraftsForContext({
      licenseIdentity: posContextIdentity,
      canPrepare: canPrepareInPos
    });
  }, [canPrepareInPos, posContextIdentity]);

  useEffect(() => {
    if (previousLicenseRef.current && previousLicenseRef.current !== licenseIdentity) resetOrders?.();
    previousLicenseRef.current = licenseIdentity;
    if (!canAccess || !licenseIdentity) {
      resetOrders?.();
      return undefined;
    }
    loadSummary?.({ background: true });
    return undefined;
  }, [canAccess, licenseIdentity, loadSummary, resetOrders]);

  useEffect(() => () => { resetOrders?.(); }, [resetOrders]);

  useEffect(() => {
    if (!canAccess) return undefined;
    const refreshOnResume = () => {
      if (document.visibilityState === 'hidden') return;
      loadSummary?.({ background: true });
      if (pageIsOpen) refreshOrders?.({ background: true });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshOnResume();
    };
    window.addEventListener('focus', refreshOnResume);
    window.addEventListener('pageshow', refreshOnResume);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', refreshOnResume);
      window.removeEventListener('pageshow', refreshOnResume);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [canAccess, loadSummary, pageIsOpen, refreshOrders]);

  useEffect(() => {
    if (!canAccess) return undefined;
    const handleRealtime = () => {
      invalidateOrders?.();
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(async () => {
        timerRef.current = null;
        await loadSummary?.({ force: true, background: true });
        if (pageIsOpen) await refreshOrders?.({ background: true });
      }, 600);
    };
    window.addEventListener('lanzo:ecommerce-orders-changed', handleRealtime);
    return () => {
      window.removeEventListener('lanzo:ecommerce-orders-changed', handleRealtime);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [canAccess, invalidateOrders, loadSummary, pageIsOpen, refreshOrders]);

  return null;
}
