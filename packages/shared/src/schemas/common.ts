import { z } from 'zod';

/** Entity identifiers are cuids produced by Prisma. */
export const idSchema = z.string().min(1).max(64);

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/**
 * Password policy. Long enough to matter, without the character-class rules that push
 * people towards `Password1!`.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(200, 'Password must be at most 200 characters.');

/** A calendar date with no time component, e.g. a due date. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format.');

/** An instant. Accepts any ISO-8601 string the runtime can parse. */
export const instantSchema = z.string().datetime({ offset: true });

export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Expected an IANA timezone name, for example Asia/Kolkata.' },
  );

export const urlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'Only http and https links are accepted.',
  });

export const percentSchema = z.number().int().min(0).max(100);

export const hoursSchema = z.number().min(0).max(100000);

export const MAX_PAGE_SIZE = 100;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

export type Pagination = z.infer<typeof paginationSchema>;

export const sortDirectionSchema = z.enum(['asc', 'desc']).default('asc');

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

/**
 * Builds a query schema whose `sort` is restricted to an allow-list. Anything else is a
 * validation error rather than a string handed to the database.
 */
export function sortableQuery<const T extends readonly [string, ...string[]]>(
  fields: T,
  fallback: T[number],
) {
  return paginationSchema.extend({
    sort: z.enum(fields).default(fallback as T[number]),
    direction: sortDirectionSchema,
  });
}

/** Trimmed, non-empty short text such as a name or title. */
export function shortText(max = 200) {
  return z.string().trim().min(1).max(max);
}

/** Optional longer free text; empty strings become undefined so blanks are not stored. */
export function longText(max = 10000) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional();
}
