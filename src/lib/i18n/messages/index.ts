// All interface messages: key = Russian text, value = English text.
// Split by area only to keep files readable; the union is one namespace.
import { common } from './common';
import { pages } from './pages';
import { plurals } from './plurals';

export const MESSAGES = { ...common, ...pages } as const;
export type MessageKey = keyof typeof MESSAGES;

export const PLURALS = plurals;
export type PluralKey = keyof typeof PLURALS;
