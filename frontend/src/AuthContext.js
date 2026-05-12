import { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // sessionStorage clears when the browser tab/window closes,
  // so every fresh app start will require login.
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('rfid_user') || 'null');
    } catch {
      return null;
    }
  });

  const login = (user) => {
    setCurrentUser(user);
    sessionStorage.setItem('rfid_user', JSON.stringify(user));
  };

  const logout = () => {
    setCurrentUser(null);
    sessionStorage.removeItem('rfid_user');
  };

  return (
    <AuthContext.Provider value={{ currentUser, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
