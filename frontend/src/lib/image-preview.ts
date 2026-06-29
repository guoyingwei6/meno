export const getImagePreviewUrl = (url: string, width = 720): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/cdn-cgi/image/width=${width},quality=75,format=auto/${url}`;
  } catch {
    return url;
  }
};
