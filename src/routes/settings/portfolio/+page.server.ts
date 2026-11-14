import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { portfolio } from '$lib/server/portfolio';
import { invalidateTop } from '$lib/server/portfolio-top';
import { GSC_MAX_ROW_LIMIT, QUERY_ROW_BUDGET, AUTO_QUERY_ROWS, saveTopRows, topRowsSetting } from '$lib/server/portfolio-settings';

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  const { slots } = await portfolio.get(db(), { wait: false });
  const sites = slots.length;
  return {
    sites,
    queries: topRowsSetting(db(), 'queries', sites),
    pages: topRowsSetting(db(), 'pages', sites),
    max: GSC_MAX_ROW_LIMIT,
    budget: QUERY_ROW_BUDGET,
    autoRange: AUTO_QUERY_ROWS
  };
};

export const actions: Actions = {
  save: async ({ locals, request }) => {
    requireAdmin(locals);
    const form = await request.formData();
    try {
      for (const kind of ['queries', 'pages'] as const) {
        const raw = form.get(kind);
        if (typeof raw === 'string') saveTopRows(db(), kind, raw);
      }
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    // The next read of the Top blocks collects rows again with the new limits.
    invalidateTop();
    return { saved: true };
  }
};
