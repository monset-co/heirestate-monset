// The signed-in admin (their admin_users row), for any page that needs it.
import { createContext, useContext } from "react";

export const Me = createContext(null);
export const useMe = () => useContext(Me);
