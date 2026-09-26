export const DEFAULT_AVATAR = "/default-avatar.svg";
export function starFill(rating: number, index: number) {
  return Math.max(0, Math.min(1, (Number.isFinite(rating) ? rating : 0) - index)) * 100;
}
