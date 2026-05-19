import { API_BASE_URL } from '../api';

const UPLOAD_PATH_RE = /^\/(?:api\/)?uploads\//i;

/** Extract /uploads/... path (ignores host — fixes old http://localhost:5004/... in DB). */
function toUploadPath(imageUrl) {
  const raw = String(imageUrl).trim();
  if (!raw) return null;

  if (UPLOAD_PATH_RE.test(raw)) {
    return raw.startsWith('/api/uploads/') ? raw.replace(/^\/api/, '') : raw;
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const pathname = new URL(raw).pathname;
      if (UPLOAD_PATH_RE.test(pathname)) {
        return pathname.startsWith('/api/uploads/')
          ? pathname.replace(/^\/api/, '')
          : pathname;
      }
    } catch {
      return null;
    }
  }

  return null;
}

/** Absolute URL for uploads — always uses API_BASE_URL from api.js. */
export function resolveImageUrl(imageUrl) {
  if (!imageUrl) return null;

  const raw = String(imageUrl).trim();
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;

  const uploadPath = toUploadPath(imageUrl);
  if (uploadPath) return `${API_BASE_URL}${uploadPath}`;

  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${API_BASE_URL}${raw}`;
  return `${API_BASE_URL}/${raw}`;
}

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
export const ALLOWED_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];

export const BRANDING_IMAGE_TYPES = ALLOWED_IMAGE_TYPES;
export const BRANDING_IMAGE_EXT = ALLOWED_IMAGE_EXT;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const PLACEHOLDER_IMAGE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
      <rect fill="#f1f5f9" width="400" height="300"/>
      <text x="200" y="150" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="16">No image</text>
    </svg>`
  );

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
