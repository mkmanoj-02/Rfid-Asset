import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { setOnAuthFailure, logoutRequest } from './api';
import {
  getStoredUser,
  setAuthSession,
  clearAuthSession,
  getRefreshToken,
  hasAuthSession,
} from './authToken';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    if (!hasAuthSession()) {
      clearAuthSession();
      return null;
    }
    return getStoredUser();
  });

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) await logoutRequest(refreshToken);
    } catch {
      /* server logout optional */
    }
    clearAuthSession();
    setCurrentUser(null);
  }, []);

  useEffect(() => {
    setOnAuthFailure(() => {
      setCurrentUser(null);
    });
    return () => setOnAuthFailure(null);
  }, []);

  const login = useCallback((user, accessToken, refreshToken) => {
    setAuthSession({ user, accessToken, refreshToken });
    setCurrentUser(user);
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
