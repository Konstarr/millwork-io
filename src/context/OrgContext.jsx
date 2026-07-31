import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './AuthContext.jsx';

/**
 * Loads the orgs the current user belongs to and tracks which one is "active."
 * All queries against org-scoped tables should filter by activeOrg.id.
 *
 * Persists the active org id in localStorage so refreshes stay in the same
 * workspace the estimator was last working in.
 */
const OrgContext = createContext({
  orgs: [],
  activeOrg: null,
  setActiveOrg: () => {},
  refresh: async () => {},
  loading: true,
});

const LS_KEY = 'millwork.activeOrgId';

export function OrgProvider({ children }) {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState([]);
  const [activeOrg, setActive] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setOrgs([]); setActive(null); setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('memberships')
      .select('role, org:org_id (id, name, slug)')
      .order('created_at', { ascending: true });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[millwork.io] Could not load memberships:', error.message);
      setOrgs([]); setActive(null); setLoading(false);
      return;
    }
    const list = (data || [])
      .map((row) => row.org && { ...row.org, role: row.role })
      .filter(Boolean);
    setOrgs(list);
    const savedId = localStorage.getItem(LS_KEY);
    const preferred = list.find((o) => o.id === savedId) || list[0] || null;
    setActive(preferred);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const setActiveOrg = (org) => {
    setActive(org);
    if (org?.id) localStorage.setItem(LS_KEY, org.id);
    else localStorage.removeItem(LS_KEY);
  };

  return (
    <OrgContext.Provider value={{ orgs, activeOrg, setActiveOrg, refresh: load, loading }}>
      {children}
    </OrgContext.Provider>
  );
}

export const useOrg = () => useContext(OrgContext);
