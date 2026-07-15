export const resolveEcommerceProductAvailability = ({
  manualAvailable = true,
  sourceAvailable = true,
  requiresConfiguration = false
} = {}) => (
  manualAvailable === true
  && sourceAvailable === true
  && requiresConfiguration !== true
);
