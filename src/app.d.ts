import type { User } from '$lib/server/auth-session';

declare global {
  namespace App {
    interface Locals { user: User | null }
    interface PageData {}
    interface Platform {}
  }
}

export {};
