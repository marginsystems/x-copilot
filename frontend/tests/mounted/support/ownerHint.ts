export const OWNER_HINT = "0123456789abcdef0123456789abcdef";
export const OTHER_OWNER_HINT = "fedcba9876543210fedcba9876543210";

export function setOwnerCookie(hint: string): void {
  document.cookie = `xc_owner=${hint}; path=/`;
}

export function clearOwnerCookie(): void {
  document.cookie = "xc_owner=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}
