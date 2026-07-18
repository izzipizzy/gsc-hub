import { fail, error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import {
  listUsers, createUser, deleteUser, setPassword, setRole, getUserByEmail, countAdmins,
  type Role
} from '$lib/server/auth-session';
import { requireAdmin } from '$lib/server/guard';

const asRole = (v: FormDataEntryValue | null): Role => (v === 'admin' ? 'admin' : 'manager');

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  return { users: listUsers(db()) };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    requireAdmin(locals);
    const f = await request.formData();
    const email = String(f.get('email') ?? '');
    const password = String(f.get('password') ?? '');
    if (!email || password.length < 6) return fail(400, { error: 'email и пароль (мин. 6) обязательны' });
    if (getUserByEmail(db(), email)) return fail(409, { error: 'email уже существует' });
    await createUser(db(), { email, password, role: asRole(f.get('role')) });
    return { ok: true };
  },
  setPassword: async ({ request, locals }) => {
    requireAdmin(locals);
    const f = await request.formData();
    const id = String(f.get('id') ?? '');
    const password = String(f.get('password') ?? '');
    if (password.length < 6) return fail(400, { error: 'пароль мин. 6 символов' });
    await setPassword(db(), id, password);
    return { ok: true };
  },
  setRole: async ({ request, locals }) => {
    requireAdmin(locals);
    const f = await request.formData();
    const id = String(f.get('id') ?? '');
    const role = asRole(f.get('role'));
    if (role !== 'admin' && countAdmins(db()) <= 1) {
      const target = listUsers(db()).find((u) => u.id === id);
      if (target?.role === 'admin') return fail(400, { error: 'нельзя снять последнего админа' });
    }
    setRole(db(), id, role);
    return { ok: true };
  },
  delete: async ({ request, locals }) => {
    requireAdmin(locals);
    const f = await request.formData();
    const id = String(f.get('id') ?? '');
    if (id === locals.user!.id) return fail(400, { error: 'нельзя удалить себя' });
    deleteUser(db(), id);
    return { ok: true };
  }
};
