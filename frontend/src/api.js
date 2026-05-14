import axios from 'axios';

const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL || 'http://localhost:5004').replace(/\/+$/, '');

const api = axios.create({ baseURL: `${API_BASE_URL}/api` });

// Attach current user_id to all requests automatically
api.interceptors.request.use(config => {
  try {
    // Use sessionStorage (app switched from localStorage)
    const user = JSON.parse(sessionStorage.getItem('rfid_user') || 'null');
    if (user?.id) {
      config.params = { ...config.params, user_id: user.id };
      config.headers = config.headers || {};
      config.headers['x-username'] = user.username || '';
      config.headers['x-user-id'] = String(user.id);
    }
  } catch {}
  return config;
});

export default api;

export const getLocations = () => api.get('/locations');
export const getLocationTree = () => api.get('/locations/tree');
export const createLocation = (data) => api.post('/locations', data);
export const updateLocation = (id, data) => api.put(`/locations/${id}`, data);
export const deleteLocation = (id) => api.delete(`/locations/${id}`);

export const getAssetTypes = () => api.get('/asset-types');
export const createAssetType = (data) => api.post('/asset-types', data);
export const updateAssetType = (id, data) => api.put(`/asset-types/${id}`, data);
export const deleteAssetType = (id) => api.delete(`/asset-types/${id}`);

/** Unique attribute definitions (name / type) for column picker — GET /api/attribute-list */
export const getAttributeList = (params) => api.get('/attribute-list', { params: params || {} });

export const getAttributes = (typeId) => api.get(`/asset-types/${typeId}/attributes`);
export const createAttribute = (typeId, data) => api.post(`/asset-types/${typeId}/attributes`, data);
export const updateAttribute = (typeId, attrId, data) => api.put(`/asset-types/${typeId}/attributes/${attrId}`, data);
export const deleteAttribute = (typeId, attrId) => api.delete(`/asset-types/${typeId}/attributes/${attrId}`);

export const getAssets = (params) => api.get('/assets', { params });
export const createAsset = (data) => api.post('/assets', data);
export const updateAsset = (id, data) => api.put(`/assets/${id}`, data);
export const deleteAsset = (id) => api.delete(`/assets/${id}`);
export const bulkDeleteAssets = (ids) => axios.delete(`${API_BASE_URL}/api/assets/bulk`, { data: { ids } });
export const getAssetAttributes = (id) => api.get(`/assets/${id}/attributes`);
export const saveAssetAttributes = (id, values) => api.put(`/assets/${id}/attributes`, { values });

export const getRfidTags = () => api.get('/rfid/tags');
export const removeRfidTag = (tag) => api.delete(`/rfid/tags/${encodeURIComponent(tag)}`);

export const getMovements = (asset_id) =>
  api.get('/movements', { params: asset_id ? { asset_id } : {} });
export const getAssetMovements = (asset_id) => api.get(`/movements/asset/${asset_id}`);

/** @param {number|string|null|undefined} locationId - when set, GET /dashboard?location=… scopes metrics to that site */
export const getDashboard = (locationId) =>
  api.get('/dashboard', {
    params: locationId != null && locationId !== '' ? { location: locationId } : {},
  });

export const previewImport = (type, rows) => api.post(`/import/${type}/preview`, { rows });
export const executeImport = (type, rows) => api.post(`/import/${type}/execute`, { rows });

export const getLocationTypes = () => api.get('/location-types');
export const createLocationType = (data) => api.post('/location-types', data);
export const updateLocationType = (id, data) => api.put(`/location-types/${id}`, data);
export const deleteLocationType = (id) => api.delete(`/location-types/${id}`);

export const getTagTypes = () => api.get('/tag-types');
export const createTagType = (data) => api.post('/tag-types', data);
export const updateTagType = (id, data) => api.put(`/tag-types/${id}`, data);
export const deleteTagType = (id) => api.delete(`/tag-types/${id}`);

export const getVendors = () => api.get('/vendors');
export const createVendor = (data) => api.post('/vendors', data);
export const updateVendor = (id, data) => api.put(`/vendors/${id}`, data);
export const deleteVendor = (id) => api.delete(`/vendors/${id}`);
