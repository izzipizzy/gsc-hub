import { sequence } from '@sveltejs/kit/hooks';
import { handle as authHandle } from './auth';
import { authGuard } from '$lib/server/guard';

export const handle = sequence(authGuard, authHandle);
