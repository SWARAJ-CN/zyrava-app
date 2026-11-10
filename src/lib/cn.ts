/** Join of truthy class strings — identical to the web `lib/cn.ts`. */
export function cn(...values: Array<string | number | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
