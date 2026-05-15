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

export function validateImageFile(file) {
  if (!file) return null;
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
  if (!ALLOWED_IMAGE_TYPES.includes(file.type) && !ALLOWED_IMAGE_EXT.includes(ext)) {
    return 'Allowed formats: JPG, JPEG, PNG, WEBP';
  }
  if (file.size > MAX_IMAGE_BYTES) return 'Image must be 5MB or smaller';
  return null;
}
