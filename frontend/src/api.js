import axios from "axios";
import {
  getAccessToken,
  getRefreshToken,
  getStoredUser,
  setTokens,
  clearAuthSession,
} from "./authToken";

/** API origin — used by axios and all upload image URLs. Local: set REACT_APP_API_BASE_URL=http://localhost:5004 in .env */
export const API_BASE_URL = (
  process.env.REACT_APP_API_BASE_URL || "https://testrfidasset.2cqr.in"
).replace(/\/+$/, "");

// export const API_BASE_URL = (
//   process.env.REACT_APP_API_BASE_URL || "http://localhost:5004"
// ).replace(/\/+$/, "");

const api = axios.create({ baseURL: `${API_BASE_URL}/api` });

/** Plain client for login / refresh (no Bearer interceptor, no 401 retry loop). */
const authClient = axios.create({ baseURL: `${API_BASE_URL}/api` });

let refreshPromise = null;
let onAuthFailure = null;

export function setOnAuthFailure(handler) {
  onAuthFailure = handler;
}

function isAuthRoute(url) {
  if (!url) return false;
  return (
    url.includes("/auth/login") ||
    url.includes("/auth/refresh-token") ||
    url.includes("/auth/logout")
  );
}

/**
 * Backend verifyToken returns 401 when Bearer missing, 403 with code TOKEN_EXPIRED / TOKEN_INVALID for JWT failures.
 */
