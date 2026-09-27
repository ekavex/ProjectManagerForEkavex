/**
 * Pagination helpers.
 *
 * Every list endpoint uses these, so no endpoint can accidentally return an unbounded
 * collection (master prompt section 65).
 */
import type { PageMeta, Pagination } from '@ekavist/shared';

export function paginate(query: Pagination): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function pageMeta(query: Pagination, total: number): PageMeta {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
  };
}

export function emptyPage<T>(query: Pagination): { data: T[]; meta: PageMeta } {
  return { data: [], meta: pageMeta(query, 0) };
}
