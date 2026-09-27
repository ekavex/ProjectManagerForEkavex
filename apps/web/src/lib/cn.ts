/**
 * Class name helper.
 *
 * `clsx` concatenates; it does not understand that `w-56` and `w-full` are the same
 * property. Without a merge, a caller passing `className="w-56"` to a control whose base
 * styles include `w-full` gets whichever rule the stylesheet happens to order last —
 * which is how every filter input ended up full width. `twMerge` resolves the conflict in
 * favour of the caller, which is what a `className` prop is for.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