function shouldAttemptTokenRefresh(error) {
  const status = error.response?.status;
  const code = error.response?.data?.code;
  if (status === 401) return true;
  if (status === 403 && (code === "TOKEN_EXPIRED" || code === "TOKEN_INVALID"))
    return true;
  return false;
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new Error("No refresh token");

    const { data } = await authClient.post("/auth/refresh-token", {
      refreshToken,
    });
    if (!data?.accessToken)
      throw new Error("Refresh response missing accessToken");

    setTokens(data.accessToken, data.refreshToken || refreshToken);
    return data.accessToken;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function forceLogout(reason) {
  if (reason) {
    try {
      sessionStorage.setItem("rfid_logout_reason", reason);
    } catch {
      /* ignore */
    }
  }
  clearAuthSession();
  if (onAuthFailure) onAuthFailure();
}

function isAccountRemovedError(error) {
  return error.response?.data?.code === "USER_NOT_FOUND";
}

api.interceptors.request.use((config) => {
  const accessToken = getAccessToken();
  if (accessToken) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    const user = getStoredUser();
    if (user?.id) {
      config.params = { ...config.params, user_id: user.id };
      config.headers = config.headers || {};
      config.headers["x-username"] = user.username || "";
      config.headers["x-user-id"] = String(user.id);
    }
  } catch {
    /* ignore */
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    if (!original || isAuthRoute(original.url)) {
      return Promise.reject(error);
    }

    if (isAccountRemovedError(error)) {
      forceLogout(
        error.response?.data?.message ||
          "Your account has been removed. Please sign in again.",
      );
      return Promise.reject(error);
    }

    if (!shouldAttemptTokenRefresh(error)) {
      return Promise.reject(error);
    }

    if (original._retry) {
      forceLogout();
      return Promise.reject(error);
    }

    original._retry = true;

    try {
      const newAccessToken = await refreshAccessToken();
      original.headers = original.headers || {};
      original.headers.Authorization = `Bearer ${newAccessToken}`;
      return api(original);
    } catch (refreshErr) {
      if (isAccountRemovedError(refreshErr)) {
        forceLogout(
          refreshErr.response?.data?.message ||
            "Your account has been removed. Please sign in again.",
        );
      } else {
        forceLogout();
      }
      return Promise.reject(error);
    }
  },
);

export default api;

export const loginRequest = (credentials) =>
  authClient.post("/auth/login", credentials);

export const getMe = () => api.get("/auth/me");

export const logoutRequest = (refreshToken) =>
  authClient.post("/auth/logout", { refreshToken });

export const getLocations = () => api.get("/locations");
export const getLocationTree = () => api.get("/locations/tree");
export const getDashboardLocation = (id) =>
  api.get(`/dashboard/location/${id}`);

export function buildLocationFormData(
  fields,
  imageFile,
  { removeImage, confirmGeneratedName } = {},
) {
  const fd = new FormData();
  if (fields.name != null) fd.append("name", fields.name);
  if (fields.description != null) fd.append("description", fields.description);
  if (fields.parent_id != null && fields.parent_id !== "")
    fd.append("parent_id", fields.parent_id);
  if (fields.location_type_id != null && fields.location_type_id !== "") {
    fd.append("location_type_id", fields.location_type_id);
  }
  if (removeImage) fd.append("remove_image", "true");
  if (confirmGeneratedName) fd.append("confirm_generated_name", "true");
  if (imageFile) fd.append("image", imageFile);
  return fd;
}

/** 409 from location create/update: the name exists under another parent and needs confirmation. */
export const isLocationNameConfirm = (err) =>
  err?.response?.status === 409 &&
  err.response.data?.code === "LOCATION_NAME_CONFIRM";

export const createLocationMultipart = (fields, imageFile, opts) =>
  api.post("/locations", buildLocationFormData(fields, imageFile, opts));

export const updateLocationMultipart = (id, fields, imageFile, opts) =>
  api.put(`/locations/${id}`, buildLocationFormData(fields, imageFile, opts));

/** JSON create/update when no image upload */
export const createLocation = (data) => api.post("/locations", data);
export const updateLocation = (id, data) => api.put(`/locations/${id}`, data);
export const deleteLocation = (id) => api.delete(`/locations/${id}`);

export const getAssetTypes = () => api.get("/asset-types");
export const getAssetType = (id) => api.get(`/asset-types/${id}`);
export const createAssetType = (data) => api.post("/asset-types", data);
export const updateAssetType = (id, data) =>
  api.put(`/asset-types/${id}`, data);
export const deleteAssetType = (id) => api.delete(`/asset-types/${id}`);

/** Build FormData for asset type create/update with optional image file. */
export function buildAssetTypeFormData(
  fields,
  imageFile,
  { removeImage } = {},
) {
  const fd = new FormData();
  if (fields.name != null) fd.append("name", fields.name);
  if (fields.description != null) fd.append("description", fields.description);
  if (fields.parent_id != null && fields.parent_id !== "")
    fd.append("parent_id", fields.parent_id);
  if (fields.attributes)
    fd.append("attributes", JSON.stringify(fields.attributes));
  if (removeImage) fd.append("remove_image", "true");
  if (imageFile) fd.append("image", imageFile);
  return fd;
}

export const createAssetTypeMultipart = (fields, imageFile) =>
  api.post("/asset-types", buildAssetTypeFormData(fields, imageFile));

export const updateAssetTypeMultipart = (id, fields, imageFile, opts) =>
  api.put(
    `/asset-types/${id}`,
    buildAssetTypeFormData(fields, imageFile, opts),
  );

/** Build FormData for asset create/update with optional custom image. */
export function buildAssetFormData(
  fields,
  imageFile,
  { removeCustomImage } = {},
) {
  const fd = new FormData();
  const keys = [
    "asset_code",
    "rfid_tag",
    "tag_type_id",
    "vendor_id",
    "name",
    "asset_type_id",
    "current_location_id",
    "status",
    "description",
    "asset_inventory_status",
    "notes",
  ];
  keys.forEach((k) => {
    if (fields[k] !== undefined && fields[k] !== null && fields[k] !== "") {
      fd.append(k, fields[k]);
    }
  });
  if (removeCustomImage) fd.append("remove_custom_image", "true");
  if (imageFile) fd.append("image", imageFile);
  return fd;
}

export const createAssetMultipart = (fields, imageFile) =>
  api.post("/assets", buildAssetFormData(fields, imageFile));

export const updateAssetMultipart = (id, fields, imageFile, opts) =>
  api.put(`/assets/${id}`, buildAssetFormData(fields, imageFile, opts));

/** JSON update (no image) — e.g. location-only changes */
export const updateAsset = (id, data) => api.put(`/assets/${id}`, data);

/** Unique attribute definitions (name / type) for column picker — GET /api/attribute-list */
export const getAttributeList = (params) =>
  api.get("/attribute-list", { params: params || {} });

export const getAttributes = (typeId) =>
  api.get(`/asset-types/${typeId}/attributes`);
export const createAttribute = (typeId, data) =>
  api.post(`/asset-types/${typeId}/attributes`, data);
export const updateAttribute = (typeId, attrId, data) =>
  api.put(`/asset-types/${typeId}/attributes/${attrId}`, data);
export const deleteAttribute = (typeId, attrId) =>
  api.delete(`/asset-types/${typeId}/attributes/${attrId}`);

export const getAssets = (params) => api.get("/assets", { params });
/** Dropdown options: [{ id, name, rfid_tag }, ...]; pass search, location_id, asset_type_id, limit */
export const getAssetDropdown = (params) =>
  api.get("/assets/dropdown", { params });
/** JSON create (no image) — prefer createAssetMultipart when uploading images */
export const createAsset = (data) => api.post("/assets", data);
export const deleteAsset = (id) => api.delete(`/assets/${id}`);
export const bulkDeleteAssets = (ids) =>
  api.delete("/assets/bulk", { data: { ids } });
export const getAssetAttributes = (id) => api.get(`/assets/${id}/attributes`);
export const saveAssetAttributes = (id, values) =>
  api.put(`/assets/${id}/attributes`, { values });

export const getRfidTags = () => api.get("/rfid/tags");
export const removeRfidTag = (tag) =>
  api.delete(`/rfid/tags/${encodeURIComponent(tag)}`);

export const getZones = () => api.get("/zones");

export const getUnassignedTags = (params) =>
  api.get("/unassigned-tags", { params });
export const assignUnassignedTag = (id, assetId) =>
  api.post(`/unassigned-tags/${id}/assign`, { asset_id: assetId });
export const deleteUnassignedTag = (id) => api.delete(`/unassigned-tags/${id}`);

/** @param {number|string|{ asset_id?, search?, page?, limit? }} paramsOrAssetId */
export const getMovements = (paramsOrAssetId) => {
  const params =
    paramsOrAssetId != null &&
    typeof paramsOrAssetId === "object" &&
    !Array.isArray(paramsOrAssetId)
      ? paramsOrAssetId
      : paramsOrAssetId
        ? { asset_id: paramsOrAssetId }
        : {};
  return api.get("/movements", { params });
};
export const getAssetMovements = (asset_id, params) =>
  api.get(`/movements/asset/${asset_id}`, { params: params || {} });

/** @param {number|string|null|undefined} locationId - when set, GET /dashboard?location=… scopes metrics to that site */
export const getDashboard = (locationId) =>
  api.get("/dashboard", {
    params:
      locationId != null && locationId !== "" ? { location: locationId } : {},
  });

export const previewImport = (type, rows) =>
  api.post(`/import/${type}/preview`, { rows });
export const executeImport = (type, rows) =>
  api.post(`/import/${type}/execute`, { rows });

export const getRules = (params) => api.get("/rules", { params });
export const bulkDeleteRules = (ids) =>
  api.delete("/rules/bulk", { data: { ids } });

export const getLocationTypes = () => api.get("/location-types");
export const createLocationType = (data) => api.post("/location-types", data);
export const updateLocationType = (id, data) =>
  api.put(`/location-types/${id}`, data);
export const deleteLocationType = (id) => api.delete(`/location-types/${id}`);

export const getTagTypes = () => api.get("/tag-types");
export const createTagType = (data) => api.post("/tag-types", data);
export const updateTagType = (id, data) => api.put(`/tag-types/${id}`, data);
export const deleteTagType = (id) => api.delete(`/tag-types/${id}`);

/** Asset type → recommended tag type — backend: tagTypes.js */
export const getTagRecommendations = () =>
  api.get("/tag-types/recommendations");
export const getTagRecommendationForAssetType = (assetTypeId) =>
  api.get(`/tag-types/recommend/${assetTypeId}`);
export const saveTagRecommendation = (data) =>
  api.post("/tag-types/recommendations", data);
export const deleteTagRecommendation = (assetTypeId) =>
  api.delete(`/tag-types/recommendations/${assetTypeId}`);

export const getVendors = () => api.get("/vendors");
export const createVendor = (data) => api.post("/vendors", data);
export const updateVendor = (id, data) => api.put(`/vendors/${id}`, data);
export const deleteVendor = (id) => api.delete(`/vendors/${id}`);

/** Handheld / mobile reader devices */
export const getHandheldDevices = () => api.get("/handheld-devices");
export const getHandheldDevice = (id) => api.get(`/handheld-devices/${id}`);
export const createHandheldDevice = (data) =>
  api.post("/handheld-devices", data);
export const updateHandheldDevice = (id, data) =>
  api.put(`/handheld-devices/${id}`, data);
export const deleteHandheldDevice = (id) =>
  api.delete(`/handheld-devices/${id}`);
export const getHandheldDeviceAttributes = (id) =>
  api.get(`/handheld-devices/${id}/attributes`);
export const saveHandheldDeviceAttributes = (id, attributeIds) =>
  api.put(`/handheld-devices/${id}/attributes`, {
    attribute_ids: attributeIds,
  });
export const getHandheldMobileAttributes = (deviceName) =>
  api.get("/handheld-devices/mobile/attributes", {
    params: { device_name: deviceName },
  });

/** Fixed RFID readers */
export const getReaders = () => api.get("/readers");
export const createReader = (data) => api.post("/readers", data);
export const updateReader = (id, data) => api.put(`/readers/${id}`, data);
export const deleteReader = (id) => api.delete(`/readers/${id}`);
/** Public site branding (logo, app name) — no auth required */
export const getSiteBranding = () => authClient.get("/site-branding");

export function buildSiteBrandingFormData(
  fields,
  imageFile,
  { removeLogo, faviconFile, removeFavicon } = {},
) {
  const fd = new FormData();
  if (fields.app_name != null) fd.append("app_name", fields.app_name);
  if (fields.app_subtitle != null)
    fd.append("app_subtitle", fields.app_subtitle);
  if (fields.theme != null) fd.append("theme", fields.theme);
  if (removeLogo) fd.append("remove_logo", "true");
  if (removeFavicon) fd.append("remove_favicon", "true");
  if (imageFile) fd.append("image", imageFile);
  if (faviconFile) fd.append("favicon", faviconFile);
  return fd;
}

export const updateSiteBranding = (fields, imageFile, opts) =>
  api.put(
    "/site-branding",
    buildSiteBrandingFormData(fields, imageFile, opts),
    {
      headers: { "Content-Type": "multipart/form-data" },
    },
  );
