import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type * as T from './types';

export const qk = {
  today: (bu: string) => ['today', bu] as const,
  alerts: (bu: string) => ['alerts', bu] as const,
  items: (bu: string, p?: unknown) => ['bu-items', bu, p] as const,
  levels: (bu: string) => ['levels', bu] as const,
  count: (id: string) => ['count', id] as const,
  counts: (bu: string, p?: unknown) => ['counts', bu, p] as const,
  lots: (bu: string, p?: unknown) => ['lots', bu, p] as const,
  movements: (bu: string, p?: unknown) => ['movements', bu, p] as const,
  instruments: (bu: string) => ['instruments', bu] as const,
  snapshots: (bu: string, p?: unknown) => ['snapshots', bu, p] as const,
  history: (bu: string, id: string) => ['history', bu, id] as const,
  bus: ['bus'] as const,
  catalogue: (kind: string, p?: unknown) => ['catalogue', kind, p] as const,
};

export function useToday(bu: string) { return useQuery({ queryKey: qk.today(bu), queryFn: () => api.get<T.Today>(`/api/v1/bus/${bu}/counts/today`), refetchInterval: 60_000, enabled: !!bu }); }
export function useAlerts(bu: string) { return useQuery({ queryKey: qk.alerts(bu), queryFn: () => api.get<T.Alerts>(`/api/v1/bus/${bu}/alerts`), enabled: !!bu }); }
export function useBuItems(bu: string, p?: { include_inactive?: boolean; low_only?: boolean; instrument_id?: string }) {
  return useQuery({ queryKey: qk.items(bu, p), queryFn: () => api.get<T.BuItem[]>(`/api/v1/bus/${bu}/items`, p), enabled: !!bu });
}
export function useLevels(bu: string) { return useQuery({ queryKey: qk.levels(bu), queryFn: () => api.get<T.BuItem[]>(`/api/v1/bus/${bu}/levels`), enabled: !!bu }); }
export function useCount(id?: string) { return useQuery({ queryKey: qk.count(id ?? ''), queryFn: () => api.get<T.CountDetail>(`/api/v1/counts/${id}`), enabled: !!id }); }
export function useCounts(bu: string, p?: { from?: string; to?: string; session?: string; status?: string; limit?: number }) {
  return useQuery({ queryKey: qk.counts(bu, p), queryFn: () => api.get<T.CountHeader[]>(`/api/v1/bus/${bu}/counts`, p), enabled: !!bu });
}
export function useLots(bu: string, p?: { bu_item_id?: string; status?: string; expiring_within_days?: number }) {
  return useQuery({ queryKey: qk.lots(bu, p), queryFn: () => api.get<T.Lot[]>(`/api/v1/bus/${bu}/lots`, p), enabled: !!bu });
}
export function useMovements(bu: string, p?: { from?: string; to?: string; type?: string; bu_item_id?: string; limit?: number }) {
  return useQuery({ queryKey: qk.movements(bu, p), queryFn: () => api.get<T.Movement[]>(`/api/v1/bus/${bu}/movements`, p), enabled: !!bu });
}
export function useInstruments(bu: string) { return useQuery({ queryKey: qk.instruments(bu), queryFn: () => api.get<T.Instrument[]>(`/api/v1/bus/${bu}/instruments`), enabled: !!bu }); }
export function useHistory(bu: string, id?: string) { return useQuery({ queryKey: qk.history(bu, id ?? ''), queryFn: () => api.get<T.ItemHistory>(`/api/v1/bus/${bu}/items/${id}/history`), enabled: !!bu && !!id }); }
export function useSnapshots(bu: string, p: { period_type: string; period_start?: string; rebuild?: boolean }) {
  return useQuery({ queryKey: qk.snapshots(bu, p), queryFn: () => api.get<T.SnapshotSet>(`/api/v1/bus/${bu}/snapshots`, p), enabled: !!bu });
}
export function useBus(include_inactive?: boolean) { return useQuery({ queryKey: [...qk.bus, include_inactive], queryFn: () => api.get<T.BusinessUnit[]>('/api/v1/bus', { include_inactive }) }); }
export function useCatalogueItems(p?: { kind?: string; instrument_model_id?: string; q?: string; include_inactive?: boolean; general_only?: boolean }) {
  return useQuery({ queryKey: qk.catalogue('items', p), queryFn: () => api.get<T.Item[]>('/api/v1/catalogue/items', p) });
}
export function useModels(include_inactive?: boolean) { return useQuery({ queryKey: qk.catalogue('models', include_inactive), queryFn: () => api.get<T.InstrumentModel[]>('/api/v1/catalogue/instrument-models', { include_inactive }) }); }
export function useSuppliers(include_inactive?: boolean) { return useQuery({ queryKey: qk.catalogue('suppliers', include_inactive), queryFn: () => api.get<T.Supplier[]>('/api/v1/catalogue/suppliers', { include_inactive }) }); }

/** Invalidate everything that depends on stock in a BU after a write. */
export function useInvalidateBu(bu: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['today', bu] }); qc.invalidateQueries({ queryKey: ['alerts', bu] });
    qc.invalidateQueries({ queryKey: ['bu-items', bu] }); qc.invalidateQueries({ queryKey: ['levels', bu] });
    qc.invalidateQueries({ queryKey: ['counts', bu] }); qc.invalidateQueries({ queryKey: ['lots', bu] });
    qc.invalidateQueries({ queryKey: ['movements', bu] }); qc.invalidateQueries({ queryKey: ['snapshots', bu] });
    qc.invalidateQueries({ queryKey: ['history', bu] }); qc.invalidateQueries({ queryKey: ['instruments', bu] });
  };
}

export function useApiMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, onSuccess?: (r: TResult, a: TArgs) => void) {
  return useMutation({ mutationFn: fn, onSuccess });
}
