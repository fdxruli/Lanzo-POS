import { describe, expect, it } from 'vitest';
import { getAvailableAgentTools } from '../agentToolRegistry';

const toolIdsFor = (businessTypes) => getAvailableAgentTools({
  agentType: 'financialAnalyst',
  businessTypes
}).map((tool) => tool.id);

describe('agentToolRegistry business type routing', () => {
  it('routes food service aliases to restaurant tools', () => {
    expect(toolIdsFor(['food_service'])).toContain('restaurant.upsellLeakage');
    expect(toolIdsFor(['dark-kitchen'])).toContain('restaurant.upsellLeakage');
  });

  it('routes verduleria/fruteria through food operations instead of falling back silently', () => {
    expect(toolIdsFor(['verduleria/fruteria'])).toContain('operations.wasteImpact');
    expect(toolIdsFor(['fruteria'])).toContain('operations.wasteImpact');
  });

  it('routes pharmacy aliases to pharmacy-compatible tools', () => {
    const pharmacyTools = toolIdsFor(['pharmacy']);
    expect(pharmacyTools).toContain('finance.salesPulse');
    expect(pharmacyTools).not.toContain('restaurant.upsellLeakage');
  });
});

