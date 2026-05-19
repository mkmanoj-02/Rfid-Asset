const ACCESS_KEY = 'rfid_access_token';
const REFRESH_KEY = 'rfid_refresh_token';
const USER_KEY = 'rfid_user';

export function getAccessToken() {
  return sessionStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken() {
  return sessionStorage.getItem(REFRESH_KEY);
}

export function getStoredUser() {
  try {
    return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setAuthSession({ user, accessToken, refreshToken }) {
  if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  if (accessToken) sessionStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) sessionStorage.setItem(REFRESH_KEY, refreshToken);
}

export function updateStoredUser(user) {
  if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function setTokens(accessToken, refreshToken) {
  if (accessToken) sessionStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) sessionStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearAuthSession() {
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}

export function hasAuthSession() {
  return Boolean(getStoredUser() && getRefreshToken());
}
