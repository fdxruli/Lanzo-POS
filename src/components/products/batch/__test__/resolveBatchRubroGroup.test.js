import { describe, expect, it } from 'vitest';
import {
  resolveBatchRubroGroup,
  resolveFeatureRubroContext
} from '../utils/resolveBatchRubroGroup';

describe('resolveFeatureRubroContext', () => {
  it('normaliza aliases de restaurante', () => {
    expect(resolveFeatureRubroContext('restaurante')).toBe('food_service');
    expect(resolveFeatureRubroContext('cafeteria')).toBe('food_service');
  });

  it('normaliza aliases de fruteria', () => {
    expect(resolveFeatureRubroContext('fruteria')).toBe('verduleria/fruteria');
    expect(resolveFeatureRubroContext('verduleria')).toBe('verduleria/fruteria');
  });

  it('usa otro cuando no existe rubro', () => {
    expect(resolveFeatureRubroContext(null)).toBe('otro');
    expect(resolveFeatureRubroContext('desconocido')).toBe('otro');
  });
});

describe('resolveBatchRubroGroup', () => {
  it('resuelve grupo pharmacy', () => {
    expect(resolveBatchRubroGroup('farmacia')).toBe('pharmacy');
    expect(resolveBatchRubroGroup('consultorio')).toBe('pharmacy');
  });

  it('resuelve grupo fruteria', () => {
    expect(resolveBatchRubroGroup('verduleria/fruteria')).toBe('fruteria');
  });

  it('resuelve grupo retail por default', () => {
    expect(resolveBatchRubroGroup('apparel')).toBe('retail');
    expect(resolveBatchRubroGroup(undefined)).toBe('retail');
  });
});
