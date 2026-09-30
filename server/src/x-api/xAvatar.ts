export function enlargeXAvatarUrl(url: string): string {
  return url.replace(/_normal(\.[a-zA-Z0-9]+)?$/, (_m, ext: string | undefined) =>
    ext ? `_400x400${ext}` : "_400x400",
  );
}
