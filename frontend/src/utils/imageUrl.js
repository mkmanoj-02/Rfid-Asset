const API_BASE = (process.env.REACT_APP_API_BASE_URL || 'http://localhost:5004').replace(/\/+$/, '');

/** Resolve /uploads/... paths to absolute URLs for <img src>. */
export function resolveImageUrl(imageUrl) {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (imageUrl.startsWith('/')) return `${API_BASE}${imageUrl}`;
  return `${API_BASE}/${imageUrl}`;
}

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Inline SVG placeholder when location/asset has no image */
export const PLACEHOLDER_IMAGE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
      <rect fill="#f1f5f9" width="400" height="300"/>
      <text x="200" y="150" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="16">No image</text>
    </svg>`
  );

export function validateImageFile(file) {
  if (!file) return null;
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
  if (!ALLOWED_IMAGE_TYPES.includes(file.type) && !ALLOWED_IMAGE_EXT.includes(ext)) {
    return 'Allowed formats: JPG, JPEG, PNG, WEBP';
  }
  if (file.size > MAX_IMAGE_BYTES) return 'Image must be 5MB or smaller';
  return null;
}
