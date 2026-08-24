import type { LayoutServerLoad } from './$types';
import { appVersion } from '$lib/server/version';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: locals.user,
    version: appVersion,
    // Opt-out for a public self-host that does not want its visitors' browsers
    // talking to github.com. Anything other than the exact 'off' keeps it on.
    updateCheck: process.env.UPDATE_CHECK !== 'off'
  };
};
