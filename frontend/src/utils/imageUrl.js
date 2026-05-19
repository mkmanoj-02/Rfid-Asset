const API_BASE = (process.env.REACT_APP_API_BASE_URL || 'http://localhost:5004').replace(/\/+$/, '');

/** Resolve /uploads/... paths to absolute URLs for <img src>. */
export function resolveImageUrl(imageUrl) {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (imageUrl.startsWith('/')) return `${API_BASE}${imageUrl}`;
  return `${API_BASE}/${imageUrl}`;
}

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
export const ALLOWED_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];

/** Branding logo — same formats, shown at original aspect ratio (no conversion). */
export const BRANDING_IMAGE_TYPES = ALLOWED_IMAGE_TYPES;
export const BRANDING_IMAGE_EXT = ALLOWED_IMAGE_EXT;
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

/** Small placeholder for asset table thumbnails (32×32) */
export const TABLE_THUMB_PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect fill="#f1f5f9" width="32" height="32"/>
      <text x="16" y="18" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="7">No image</text>
    </svg>`
  );

export function validateImageFile(file, { types = ALLOWED_IMAGE_TYPES, ext = ALLOWED_IMAGE_EXT } = {}) {
  if (!file) return null;
  const fileExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
  if (!types.includes(file.type) && !ext.includes(fileExt)) {
    return `Allowed formats: ${ext.map((e) => e.replace('.', '').toUpperCase()).join(', ')}`;
  }
  if (file.size > MAX_IMAGE_BYTES) return 'Image must be 5MB or smaller';
  return null;
}

export function validateBrandingImageFile(file) {
  return validateImageFile(file, { types: BRANDING_IMAGE_TYPES, ext: BRANDING_IMAGE_EXT });
}
