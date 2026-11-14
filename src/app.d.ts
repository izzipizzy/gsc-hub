import type { User } from '$lib/server/auth-session';
import type { Locale, Theme } from '$lib/i18n/locale';

declare global {
  namespace App {
    interface PageState {
    }
    interface Locals { user: User | null; locale: Locale; theme: Theme }
    interface PageData {}
    interface Platform {}
  }
}

export {};
