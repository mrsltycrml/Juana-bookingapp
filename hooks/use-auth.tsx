import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/database";

interface AuthValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  profileError: string;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    setProfileError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setProfile(null);
      return;
    }
    const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    if (error) {
      setProfileError(error.message);
      throw error;
    }
    setProfile(data as Profile);
    setProfileError("");
  }, []);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!active) return;
        setSession(currentSession);
        if (currentSession) await refreshProfile();
      } catch (error) {
        console.error("Unable to restore the signed-in profile", error);
      } finally {
        if (active) setLoading(false);
      }
    };
    void initialize();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) { setProfile(null); setProfileError(""); }
      else setTimeout(() => {
        void refreshProfile().catch((error: unknown) => console.error("Unable to load profile", error));
      }, 0);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, profile, loading, profileError, refreshProfile, signOut }),
    [session, profile, loading, profileError, refreshProfile, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
