import { useState, useEffect, useCallback, useRef } from "react";

// ─── Supabase Client ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://xddbvtbkfvbumiwimrwr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkZGJ2dGJrZnZidW1pd2ltcndyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MzU4NjAsImV4cCI6MjA5NjQxMTg2MH0.hvFAtNrb-uj8ELVmzvaseglwLNK930LaHFiZQflRBa8";

// ─── PayHere Config ───────────────────────────────────────────────────────────
const PAYHERE_MERCHANT_ID = "1230064"; // Replace with real merchant ID
const PAYHERE_SANDBOX = true; // Set false for production

const sb = (() => {
  const h = { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY };
  const auth = (token) => token ? { ...h, Authorization: `Bearer ${token}` } : h;
  const signUp = async (email, password, name) => {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, { method: "POST", headers: h, body: JSON.stringify({ email, password, data: { full_name: name }, options: { data: { full_name: name } } }) });
    return r.json();
  };
  const signIn = async (email, password) => {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: h, body: JSON.stringify({ email, password }) });
    return r.json();
  };
  const refreshToken = async (refresh_token) => {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: h, body: JSON.stringify({ refresh_token }) });
    return r.json();
  };
  const signOut = async (token) => { await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: auth(token) }); };
  const getUser = async (token) => { const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: auth(token) }); return r.json(); };
  // Sends a "reset your password" email containing a recovery link. Supabase
  // redirects back to redirectTo with #access_token=...&type=recovery in the
  // URL fragment, which App() picks up to show the "set new password" screen.
  const recoverPassword = async (email, redirectTo) => {
    const qs = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
    const r = await fetch(`${SUPABASE_URL}/auth/v1/recover${qs}`, { method: "POST", headers: h, body: JSON.stringify({ email }) });
    if (r.status === 204) return {};
    return r.json().catch(() => ({}));
  };
  // Sets a new password using the short-lived recovery access_token from the
  // email link (not the user's normal session token).
  const updatePassword = async (recoveryToken, password) => {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { method: "PUT", headers: auth(recoveryToken), body: JSON.stringify({ password }) });
    return r.json();
  };
  const query = async (table, params = "", token = null, method = "GET", body = null) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { method, headers: { ...auth(token), "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 204) return { data: [], error: null };
    const data = await r.json();
    if (Array.isArray(data)) return { data, error: null };
    if (data && data.error) return { data: null, error: data };
    if (!r.ok) return { data: null, error: { message: data?.message || `HTTP ${r.status}` } };
    return { data, error: null };
  };
  // Calls a Postgres function (RPC), e.g. get_vendor_blocked_dates.
  const rpc = async (fnName, args = {}, token = null) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, { method: "POST", headers: { ...auth(token), "Content-Type": "application/json" }, body: JSON.stringify(args) });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { data: null, error: { message: data?.message || `HTTP ${r.status}` } };
    return { data, error: null };
  };
  return { signUp, signIn, signOut, getUser, query, rpc, refreshToken, recoverPassword, updatePassword };
})();

// ─── PayHere Integration ──────────────────────────────────────────────────────
function initiatePayHerePayment({ booking, vendor, user, onSuccess, onError }) {
  // Load PayHere SDK
  const existingScript = document.getElementById("payhere-sdk");
  if (!existingScript) {
    const script = document.createElement("script");
    script.id = "payhere-sdk";
    script.src = PAYHERE_SANDBOX
      ? "https://www.sandbox.payhere.lk/pay/assets/static/payhere.bundle.js"
      : "https://www.payhere.lk/pay/assets/static/payhere.bundle.js";
    document.head.appendChild(script);
    script.onload = () => doPayment();
  } else {
    doPayment();
  }

  function doPayment() {
    const payment = {
      sandbox: PAYHERE_SANDBOX,
      merchant_id: PAYHERE_MERCHANT_ID,
      return_url: window.location.href,
      cancel_url: window.location.href,
      notify_url: `${SUPABASE_URL}/functions/v1/payhere-notify`,
      order_id: booking.id,
      items: `Evara Booking: ${vendor?.name || "Service"} - ${booking.package || "Standard"}`,
      amount: (booking.amount || 0).toFixed(2),
      currency: "LKR",
      hash: "", // In production: generate server-side SHA256 hash
      first_name: user?.user_metadata?.full_name?.split(" ")[0] || "Customer",
      last_name: user?.user_metadata?.full_name?.split(" ").slice(1).join(" ") || "",
      email: user?.email || "",
      phone: user?.user_metadata?.phone || "0771234567",
      address: booking.location || "Sri Lanka",
      city: "Colombo",
      country: "Sri Lanka",
      custom_1: booking.id,
      custom_2: user?.id,
    };

    if (typeof payhere !== "undefined") {
      payhere.onCompleted = function (orderId) {
        onSuccess && onSuccess(orderId);
      };
      payhere.onDismissed = function () {
        // User closed payment
      };
      payhere.onError = function (error) {
        onError && onError(error);
      };
      payhere.startPayment(payment);
    } else {
      // Sandbox fallback: simulate payment success for demo
      setTimeout(() => onSuccess && onSuccess(booking.id), 1500);
    }
  }
}

// ─── Design Tokens ────────────────────────────────────────────────────────────
// Two palettes; `B` itself is a single mutable object whose keys get
// reassigned when the theme toggles, so every existing `B.xxx` reference
// throughout the file (inline styles, no CSS classes) picks up the new
// colors automatically on the next render — no need to thread theme as a
// prop through 60+ components.
const LIGHT_PALETTE = {
  primary: "#1C2B4B", accent: "#D4AF6A", accentSoft: "#FBF5E9",
  success: "#1A9B6C", danger: "#D94040", warning: "#D97706",
  bg: "#F5F4F1", surface: "#FFFFFF", border: "#E4E1D9",
  text: "#1C2B4B", textMuted: "#7A7D8C", textLight: "#B0B3C1", dark: "#0C1628",
};
const DARK_PALETTE = {
  primary: "#5B7FD4", accent: "#D4AF6A", accentSoft: "#26314B",
  success: "#2BC796", danger: "#F0605F", warning: "#F0A93F",
  bg: "#0B1322", surface: "#141E33", border: "#26314B",
  text: "#EDEFF5", textMuted: "#9099B5", textLight: "#5A6481", dark: "#0C1628",
};

const THEME_STORAGE_KEY = "evara_theme";
const getStoredTheme = () => {
  try { return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light"; } catch { return "light"; }
};

// Read the stored preference synchronously at module load (before first
// render) so the very first paint already uses the right palette instead of
// flashing light-then-dark for returning users.
let currentThemeMode = getStoredTheme();
const B = { ...(currentThemeMode === "dark" ? DARK_PALETTE : LIGHT_PALETTE) };
const themeListeners = new Set();

function applyTheme(mode) {
  currentThemeMode = mode;
  const palette = mode === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
  Object.assign(B, palette);
  try { localStorage.setItem(THEME_STORAGE_KEY, mode); } catch {}
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", mode);
    document.documentElement.style.colorScheme = mode;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute("content", mode === "dark" ? DARK_PALETTE.dark : LIGHT_PALETTE.bg);
  }
  themeListeners.forEach(fn => fn(mode));
}

// Hook: re-renders the calling component whenever the theme changes, and
// returns [mode, toggle]. Call once near the top of the app.
function useTheme() {
  const [mode, setMode] = useState(currentThemeMode);
  useEffect(() => {
    const listener = (m) => setMode(m);
    themeListeners.add(listener);
    return () => themeListeners.delete(listener);
  }, []);
  const toggle = useCallback(() => applyTheme(currentThemeMode === "dark" ? "light" : "dark"), []);
  return [mode, toggle];
}

const STATUS_STYLE = {
  pending:           { bg: "#FFFBEB", c: "#D97706", label: "Pending" },
  confirmed:         { bg: "#EDFAF4", c: "#1A9B6C", label: "Confirmed" },
  paid:              { bg: "#E8F5FF", c: "#0369A1", label: "Payment Received" },
  release_requested: { bg: "#FFF4E5", c: "#C05621", label: "Release Requested" },
  released:          { bg: "#EDFAF4", c: "#1A9B6C", label: "Payment Released" },
  completed:         { bg: "#F0F4FF", c: "#3B4FCC", label: "Completed" },
  cancelled:         { bg: "#FEF2F2", c: "#D94040", label: "Cancelled" },
};

const CAT_LABELS = {
  chefs: "Personal Chef", catering: "Catering", wedding: "Wedding Hall",
  party: "Party Hall", sports: "Indoor Sports", djs: "DJ & Music",
  photographers: "Photography", vendors: "Event Vendor",
  florists: "Florist & Decorator", makeup: "Makeup Artist",
  videography: "Videographer", cakes: "Cake & Bakery",
  event_planners: "Event Planner", transport: "Transport & Limo",
  outdoor_venues: "Outdoor Venue", lighting_av: "Lighting & AV",
  kids_entertainment: "Kids Entertainment",
};
const CAT_EMOJI = {
  chefs: "👨‍🍳", catering: "🍽️", wedding: "💒", party: "🎉",
  sports: "🏸", djs: "🎧", photographers: "📷", vendors: "🎪",
  florists: "💐", videography: "🎬", makeup: "💄", event_planners: "📋",
  cakes: "🎂", transport: "🚗", outdoor_venues: "🌿", lighting_av: "💡",
  kids_entertainment: "🎪",
};

// Professional category icon component — replaces emojis in the customer-facing UI
function getCatIcon(catId, size = 22, color = "currentColor") {
  const s = size, c = color;
  const props = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: c, strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" };
  switch (catId) {
    case "chefs":         return <svg {...props}><path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/></svg>;
    case "catering":      return <svg {...props}><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>;
    case "wedding":       return <svg {...props}><path d="M3 22V12h18v10M2 12l10-9 10 9"/><rect x="9" y="16" width="6" height="6"/></svg>;
    case "party":         return <svg {...props}><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01M22 2l-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="M5 3 3.5 5.5M13 5.08l1.53 2.65M20.5 10l-2.5 1.5"/></svg>;
    case "sports":        return <svg {...props}><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>;
    case "djs":           return <svg {...props}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="22"/></svg>;
    case "photographers": return <svg {...props}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>;
    case "florists":      return <svg {...props}><path d="M12 22V12"/><path d="M12 12C10 10 8 7 8 5a4 4 0 0 1 8 0c0 2-2 5-4 7z"/><path d="M12 12c-2 2-5 3-7 3"/><path d="M12 12c2 2 5 3 7 3"/></svg>;
    case "makeup":        return <svg {...props}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>;
    case "videography":   return <svg {...props}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>;
    case "cakes":         return <svg {...props}><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2 1 2 1"/><path d="M2 21h20M12 2v4M8 4l1 7M16 4l-1 7"/></svg>;
    case "event_planners":return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 15l2 2 4-4"/></svg>;
    case "transport":     return <svg {...props}><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>;
    case "outdoor_venues":return <svg {...props}><path d="M3 17l4-8 4 4 4-6 4 10H3z"/><path d="M3 21h18"/></svg>;
    case "lighting_av":   return <svg {...props}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
    case "kids_entertainment": return <svg {...props}><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>;
    case "all":           return <svg {...props}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>;
    default:              return <svg {...props}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
  }
}
const CATEGORIES = [
  { id: "all", label: "All", tint: "#F0EDE6" },
  { id: "wedding", label: "Wedding Halls", tint: "#F3E9DC" },
  { id: "party", label: "Party Halls", tint: "#EFE3F0" },
  { id: "chefs", label: "Chefs", tint: "#FBE9E2" },
  { id: "catering", label: "Catering", tint: "#FCEFD8" },
  { id: "djs", label: "DJ & Music", tint: "#E5E6F5" },
  { id: "photographers", label: "Photo & Video", tint: "#E2EDE9" },
  { id: "sports", label: "Indoor Sports", tint: "#E1EEF6" },
  { id: "florists", label: "Florists & Decor", tint: "#F2E8EE" },
  { id: "makeup", label: "Makeup Artists", tint: "#FBE5EA" },
  { id: "videography", label: "Videography", tint: "#E7E5F0" },
  { id: "cakes", label: "Cake & Bakery", tint: "#FDEDEE" },
  { id: "event_planners", label: "Event Planners", tint: "#E6EAF2" },
  { id: "transport", label: "Transport & Limo", tint: "#E9ECEA" },
  { id: "outdoor_venues", label: "Outdoor Venues", tint: "#E7EFE3" },
  { id: "lighting_av", label: "Lighting & AV", tint: "#F5E9D6" },
  { id: "kids_entertainment", label: "Kids Events", tint: "#FCE8E0" },
];
const VENDOR_CATEGORIES = CATEGORIES.filter(c => c.id !== "all");
const SL_LOCATIONS = ["All Locations","Colombo","Kandy","Galle","Negombo","Matara","Jaffna","Kurunegala","Anuradhapura"];
const SL_LOCATION_GROUPS = [
  { region: "Popular", locations: ["Colombo", "Kandy", "Galle", "Negombo"] },
  { region: "Western Province", locations: ["Colombo", "Negombo", "Kalutara", "Gampaha"] },
  { region: "Central Province", locations: ["Kandy", "Nuwara Eliya", "Matale"] },
  { region: "Southern Province", locations: ["Galle", "Matara", "Hambantota"] },
  { region: "Northern Province", locations: ["Jaffna", "Vavuniya", "Kilinochchi"] },
  { region: "North Western", locations: ["Kurunegala", "Puttalam"] },
  { region: "North Central", locations: ["Anuradhapura", "Polonnaruwa"] },
  { region: "Eastern Province", locations: ["Trincomalee", "Batticaloa", "Ampara"] },
  { region: "Uva Province", locations: ["Badulla", "Monaragala"] },
  { region: "Sabaragamuwa", locations: ["Ratnapura", "Kegalle"] },
];
const ADMIN_EMAIL = "judethayaan@gmail.com";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-LK", { day: "numeric", month: "long", year: "numeric" }) : "—";
const shortId = (id) => id ? id.replace(/-/g, "").slice(0, 10).toUpperCase() : "—";
const fmt = (n) => `LKR ${(n||0).toLocaleString()}`;

// ─── Icons ────────────────────────────────────────────────────────────────────
function IcoX()          { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>; }
function IcoSearch()     { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>; }
function IcoStar({ filled }) { return <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? "#D4AF6A" : "none"} stroke="#D4AF6A" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>; }
function IcoMapPin()     { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>; }
function IcoCalendar()   { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>; }
function IcoUsers()      { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }
function IcoChevronLeft(){ return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>; }
function IcoChevronRight(){ return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>; }
function IcoPrint()      { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>; }
function IcoLogOut()     { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>; }
function IcoHome()       { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>; }
function IcoBookmark()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>; }
function IcoUser()       { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function IcoShield()     { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function IcoCheck()      { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IcoUnlock()     { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>; }
function IcoCreditCard() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>; }
function IcoTrendUp()    { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>; }
function IcoRefreshCw()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>; }
function IcoSun()         { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>; }
function IcoMoon()        { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>; }
function IcoLayoutDash()  { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>; }
function IcoBell()        { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>; }
const Icon = { X: IcoX, Search: IcoSearch, Star: IcoStar, MapPin: IcoMapPin, Calendar: IcoCalendar, Users: IcoUsers, ChevronLeft: IcoChevronLeft, ChevronRight: IcoChevronRight, Print: IcoPrint, LogOut: IcoLogOut, Home: IcoHome, Bookmark: IcoBookmark, User: IcoUser, Shield: IcoShield, Check: IcoCheck, Unlock: IcoUnlock, CreditCard: IcoCreditCard, TrendUp: IcoTrendUp, RefreshCw: IcoRefreshCw, Sun: IcoSun, Moon: IcoMoon, LayoutDash: IcoLayoutDash, Bell: IcoBell };

// ─── EvaraLogo ────────────────────────────────────────────────────────────────
function EvaraLogo({ size = "md", dark = false, onClick }) {
  const sizes = { sm: 22, md: 28, lg: 36, xl: 48 };
  const h = sizes[size] || 28; const w = h * 2.8;
  const gold = "#D4AF6A"; const navy = dark ? "#FFFFFF" : "#1C2B4B";
  return (
    <svg width={w} height={h} viewBox="0 0 140 50" fill="none" xmlns="http://www.w3.org/2000/svg" onClick={onClick} role={onClick ? "button" : undefined} aria-label={onClick ? "Go to home" : undefined} style={onClick ? { cursor: "pointer" } : undefined}>
      <polygon points="12,4 22,4 27,14 12,28 -3,14 2,4" fill={gold} opacity="0.15"/>
      <polygon points="12,4 22,4 27,14 12,24 -3,14 2,4" fill="none" stroke={gold} strokeWidth="1.5"/>
      <polygon points="12,10 18,10 21,15 12,22 3,15 6,10" fill={gold} opacity="0.5"/>
      <text x="34" y="36" fontFamily="Georgia, serif" fontSize="32" fontWeight="700" fill={navy} letterSpacing="-1">Ev</text>
      <text x="72" y="36" fontFamily="Georgia, serif" fontSize="32" fontWeight="700" fill={gold} letterSpacing="-1">ara</text>
      <circle cx="134" cy="32" r="3" fill={gold}/>
    </svg>
  );
}

// ─── Global Styles ────────────────────────────────────────────────────────────
const getGlobalStyle = (mode) => {
  const p = mode === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
  const bodyBg = mode === "dark" ? "#070D18" : "#E8E6E0";
  return `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&family=DM+Sans:wght@400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { height: 100%; -webkit-text-size-adjust: 100%; }
  html, body { width: 100%; max-width: 100vw; overflow-x: hidden; }
  body { font-family: 'DM Sans', sans-serif; background: ${bodyBg}; color: ${p.text}; min-height: 100vh; min-height: 100dvh; -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent; overscroll-behavior-y: none; transition: background-color .2s ease; }
  #root { min-height: 100vh; min-height: 100dvh; background: ${p.bg}; }
  input, textarea, select, button { font-family: inherit; }
  input[type="date"] { color-scheme: ${mode}; }
  ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: ${p.border}; border-radius: 4px; }
  @keyframes slideUp { from { transform: translateY(60px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes fadeIn  { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pulse   { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
  @keyframes spin    { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @supports (padding-bottom: env(safe-area-inset-bottom)) { .safe-bottom { padding-bottom: env(safe-area-inset-bottom); } }

  .evara-shell { display: flex; min-height: 100vh; min-height: 100dvh; overflow-x: hidden; width: 100%; max-width: 100vw; }
  .evara-sidebar { width: 256px; flex-shrink: 0; background: #0C1628; display: flex; flex-direction: column; position: fixed; top: 0; left: 0; bottom: 0; z-index: 300; border-right: 1px solid rgba(255,255,255,0.05); }
  .evara-sidebar-logo { padding: 28px 24px 22px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .evara-sidebar-nav { padding: 16px 14px; display: flex; flex-direction: column; gap: 2px; flex: 1; overflow-y: auto; }
  .evara-sidebar-item { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 8px; cursor: pointer; border: none; background: none; color: rgba(255,255,255,0.45); font-size: 13.5px; font-weight: 500; font-family: 'DM Sans', sans-serif; width: 100%; text-align: left; transition: background .15s, color .15s; letter-spacing: 0.1px; }
  .evara-sidebar-item:hover { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.8); }
  .evara-sidebar-item.active { background: rgba(212,175,106,0.1); color: #D4AF6A; font-weight: 600; border-left: 2px solid #D4AF6A; padding-left: 12px; }
  .evara-sidebar-footer { padding: 14px; border-top: 1px solid rgba(255,255,255,0.05); }
  .evara-sidebar-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #D4AF6A, #B8923E); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #0C1628; flex-shrink: 0; }

  .evara-main { flex: 1; min-width: 0; overflow-x: hidden; width: 100%; max-width: 100vw; }

  /* ── Mobile (default / base) ── */
  .evara-page-header, .evara-page-inner, .evara-page-header-inner { width: 100%; max-width: 100vw; box-sizing: border-box; }

  /* ── Laptop / desktop ── */
  @media (min-width: 769px) {
    .evara-main { margin-left: 256px; overflow-x: hidden; max-width: calc(100vw - 256px); }
    .evara-bottom-nav { display: none !important; }
    .evara-page-header { padding-top: 36px !important; width: 100%; box-sizing: border-box; }
    .evara-page-inner { width: 100%; padding: 0 32px; box-sizing: border-box; }
    .evara-page-header-inner { width: 100%; padding-left: 32px; padding-right: 32px; box-sizing: border-box; }
    .bookings-grid { display: grid !important; grid-template-columns: repeat(2, 1fr) !important; gap: 18px !important; }
    .admin-max { max-width: 100%; margin: 0; padding: 0 32px; }
    .vendor-grid { display: grid !important; grid-template-columns: repeat(2, 1fr) !important; gap: 18px !important; }
    .vendor-detail-hero { height: 340px !important; }
    .admin-grid { display: grid !important; grid-template-columns: repeat(2, 1fr) !important; gap: 18px !important; }
    .admin-grid-3 { display: grid !important; grid-template-columns: repeat(3, 1fr) !important; gap: 18px !important; }
    .cat-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)) !important; gap: 14px !important; }
    .trust-bar { padding: 14px 0 !important; }
    .hero-title { font-size: 32px !important; }
    .vendor-card-img { width: 100px !important; height: 100px !important; }
    .vendor-card { padding: 20px !important; }
    .stats-scroll { display: grid !important; grid-template-columns: repeat(3, 1fr) !important; min-width: unset !important; }
    .dash-stats-grid { grid-template-columns: repeat(4, 1fr) !important; }
  }
  /* ── Wide desktop ── */
  @media (min-width: 1200px) {
    .vendor-grid { grid-template-columns: repeat(3, 1fr) !important; }
    .cat-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)) !important; }
    .stats-scroll { grid-template-columns: repeat(6, 1fr) !important; }
  }
  @media (max-width: 768px) {
    .evara-sidebar { display: none !important; }
    .evara-main { margin-left: 0; max-width: 100vw; }
    .evara-bottom-nav { display: flex !important; }
    .mobile-signin-btn { display: block; }
    .hero-title { font-size: 26px !important; }
    img { max-width: 100%; }
  }
  @media (max-width: 380px) {
    .evara-page-header-inner, .evara-page-inner { padding-left: 12px !important; padding-right: 12px !important; }
  }

  @media (min-width: 769px) { .mobile-signin-btn { display: none !important; } }

  /* ── Support widget positioning ── */
  .support-launcher { bottom: 20px; }
  .support-panel { bottom: 88px; }
  @media (max-width: 768px) {
    .support-launcher { bottom: 78px; }
    .support-panel { bottom: 146px; }
  }
  @supports (padding-bottom: env(safe-area-inset-bottom)) {
    @media (max-width: 768px) {
      .support-launcher { bottom: calc(78px + env(safe-area-inset-bottom)); }
      .support-panel { bottom: calc(146px + env(safe-area-inset-bottom)); }
    }
  }

`;
};

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ toast }) {
  if (!toast) return null;
  const colors = { success: { bg: "#EDFAF4", border: "#1A9B6C", text: "#1A9B6C" }, error: { bg: "#FEF2F2", border: "#D94040", text: "#D94040" }, info: { bg: "#E8F5FF", border: "#0369A1", text: "#0369A1" } };
  const s = colors[toast.type] || colors.info;
  return <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", zIndex: 1000, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: "12px 20px", fontSize: 13, fontWeight: 600, color: s.text, boxShadow: "0 4px 20px rgba(0,0,0,0.12)", animation: "slideUp .3s ease", whiteSpace: "nowrap" }}>{toast.msg}</div>;
}

function Skeleton({ w = "100%", h = 16, r = 8 }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: `linear-gradient(90deg,${B.border} 25%,${B.surface} 50%,${B.border} 75%)`, backgroundSize: "200% 100%", animation: "pulse 1.5s ease-in-out infinite" }}/>;
}

// ─── Theme Toggle ─────────────────────────────────────────────────────────────
// `variant` controls where it's rendered: "sidebar" (desktop dark sidebar pill),
// "header" (small icon button on dark navy headers), or "row" (a settings-style
// row used inside Profile).
function ThemeToggle({ variant = "header" }) {
  const [mode, toggle] = useTheme();
  const isDark = mode === "dark";

  if (variant === "row") {
    return (
      <button onClick={toggle} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: B.bg, border: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: B.text }}>
            {isDark ? <Icon.Moon/> : <Icon.Sun/>}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: B.text }}>Appearance</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: B.textMuted, fontWeight: 600 }}>{isDark ? "Dark" : "Light"}</span>
          <span style={{ width: 38, height: 22, borderRadius: 11, background: isDark ? B.primary : B.border, position: "relative", transition: "background .15s", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 2, left: isDark ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }}/>
          </span>
        </span>
      </button>
    );
  }

  if (variant === "sidebar") {
    return (
      <button onClick={toggle} className="evara-sidebar-item" style={{ justifyContent: "space-between" }} title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isDark ? <Icon.Moon/> : <Icon.Sun/>}
          <span>{isDark ? "Dark Mode" : "Light Mode"}</span>
        </span>
        <span style={{ width: 32, height: 18, borderRadius: 9, background: isDark ? "rgba(212,175,106,0.35)" : "rgba(255,255,255,0.12)", position: "relative", flexShrink: 0 }}>
          <span style={{ position: "absolute", top: 2, left: isDark ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: isDark ? "#D4AF6A" : "rgba(255,255,255,0.6)", transition: "left .15s" }}/>
        </span>
      </button>
    );
  }

  // "header" — compact icon-only button for dark navy page headers (mobile + desktop)
  return (
    <button onClick={toggle} aria-label="Toggle theme" title={isDark ? "Switch to light mode" : "Switch to dark mode"} style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.85)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
      {isDark ? <Icon.Moon/> : <Icon.Sun/>}
    </button>
  );
}

// ─── PayHere Payment Button ───────────────────────────────────────────────────
function PayHereButton({ booking, vendor, user, token, onPaymentSuccess, showToast }) {
  const [processing, setProcessing] = useState(false);

  const handlePay = async () => {
    setProcessing(true);
    showToast("Opening PayHere payment gateway...", "info");

    initiatePayHerePayment({
      booking, vendor, user,
      onSuccess: async (orderId) => {
        // Update booking status to "paid" in Supabase
        const { error } = await sb.query("bookings", `?id=eq.${booking.id}`, token, "PATCH", {
          status: "paid",
          payment_method: "payhere",
          payment_date: new Date().toISOString(),
          payhere_order_id: orderId,
        });
        setProcessing(false);
        if (error) {
          // The database's double-booking safeguard rejects this if someone
          // else's booking already locked this vendor+date in between this
          // person opening the form and finishing payment — rare, but real
          // money has already moved, so this needs to be unambiguous about
          // what happened and that a refund is coming, not a vague error.
          const isDoubleBooked = error.message?.includes("duplicate") || error.message?.includes("bookings_vendor_date_locked");
          if (isDoubleBooked) {
            showToast("That date was just booked by someone else. Your payment will be refunded — contact support if it isn't reversed within a few days.", "error");
          } else {
            showToast("Payment recorded but status update failed. Contact support with your order ID: " + orderId, "error");
          }
          return;
        }
        showToast("Payment successful! 🎉 Your payment is protected.", "success");
        onPaymentSuccess && onPaymentSuccess();
      },
      onError: (err) => {
        setProcessing(false);
        showToast("Payment failed. Please try again.", "error");
      }
    });
  };

  return (
    <button onClick={handlePay} disabled={processing} style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      width: "100%", padding: "12px", borderRadius: 10, border: "none",
      background: processing ? "#B0B3C1" : "#0F3460",
      color: "#fff", fontWeight: 700, fontSize: 14, cursor: processing ? "not-allowed" : "pointer",
    }}>
      {processing ? (
        <><div style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }}/> Processing...</>
      ) : (
        <><Icon.CreditCard/> Pay {fmt(booking.amount)} via PayHere</>
      )}
    </button>
  );
}

// ─── Receipt ──────────────────────────────────────────────────────────────────
function Receipt({ booking, onClose }) {
  if (!booking) return null;
  const platformFee = Math.round(((booking.amount || 0) * 0.05) / 1.05);
  const baseAmount = (booking.amount || 0) - platformFee;
  const ss = STATUS_STYLE[booking.status] || STATUS_STYLE.pending;
  const vendorName = booking.vendors?.name || "Vendor";
  const vendorCat = booking.vendors?.category || "vendors";
  const receiptNum = shortId(booking.id);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(12,22,40,0.65)", backdropFilter: "blur(4px)" }}/>
      <div style={{ position: "fixed", inset: 0, zIndex: 700, display: "flex", alignItems: "flex-end", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "100%", maxWidth: 480, maxHeight: "92vh", background: B.bg, borderRadius: "22px 22px 0 0", overflow: "hidden", display: "flex", flexDirection: "column", pointerEvents: "all", animation: "slideUp .35s cubic-bezier(.22,1,.36,1) both" }}>
          <div style={{ padding: "16px 20px", background: B.surface, borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>Booking Receipt</div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 8, border: `1.5px solid ${B.border}`, background: B.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: B.textMuted }}><Icon.X/></button>
          </div>
          <div style={{ overflowY: "auto", flex: 1, padding: "20px 16px 40px" }}>
            <div style={{ background: B.dark, borderRadius: 16, padding: "24px 24px 20px", marginBottom: 14 }}>
              <div style={{ marginBottom: 4 }}><EvaraLogo size="md" dark/></div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 16 }}>Official Booking Receipt</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>Receipt No.</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: B.accent, letterSpacing: 1 }}>#{receiptNum}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>Issued On</div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>{formatDate(booking.created_at)}</div>
                </div>
              </div>
            </div>
            <div style={{ background: ss.bg, border: `1px solid ${ss.c}33`, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: ss.c }}/><span style={{ fontSize: 13, fontWeight: 600, color: ss.c }}>{ss.label}</span></div>
              <span style={{ fontSize: 11, color: B.textMuted }}>{booking.status?.toUpperCase()}</span>
            </div>
            <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: B.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Service Provider</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: B.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1px solid ${B.border}`, color: B.primary }}>{getCatIcon(vendorCat, 22, B.primary)}</div>
                <div><div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>{vendorName}</div><div style={{ fontSize: 12, color: B.textMuted }}>{CAT_LABELS[vendorCat] || vendorCat}</div></div>
              </div>
            </div>
            <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: B.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Event Details</div>
              {[["Event Date", formatDate(booking.event_date)], ["Event Type", booking.event_type || "—"], ["Guests", booking.guests ? `${booking.guests} guests` : "—"], ["Package", booking.package || "—"]].map(([label, value], i, arr) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: i < arr.length - 1 ? `1px solid ${B.border}` : "none" }}>
                  <span style={{ fontSize: 13, color: B.textMuted }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: B.text }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: B.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Payment Summary</div>
              {[["Service Amount", fmt(baseAmount)], ["Platform Fee (5%)", fmt(platformFee)]].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${B.border}` }}>
                  <span style={{ fontSize: 13, color: B.textMuted }}>{l}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: B.text }}>{v}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0 0" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: B.text }}>Total</span>
                <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, fontWeight: 700, color: B.primary }}>{fmt(booking.amount)}</span>
              </div>
            </div>
            {booking.payment_method && (
              <div style={{ background: "#EDFAF4", borderRadius: 12, padding: "12px 16px", border: "1px solid rgba(26,155,108,0.2)", display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14 }}>
                <span style={{ display:"flex",alignItems:"center",color:B.success }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg></span>
                <div><div style={{ fontSize: 12, fontWeight: 700, color: B.success }}>Paid via PayHere</div><div style={{ fontSize: 11, color: B.textMuted }}>Payment securely held until event completion.</div></div>
              </div>
            )}
            <div style={{ background: B.accentSoft, borderRadius: 12, padding: "12px 16px", border: `1px solid ${B.border}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ display: "flex", color: B.success, marginTop: 1 }}><Icon.Shield/></span>
              <div><div style={{ fontSize: 12, fontWeight: 700, color: B.text }}>Payment Protected</div><div style={{ fontSize: 11, color: B.textMuted }}>Payment safely held until your event is complete.</div></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Reviews ───────────────────────────────────────────────────────────────────
// Reviews are written by a customer once their booking reaches "completed",
// one review per booking (enforced by a unique index on booking_id in
// Supabase — see the SQL note further down). Vendor rating shown anywhere in
// the app is the live average of these rows, not a number typed into the
// admin form.
async function fetchVendorReviews(vendorId, token = null) {
  const { data } = await sb.query("reviews", `?vendor_id=eq.${vendorId}&select=*&order=created_at.desc`, token);
  const reviews = data || [];
  const count = reviews.length;
  const avg = count ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / count : null;
  return { reviews, count, avg };
}

function StarRow({ rating, size = 13, gap = 2 }) {
  const full = Math.round(rating || 0);
  return (
    <span style={{ display: "inline-flex", gap }}>
      {[1, 2, 3, 4, 5].map(n => <Icon.Star key={n} filled={n <= full}/>)}
    </span>
  );
}

// Compact rating badge used on vendor cards / detail header. Shows the live
// average once there's at least one review; otherwise a neutral "New" badge
// instead of a made-up number, so we never show a rating nobody actually gave.
function RatingBadge({ avg, count, size = "sm" }) {
  if (!count) {
    return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: B.bg, borderRadius: 8, padding: "2px 7px", border: `1px solid ${B.border}` }}><span style={{ fontSize: 11, fontWeight: 600, color: B.textMuted }}>New</span></span>;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: B.accentSoft, borderRadius: 8, padding: "2px 7px" }}>
      <Icon.Star filled/>
      <span style={{ fontSize: 12, fontWeight: 700, color: B.accent }}>{avg.toFixed(1)}</span>
      {size !== "sm" && <span style={{ fontSize: 11, color: B.textMuted, fontWeight: 500 }}>({count})</span>}
    </span>
  );
}

// ─── Saved Vendors (favorites) ─────────────────────────────────────────────────
// Lifted to App level so the same saved-set stays in sync whether the heart
// is toggled from a card in the Explore grid or from the vendor detail page.
function useFavorites(user, token) {
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [loaded, setLoaded] = useState(false);

  const fetchFavorites = useCallback(async () => {
    if (!user) { setFavoriteIds(new Set()); setLoaded(true); return; }
    const { data } = await sb.query("favorites", `?user_id=eq.${user.id}&select=vendor_id`, token);
    setFavoriteIds(new Set((data || []).map(f => f.vendor_id)));
    setLoaded(true);
  }, [user, token]);

  useEffect(() => { fetchFavorites(); }, [fetchFavorites]);

  const toggleFavorite = useCallback(async (vendorId) => {
    if (!user) return false; // caller should prompt sign-in instead of calling this
    const isFav = favoriteIds.has(vendorId);
    // Optimistic update — flip it instantly, roll back only if the request
    // actually fails, so the heart never feels laggy.
    setFavoriteIds(prev => {
      const next = new Set(prev);
      isFav ? next.delete(vendorId) : next.add(vendorId);
      return next;
    });
    const { error } = isFav
      ? await sb.query("favorites", `?user_id=eq.${user.id}&vendor_id=eq.${vendorId}`, token, "DELETE")
      : await sb.query("favorites", "", token, "POST", { user_id: user.id, vendor_id: vendorId });
    if (error) {
      setFavoriteIds(prev => {
        const next = new Set(prev);
        isFav ? next.add(vendorId) : next.delete(vendorId);
        return next;
      });
      return false;
    }
    return true;
  }, [user, token, favoriteIds]);

  return { favoriteIds, loaded, toggleFavorite, refetchFavorites: fetchFavorites };
}

// Small heart toggle, reused on vendor cards and the vendor detail hero.
// variant="card" sits as a round button over light/photo backgrounds;
// variant="hero" sits over the dark navy vendor-detail header.
function FavoriteButton({ vendorId, isFavorited, onToggle, onNeedAuth, variant = "card" }) {
  const [busy, setBusy] = useState(false);
  const handleClick = async (e) => {
    e.stopPropagation();
    if (busy) return;
    if (!onToggle) { onNeedAuth && onNeedAuth(); return; }
    setBusy(true);
    await onToggle(vendorId);
    setBusy(false);
  };
  const baseStyle = variant === "hero"
    ? { background: "rgba(255,255,255,0.15)", color: isFavorited ? "#FF6B81" : "#fff", backdropFilter: "blur(8px)" }
    : { background: B.surface, color: isFavorited ? "#FF6B81" : B.textMuted, border: `1px solid ${B.border}`, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" };
  return (
    <button onClick={handleClick} aria-label={isFavorited ? "Remove from saved" : "Save vendor"} style={{ width: 34, height: 34, borderRadius: "50%", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: busy ? "default" : "pointer", flexShrink: 0, ...baseStyle }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill={isFavorited ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
    </button>
  );
}

// ─── Notifications ──────────────────────────────────────────────────────────
// Backed by the `notifications` table, populated automatically by a Postgres
// trigger on bookings (see notifications-setup.sql) — the app never writes
// notification rows itself, it only reads and marks them read. Polls every
// 30s rather than using a realtime subscription, which keeps this in line
// with the rest of the app's plain-fetch data pattern.
function useNotifications(user, token) {
  const [notifications, setNotifications] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!user) { setNotifications([]); setLoaded(true); return; }
    const { data } = await sb.query("notifications", `?user_id=eq.${user.id}&select=*&order=created_at.desc&limit=30`, token);
    setNotifications(data || []);
    setLoaded(true);
  }, [user, token]);

  useEffect(() => {
    fetchNotifications();
    if (!user) return;
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications, user]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markRead = useCallback(async (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    await sb.query("notifications", `?id=eq.${id}`, token, "PATCH", { read: true });
  }, [token]);

  const markAllRead = useCallback(async () => {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    if (!unreadIds.length) return;
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    await sb.query("notifications", `?user_id=eq.${user.id}&read=eq.false`, token, "PATCH", { read: true });
  }, [user, token, notifications]);

  return { notifications, unreadCount, loaded, markRead, markAllRead, refetchNotifications: fetchNotifications };
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(dateStr);
}

const NOTIF_ICONS = {
  new_booking_request: "📩", booking_confirmed: "✅", payment_received: "💳",
  release_requested: "🔓", payment_released: "💰", completed: "⭐", cancelled: "✕",
  vendor_approved: "🎉", vendor_rejected: "📋", vendor_resubmitted: "🔄",
};

// variant="header" (light icon button, used on dark navy headers) or
// variant="sidebar" (used inside the desktop sidebar nav list).
function NotificationBell({ user, token, variant = "header", onNavigateToBooking }) {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(user, token);
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (!user) return null;

  const panel = (
    <div ref={panelRef} style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 340, maxWidth: "calc(100vw - 32px)", maxHeight: 420, background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, boxShadow: "0 16px 48px rgba(0,0,0,0.22)", overflow: "hidden", display: "flex", flexDirection: "column", zIndex: 500 }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: B.text }}>Notifications</span>
        {unreadCount > 0 && <button onClick={markAllRead} style={{ background: "none", border: "none", color: B.accent, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Mark all read</button>}
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {notifications.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: B.textMuted }}>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>🔔</div>
            <div style={{ fontSize: 13 }}>You're all caught up</div>
          </div>
        ) : (
          notifications.map(n => (
            <button key={n.id} onClick={() => { if (!n.read) markRead(n.id); if (n.booking_id && onNavigateToBooking) { onNavigateToBooking(); setOpen(false); } }} style={{ width: "100%", textAlign: "left", display: "flex", gap: 10, padding: "12px 16px", background: n.read ? "transparent" : B.accentSoft, border: "none", borderBottom: `1px solid ${B.border}`, cursor: "pointer" }}>
              <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1 }}>{NOTIF_ICONS[n.type] || "🔔"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: n.read ? 600 : 700, color: B.text }}>{n.title}</span>
                  {!n.read && <span style={{ width: 7, height: 7, borderRadius: "50%", background: B.accent, flexShrink: 0 }}/>}
                </span>
                {n.body && <span style={{ display: "block", fontSize: 12, color: B.textMuted, marginTop: 2, lineHeight: 1.4 }}>{n.body}</span>}
                <span style={{ display: "block", fontSize: 11, color: B.textLight, marginTop: 4 }}>{timeAgo(n.created_at)}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  if (variant === "sidebar") {
    return (
      <div style={{ position: "relative" }}>
        <button onClick={() => setOpen(o => !o)} className="evara-sidebar-item" style={{ justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}><Icon.Bell/><span>Notifications</span></span>
          {unreadCount > 0 && <span style={{ background: B.accent, color: B.dark, fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 10, flexShrink: 0 }}>{unreadCount}</span>}
        </button>
        {open && panel}
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} aria-label="Notifications" style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.85)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, position: "relative" }}>
        <Icon.Bell/>
        {unreadCount > 0 && <span style={{ position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, padding: "0 3px", borderRadius: 8, background: "#FF6B81", color: "#fff", fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: `1.5px solid ${B.dark}` }}>{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && panel}
    </div>
  );
}


function ReviewModal({ booking, token, onClose, onSubmitted, showToast }) {
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!rating) { setError("Please choose a star rating."); return; }
    setLoading(true); setError("");
    const body = {
      booking_id: booking.id,
      vendor_id: booking.vendor_id,
      user_id: booking.user_id,
      rating,
      comment: comment.trim() || null,
    };
    const { error: err } = await sb.query("reviews", "", token, "POST", body);
    setLoading(false);
    if (err) {
      // Most likely cause: a unique constraint on booking_id, meaning this
      // booking already has a review (e.g. a stale UI state after a refresh).
      setError(err.message?.includes("duplicate") ? "You've already reviewed this booking." : (err.message || "Couldn't submit your review. Please try again."));
      return;
    }
    showToast && showToast("Thanks for your review! 🌟", "success");
    onSubmitted && onSubmitted();
    onClose();
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(12,22,40,0.65)", backdropFilter: "blur(4px)" }}/>
      <div style={{ position: "fixed", inset: 0, zIndex: 700, display: "flex", alignItems: "flex-end", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "100%", maxWidth: 440, maxHeight: "92vh", background: B.bg, borderRadius: "22px 22px 0 0", overflow: "hidden", display: "flex", flexDirection: "column", pointerEvents: "all", animation: "slideUp .35s cubic-bezier(.22,1,.36,1) both" }}>
          <div style={{ padding: "16px 20px", background: B.surface, borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>Rate your experience</div>
              <div style={{ fontSize: 12, color: B.textMuted }}>{booking.vendors?.name || "Vendor"}</div>
            </div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 8, border: `1.5px solid ${B.border}`, background: B.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: B.textMuted }}><Icon.X/></button>
          </div>
          <div style={{ overflowY: "auto", flex: 1, padding: "24px 20px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, color: B.textMuted, marginBottom: 12 }}>How was {booking.vendors?.name || "this vendor"}?</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} type="button" onClick={() => setRating(n)} onMouseEnter={() => setHoverRating(n)} onMouseLeave={() => setHoverRating(0)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: B.accent, transform: (hoverRating || rating) >= n ? "scale(1.12)" : "scale(1)", transition: "transform .1s" }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill={(hoverRating || rating) >= n ? B.accent : "none"} stroke={B.accent} strokeWidth="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: B.text, marginTop: 8 }}>
                {{ 1: "Poor", 2: "Below average", 3: "Okay", 4: "Good", 5: "Excellent" }[hoverRating || rating]}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: B.textMuted, display: "block", marginBottom: 6 }}>Tell others about it (optional)</label>
              <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={600} rows={4} placeholder="What stood out — good or bad?" style={{ width: "100%", padding: 12, borderRadius: 12, border: `1.5px solid ${B.border}`, background: B.surface, color: B.text, fontSize: 14, fontFamily: "inherit", resize: "vertical", outline: "none" }}/>
            </div>
            {error && <div style={{ fontSize: 12, color: B.danger, fontWeight: 600 }}>{error}</div>}
            <button onClick={submit} disabled={loading} style={{ width: "100%", padding: 14, borderRadius: 12, background: loading ? B.textLight : B.primary, color: "#fff", fontWeight: 700, fontSize: 14, border: "none", cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Submitting…" : "Submit Review"}
            </button>
            <div style={{ fontSize: 11, color: B.textMuted, textAlign: "center" }}>Your review will be public on this vendor's profile.</div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Booking Modal with PayHere ───────────────────────────────────────────────
function BookingModal({ vendor, user, token, onClose, onSuccess, showToast }) {
  const packages = ["Basic", "Standard", "Premium"];
  const PRICE_MAP = { Basic: vendor.base_price || 15000, Standard: Math.round((vendor.base_price || 15000) * 1.5), Premium: Math.round((vendor.base_price || 15000) * 2.5) };
  const [form, setForm] = useState({ event_date: "", event_type: "", guests: "", location: vendor.location || "", package: "Standard", notes: "", amount: PRICE_MAP.Standard });
  const [step, setStep] = useState("form"); // form | review | payment | success
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [blockedDates, setBlockedDates] = useState(new Set());
  const [loadingDates, setLoadingDates] = useState(true);

  // Pull this vendor's already-confirmed/paid dates once when the modal
  // opens, so we can warn before someone fills out the whole form, not
  // just after they hit submit.
  useEffect(() => {
    let active = true;
    sb.rpc("get_vendor_blocked_dates", { p_vendor_id: vendor.id }).then(({ data }) => {
      if (!active) return;
      setBlockedDates(new Set((data || []).map(d => d.event_date)));
      setLoadingDates(false);
    });
    return () => { active = false; };
  }, [vendor.id]);

  const isDateBlocked = form.event_date && blockedDates.has(form.event_date);

  const handlePackageChange = (pkg) => setForm(f => ({ ...f, package: pkg, amount: PRICE_MAP[pkg] || f.amount }));

  const handleSubmit = async () => {
    if (!form.event_date || !form.event_type || !form.guests) { setError("Please fill in all required fields."); return; }
    if (isDateBlocked) { setError("That date is already booked for this vendor — please choose another."); return; }
    setLoading(true); setError("");
    const body = { vendor_id: vendor.id, user_id: user.id, event_date: form.event_date, event_type: form.event_type, guests: parseInt(form.guests) || 0, location: form.location, package: form.package, notes: form.notes, amount: form.amount, status: "pending" };
    const { data, error: err } = await sb.query("bookings", "", token, "POST", body);
    setLoading(false);
    if (err) { setError(err.message || "Booking failed. Please try again."); return; }
    const newBooking = Array.isArray(data) ? data[0] : data;
    setBooking({ ...newBooking, vendors: vendor });
    setStep("review");
  };

  const handleConfirmBooking = () => setStep("payment");

  const handlePaymentSuccess = async () => {
    setStep("success");
    setTimeout(() => { onClose(); onSuccess(); }, 2500);
  };

  const handleSkipPayment = async () => {
    showToast("Booking confirmed! Pay later from My Bookings.", "success");
    onClose();
    onSuccess();
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(12,22,40,0.65)", backdropFilter: "blur(4px)" }}/>
      <div style={{ position: "fixed", inset: 0, zIndex: 700, display: "flex", alignItems: "flex-end", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "100%", maxWidth: 480, maxHeight: "92vh", background: B.bg, borderRadius: "22px 22px 0 0", overflow: "hidden", display: "flex", flexDirection: "column", pointerEvents: "all", animation: "slideUp .35s cubic-bezier(.22,1,.36,1) both" }}>
          <div style={{ padding: "16px 20px", background: B.surface, borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>{vendor.name}</div>
              <div style={{ fontSize: 12, color: B.textMuted }}>{step === "form" ? "Booking Details" : step === "review" ? "Review & Confirm" : step === "payment" ? "Secure Payment" : "Booking Complete!"}</div>
            </div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 8, border: `1.5px solid ${B.border}`, background: B.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: B.textMuted }}><Icon.X/></button>
          </div>

          <div style={{ overflowY: "auto", flex: 1, padding: "20px 16px 32px" }}>
            {step === "success" && (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ width: 72, height: 72, borderRadius: 20, background: "#EDFAF4", border: "1.5px solid rgba(26,155,108,0.25)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#1A9B6C" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 700, color: B.text, marginBottom: 8 }}>Booking Confirmed!</div>
                <div style={{ fontSize: 14, color: B.textMuted, marginBottom: 16 }}>Your payment is held safely until your event is complete.</div>
                <div style={{ background: "#EDFAF4", borderRadius: 12, padding: "12px 16px", border: "1px solid rgba(26,155,108,0.2)", fontSize: 13, color: B.success, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1A9B6C" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg> Payment received via PayHere</div>
              </div>
            )}

            {step === "payment" && booking && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: B.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Payment Summary</div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${B.border}` }}>
                    <span style={{ fontSize: 13, color: B.textMuted }}>Service Amount</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: B.text }}>{fmt(booking.amount - Math.round(booking.amount * 0.05 / 1.05))}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${B.border}` }}>
                    <span style={{ fontSize: 13, color: B.textMuted }}>Platform Fee (5%)</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: B.text }}>{fmt(Math.round(booking.amount * 0.05 / 1.05))}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0 0" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: B.text }}>Total</span>
                    <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 700, color: B.primary }}>{fmt(booking.amount)}</span>
                  </div>
                </div>
                <div style={{ background: "#E8F5FF", borderRadius: 12, padding: "12px 16px", border: "1px solid rgba(3,105,161,0.2)", fontSize: 12, color: "#0369A1", display: "flex", alignItems: "flex-start", gap: 8 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0369A1" strokeWidth="2" strokeLinecap="round" style={{flexShrink:0,marginTop:1}}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Payments are held securely and only released to the vendor after your event is completed successfully.</div>
                <PayHereButton booking={booking} vendor={vendor} user={user} token={token} onPaymentSuccess={handlePaymentSuccess} showToast={showToast}/>
                <button onClick={handleSkipPayment} style={{ width: "100%", padding: "11px", borderRadius: 10, background: "transparent", border: `1px solid ${B.border}`, color: B.textMuted, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                  Pay Later (Keep as Confirmed)
                </button>
              </div>
            )}

            {step === "review" && booking && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: B.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Booking Summary</div>
                  {[["Package", booking.package], ["Event Date", formatDate(booking.event_date)], ["Event Type", booking.event_type], ["Guests", `${booking.guests} guests`], ["Location", booking.location || "—"]].map(([l, v]) => (
                    <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${B.border}` }}>
                      <span style={{ fontSize: 13, color: B.textMuted }}>{l}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: B.text }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0 0" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: B.text }}>Total</span>
                    <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, fontWeight: 700, color: B.primary }}>{fmt(booking.amount)}</span>
                  </div>
                </div>
                <div style={{ background: B.accentSoft, borderRadius: 12, padding: "12px 16px", border: `1px solid ${B.border}`, fontSize: 12, color: B.textMuted }}>
                  Booking ID: <strong>#{shortId(booking.id)}</strong> — saved successfully.
                </div>
                <button onClick={handleConfirmBooking} style={{ width: "100%", padding: 14, borderRadius: 12, background: B.dark, color: "#fff", fontWeight: 700, fontSize: 16, border: "none", cursor: "pointer" }}>
                  Proceed to Payment →
                </button>
                <button onClick={() => { onClose(); onSuccess(); }} style={{ width: "100%", padding: "11px", borderRadius: 10, background: "transparent", border: `1px solid ${B.border}`, color: B.textMuted, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                  Skip — I'll pay later
                </button>
              </div>
            )}

            {step === "form" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: B.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>Select Package</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {packages.map(pkg => {
                      const active = form.package === pkg;
                      return (
                        <button type="button" key={pkg} onClick={() => handlePackageChange(pkg)} style={{ flex: 1, padding: "10px 8px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", background: active ? B.primary : B.surface, color: active ? "#fff" : B.text, border: `1.5px solid ${active ? B.primary : B.border}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, pointerEvents: "all" }}>
                          <span style={{ pointerEvents: "none" }}>{pkg}</span>
                          <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.8, pointerEvents: "none" }}>{fmt(PRICE_MAP[pkg])}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: B.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>Event Date *</div>
                  <input type="date" value={form.event_date} min={new Date().toISOString().split("T")[0]} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${isDateBlocked ? B.danger : B.border}`, background: B.surface, fontSize: 14, color: B.text, outline: "none" }}/>
                  {loadingDates && form.event_date && <div style={{ fontSize: 11.5, color: B.textMuted, marginTop: 6 }}>Checking availability…</div>}
                  {!loadingDates && isDateBlocked && (
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 6, color: B.danger }}>
                      <span style={{ flexShrink: 0, marginTop: 1 }}><Icon.X/></span>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>This date is already booked for {vendor.name}. Please choose another date.</span>
                    </div>
                  )}
                  {!loadingDates && !isDateBlocked && form.event_date && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, color: B.success }}>
                      <Icon.Check/><span style={{ fontSize: 12, fontWeight: 600 }}>Available</span>
                    </div>
                  )}
                </div>
                {[{ key: "event_type", label: "Event Type *", type: "text", placeholder: "Wedding, Birthday, Corporate..." }, { key: "guests", label: "Number of Guests *", type: "number", placeholder: "e.g. 150" }, { key: "location", label: "Event Location", type: "text", placeholder: vendor?.location || "Venue address" }].map(({ key, label, type, placeholder }) => (
                  <div key={key}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: B.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</div>
                    <input type={type} value={form[key]} placeholder={placeholder} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${B.border}`, background: B.surface, fontSize: 14, color: B.text, outline: "none" }}/>
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: B.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>Special Notes</div>
                  <textarea value={form.notes} placeholder="Any special requests..." onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${B.border}`, background: B.surface, fontSize: 14, color: B.text, outline: "none", resize: "none" }}/>
                </div>
                {error && <div style={{ background: "#FEF2F2", border: "1px solid #D94040", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: B.danger }}>{error}</div>}
                <div style={{ background: B.dark, borderRadius: 14, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Total Amount</div>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 700, color: B.accent }}>{fmt(form.amount)}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>incl. 5% platform fee · Secure payment</div>
                  </div>
                  <button onClick={handleSubmit} disabled={loading || isDateBlocked} style={{ padding: "12px 24px", borderRadius: 12, background: (loading || isDateBlocked) ? B.textLight : B.accent, color: B.dark, fontWeight: 700, fontSize: 14, border: "none", cursor: (loading || isDateBlocked) ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
                    {loading ? "Booking…" : "Confirm Booking"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Vendor Detail ────────────────────────────────────────────────────────────
function VendorDetail({ vendor, user, token, onBack, onBookingSuccess, showToast, onShowAuth, isFavorited, onToggleFavorite }) {
  const [showBooking, setShowBooking] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [reviews, setReviews] = useState([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviewAvg, setReviewAvg] = useState(null);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const tabs = [{ id: "overview", label: "Overview" }, { id: "packages", label: "Packages" }, { id: "reviews", label: `Reviews${reviewCount ? ` (${reviewCount})` : ""}` }];
  const base = vendor.base_price || 15000;
  const pkgData = [
    { name: "Basic", price: base, features: ["Standard service", "Up to 4 hours", "1 staff"] },
    { name: "Standard", price: Math.round(base * 1.5), popular: true, features: ["Full service", "Up to 8 hours", "2 staff", "Setup & cleanup"] },
    { name: "Premium", price: Math.round(base * 2.5), features: ["All-inclusive", "Full day", "Full team", "Custom branding"] },
  ];

  useEffect(() => {
    let active = true;
    setLoadingReviews(true);
    fetchVendorReviews(vendor.id).then(({ reviews, count, avg }) => {
      if (!active) return;
      setReviews(reviews); setReviewCount(count); setReviewAvg(avg);
      setLoadingReviews(false);
    });
    return () => { active = false; };
  }, [vendor.id]);

  return (
    <div style={{ minHeight: "100vh", background: B.bg, paddingBottom: 90 }}>
      <div className="vendor-detail-hero" style={{ height: 260, background: `linear-gradient(135deg, ${B.dark} 0%, #1a3a6b 100%)`, position: "relative", display: "flex", alignItems: "flex-end" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.08, color: "#fff" }}>{getCatIcon(vendor.category, 96, "#fff")}</div>
        <button onClick={onBack} style={{ position: "absolute", top: 20, left: 16, width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.15)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", backdropFilter: "blur(8px)" }}><Icon.ChevronLeft/></button>
        <div style={{ position: "absolute", top: 20, right: 16 }}>
          <FavoriteButton vendorId={vendor.id} isFavorited={isFavorited} onToggle={user ? onToggleFavorite : null} onNeedAuth={onShowAuth} variant="hero"/>
        </div>
        <div style={{ padding: "0 20px 20px", position: "relative", zIndex: 1 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(212,175,106,0.2)", borderRadius: 20, padding: "4px 12px", marginBottom: 8 }}>
            <span style={{ display:"flex",alignItems:"center",color:"rgba(255,255,255,0.7)" }}>{getCatIcon(vendor.category, 13, "rgba(255,255,255,0.7)")}</span>
            <span style={{ fontSize: 12, color: B.accent, fontWeight: 600 }}>{CAT_LABELS[vendor.category] || vendor.category}</span>
          </div>
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>{vendor.name}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon.MapPin/><span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>{vendor.location || "Sri Lanka"}</span></span>
            {!loadingReviews && <RatingBadge avg={reviewAvg} count={reviewCount}/>}
          </div>
        </div>
      </div>
      <div style={{ background: B.surface, borderBottom: `1px solid ${B.border}`, display: "flex", paddingLeft: 16, position: "sticky", top: 0, zIndex: 100 }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding: "12px 16px", background: "none", border: "none", borderBottom: `2px solid ${activeTab === tab.id ? B.accent : "transparent"}`, color: activeTab === tab.id ? B.text : B.textMuted, fontWeight: activeTab === tab.id ? 700 : 500, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>{tab.label}</button>
        ))}
      </div>
      <div className="evara-page-inner" style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {activeTab === "overview" && (
          <>
            <div style={{ display: "flex", gap: 12 }}>
              {[
                { label: "Rating", value: reviewCount ? `${reviewAvg.toFixed(1)} ★` : "New" },
                { label: "Reviews", value: reviewCount || 0 },
                { label: "Response", value: vendor.response_time || "< 1hr" },
              ].map(({ label, value }) => (
                <div key={label} style={{ flex: 1, background: B.surface, borderRadius: 12, border: `1px solid ${B.border}`, padding: "12px 10px", textAlign: "center" }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>{value}</div>
                  <div style={{ fontSize: 11, color: B.textMuted, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: B.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>About</div>
              <p style={{ fontSize: 14, color: B.text, lineHeight: 1.65 }}>{vendor.description || `${vendor.name} is a premier ${CAT_LABELS[vendor.category] || "event service"} in ${vendor.location || "Sri Lanka"}, delivering exceptional experiences for all types of events.`}</p>
            </div>
          </>
        )}
        {activeTab === "packages" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {pkgData.map(pkg => (
              <div key={pkg.name} style={{ background: B.surface, borderRadius: 14, border: `1.5px solid ${pkg.popular ? B.accent : B.border}`, padding: "18px 18px 16px", position: "relative" }}>
                {pkg.popular && <div style={{ position: "absolute", top: 0, right: 0, background: B.accent, color: B.dark, fontSize: 10, fontWeight: 700, padding: "4px 14px", borderRadius: "0 0 0 10px" }}>MOST POPULAR</div>}
                <div style={{ fontWeight: 700, fontSize: 16, color: B.text, marginBottom: 4 }}>{pkg.name}</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 20, color: pkg.popular ? B.accent : B.primary, marginBottom: 12 }}>{fmt(pkg.price)}</div>
                {pkg.features.map(f => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ color: B.success, display: "flex" }}><Icon.Check/></span>
                    <span style={{ fontSize: 13, color: B.text }}>{f}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ background: "rgba(28,43,75,0.04)", borderRadius: 12, padding: "10px 14px", border: `1px solid ${B.border}`, fontSize: 12, color: B.textMuted, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "flex", color: B.success }}><Icon.Shield/></span>
              All packages include secure payment protection via PayHere.
            </div>
          </div>
        )}
        {activeTab === "reviews" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {loadingReviews ? (
              [1, 2, 3].map(i => <div key={i} style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16, height: 84 }}><Skeleton h="100%" r={14}/></div>)
            ) : reviews.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: B.surface, border: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", color: B.textMuted }}>
                  <Icon.Star/>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, color: B.text, marginBottom: 4 }}>No reviews yet</div>
                <div style={{ fontSize: 13, color: B.textMuted }}>Be the first to book and share your experience.</div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 14, background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16 }}>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 32, fontWeight: 700, color: B.text }}>{reviewAvg.toFixed(1)}</div>
                  <div>
                    <StarRow rating={reviewAvg} size={15}/>
                    <div style={{ fontSize: 12, color: B.textMuted, marginTop: 3 }}>Based on {reviewCount} review{reviewCount !== 1 ? "s" : ""}</div>
                  </div>
                </div>
                {reviews.map(r => (
                  <div key={r.id} style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <StarRow rating={r.rating}/>
                      <span style={{ fontSize: 11, color: B.textMuted }}>{formatDate(r.created_at)}</span>
                    </div>
                    {r.comment && <p style={{ fontSize: 13.5, color: B.text, lineHeight: 1.6 }}>{r.comment}</p>}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
        {user ? (
          <button onClick={() => setShowBooking(true)} style={{ width: "100%", padding: 16, borderRadius: 14, background: B.dark, color: "#fff", fontWeight: 700, fontSize: 16, border: "none", cursor: "pointer" }}>
            Book Now — from {fmt(vendor.base_price || 15000)}
          </button>
        ) : (
          <div style={{ background: B.accentSoft, borderRadius: 14, padding: 16, textAlign: "center", border: `1px solid ${B.border}` }}>
            <div style={{ fontSize: 14, color: B.textMuted, marginBottom: 10 }}>Sign in to book this vendor</div>
            <button onClick={() => onShowAuth && onShowAuth()} style={{ padding: "10px 28px", borderRadius: 10, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer" }}>Sign In</button>
          </div>
        )}
      </div>
      {showBooking && <BookingModal vendor={vendor} user={user} token={token} onClose={() => setShowBooking(false)} onSuccess={onBookingSuccess} showToast={showToast}/>}
    </div>
  );
}

// ─── Explore Page ─────────────────────────────────────────────────────────────
function VendorCard({ vendor, onSelect, rating, isFavorited, onToggleFavorite, onNeedAuth }) {
  return (
    <div onClick={() => onSelect(vendor)} className="vendor-card" style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16, display: "flex", gap: 14, cursor: "pointer", transition: "box-shadow .18s, transform .18s", position: "relative" }} onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 28px rgba(28,43,75,0.10)"; e.currentTarget.style.borderColor = `${B.primary}33`; }} onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; e.currentTarget.style.borderColor = B.border; }}>
      <div className="vendor-card-img" style={{ width: 80, height: 80, borderRadius: 12, background: `linear-gradient(135deg,${B.primary}10,${B.primary}22)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1px solid ${B.border}`, overflow: "hidden", color: B.primary }}>
        {vendor.image_url ? <img src={vendor.image_url} alt={vendor.name} style={{ width: "100%", height: "100%", objectFit: "cover" }}/> : getCatIcon(vendor.category, 30, B.primary)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3, gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: B.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "56%" }}>{vendor.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <RatingBadge avg={rating?.avg} count={rating?.count || 0}/>
            <FavoriteButton vendorId={vendor.id} isFavorited={isFavorited} onToggle={onToggleFavorite} onNeedAuth={onNeedAuth} variant="card"/>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
          <span style={{ color: B.textMuted }}><Icon.MapPin/></span>
          <span style={{ fontSize: 12, color: B.textMuted }}>{vendor.location || "Sri Lanka"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: B.bg, borderRadius: 20, padding: "3px 10px", border: `1px solid ${B.border}` }}>
            <span style={{ display: "flex", alignItems: "center", color: B.primary }}>{getCatIcon(vendor.category, 11, B.primary)}</span>
            <span style={{ fontSize: 11, color: B.textMuted, fontWeight: 500 }}>{CAT_LABELS[vendor.category] || vendor.category}</span>
          </div>
          {vendor.base_price ? <span style={{ fontSize: 13, fontWeight: 700, color: B.primary }}>from {fmt(vendor.base_price)}</span> : <span style={{ fontSize: 12, color: B.textMuted, fontStyle: "italic" }}>Contact for price</span>}
        </div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: B.accent, fontWeight: 600 }}>View details<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg></div>
      </div>
    </div>
  );
}

// ─── Location Picker Panel (shared between bottom-sheet & dropdown) ────────────
function LocationPickerPanel({ location, locSearch, setLocSearch, selectLoc, searchInputRef }) {
  const filteredGroups = locSearch.trim()
    ? [{ region: "Results", locations: SL_LOCATION_GROUPS.flatMap(g => g.locations).filter((l, i, a) => a.indexOf(l) === i && l.toLowerCase().includes(locSearch.toLowerCase())) }]
    : SL_LOCATION_GROUPS;

  return (
    <>
      {/* Search box */}
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 14px", border: "1px solid rgba(255,255,255,0.1)" }}>
          <span style={{ color: "rgba(255,255,255,0.4)", display: "flex", flexShrink: 0 }}><Icon.Search/></span>
          <input
            ref={searchInputRef}
            value={locSearch}
            onChange={e => setLocSearch(e.target.value)}
            placeholder="Search district..."
            style={{ background: "none", border: "none", outline: "none", fontSize: 15, color: "#fff", flex: 1, minWidth: 0 }}
          />
          {locSearch && (
            <button onClick={() => setLocSearch("")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", display: "flex", padding: 0, flexShrink: 0 }}>
              <Icon.X/>
            </button>
          )}
        </div>
      </div>
      {/* All Sri Lanka option */}
      <div style={{ padding: "8px 10px 4px", flexShrink: 0 }}>
        <button onClick={() => selectLoc("All Locations")} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: location === "All Locations" ? B.accent + "22" : "transparent", border: location === "All Locations" ? `1px solid ${B.accent}44` : "1px solid transparent", cursor: "pointer", textAlign: "left", transition: "background .15s" }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: location === "All Locations" ? B.accent : "#fff" }}>All Sri Lanka</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>Search across all districts</div>
          </div>
          {location === "All Locations" && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={B.accent} strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
        </button>
      </div>
      {/* District groups */}
      <div style={{ overflowY: "auto", flex: 1, padding: "0 10px 16px", WebkitOverflowScrolling: "touch" }}>
        {filteredGroups.map(group => (
          group.locations.length === 0 ? null :
          <div key={group.region}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: 1.2, padding: "12px 14px 6px", textTransform: "uppercase" }}>{group.region}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {group.locations.map(loc => (
                <button key={loc} onClick={() => selectLoc(loc)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 13px", borderRadius: 10, background: location === loc ? B.accent + "22" : "rgba(255,255,255,0.03)", border: location === loc ? `1px solid ${B.accent}44` : "1px solid rgba(255,255,255,0.06)", cursor: "pointer", textAlign: "left", transition: "background .12s" }}>
                  <span style={{ color: location === loc ? B.accent : "rgba(255,255,255,0.3)", display: "flex", flexShrink: 0 }}><Icon.MapPin/></span>
                  <span style={{ fontSize: 13, fontWeight: location === loc ? 700 : 500, color: location === loc ? B.accent : "rgba(255,255,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loc}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {filteredGroups.every(g => g.locations.length === 0) && (
          <div style={{ textAlign: "center", padding: "32px 0", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>No districts found</div>
        )}
      </div>
    </>
  );
}

function LocationSearchBar({ search, setSearch, setShowGrid, location, setLocation }) {
  const [showLocDrop, setShowLocDrop] = useState(false);
  const [locSearch, setLocSearch] = useState("");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const dropRef = useRef(null);
  const searchInputRef = useRef(null);

  // Track viewport size
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Close desktop dropdown on outside click
  useEffect(() => {
    if (isMobile) return;
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setShowLocDrop(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isMobile]);

  // Focus search when panel opens
  useEffect(() => {
    if (showLocDrop) {
      // Delay slightly so the panel has rendered
      setTimeout(() => searchInputRef.current?.focus(), 80);
    } else {
      setLocSearch("");
    }
  }, [showLocDrop]);

  // Prevent body scroll when bottom sheet is open
  useEffect(() => {
    if (isMobile && showLocDrop) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [isMobile, showLocDrop]);

  const selectLoc = (loc) => { setLocation(loc); setShowLocDrop(false); };
  const locLabel = location === "All Locations" ? "All Locations" : location;

  return (
    <>
      {/* ── Search bar row ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.07)", borderRadius: 14, border: "1px solid rgba(255,255,255,0.13)" }}>
          {/* Text search */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, padding: "11px 14px" }}>
            <span style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0, display: "flex" }}><Icon.Search/></span>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setShowGrid(false); }}
              placeholder="Search vendors, services..."
              style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 14, color: "#fff", minWidth: 0 }}
            />
            {search && (
              <button onClick={() => { setSearch(""); setShowGrid(true); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", display: "flex", padding: 0, flexShrink: 0 }}>
                <Icon.X/>
              </button>
            )}
          </div>

          <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.12)", flexShrink: 0 }}/>

          {/* Location trigger button */}
          <div ref={!isMobile ? dropRef : null} style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={() => setShowLocDrop(v => !v)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "11px 13px", background: "none", border: "none", cursor: "pointer", color: location === "All Locations" ? "rgba(255,255,255,0.45)" : B.accent, fontWeight: 600, fontSize: 13 }}
            >
              <span style={{ display: "flex", color: location === "All Locations" ? "rgba(255,255,255,0.35)" : B.accent, flexShrink: 0 }}><Icon.MapPin/></span>
              <span style={{ maxWidth: isMobile ? 90 : 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{locLabel}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, opacity: 0.5, transform: showLocDrop ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s" }}><path d="M6 9l6 6 6-6"/></svg>
            </button>

            {/* ── Desktop dropdown ── */}
            {!isMobile && showLocDrop && (
              <div style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, width: 340, background: "#111827", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.55)", zIndex: 999, display: "flex", flexDirection: "column", maxHeight: 480, overflow: "hidden" }}>
                <div style={{ padding: "14px 14px 4px", flexShrink: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: 1.1, textTransform: "uppercase" }}>Select District</div>
                </div>
                <LocationPickerPanel location={location} locSearch={locSearch} setLocSearch={setLocSearch} selectLoc={selectLoc} searchInputRef={searchInputRef}/>
              </div>
            )}
          </div>
        </div>

        {/* Active location chip */}
        {location !== "All Locations" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: B.accent + "18", border: "1px solid " + B.accent + "40", borderRadius: 20, padding: "5px 12px 5px 8px" }}>
              <span style={{ display: "flex", color: B.accent }}><Icon.MapPin/></span>
              <span style={{ fontSize: 12, fontWeight: 700, color: B.accent }}>{location}</span>
              <button onClick={() => setLocation("All Locations")} style={{ background: "none", border: "none", color: B.accent, cursor: "pointer", display: "flex", padding: 0, marginLeft: 2, opacity: 0.7 }}><Icon.X/></button>
            </div>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>Vendors in {location}</span>
          </div>
        )}
      </div>

      {/* ── Mobile bottom sheet ── */}
      {isMobile && showLocDrop && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setShowLocDrop(false)}
            style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)", animation: "fadeIn .2s ease" }}
          />
          {/* Sheet */}
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1200, background: "#0F1B30", borderRadius: "22px 22px 0 0", boxShadow: "0 -8px 40px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", maxHeight: "82vh", animation: "slideUp .32s cubic-bezier(.22,1,.36,1) both", paddingBottom: "env(safe-area-inset-bottom)" }}>
            {/* Handle + title */}
            <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)", margin: "0 auto 14px" }}/>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Choose District</div>
                <button onClick={() => setShowLocDrop(false)} style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <Icon.X/>
                </button>
              </div>
            </div>
            <LocationPickerPanel location={location} locSearch={locSearch} setLocSearch={setLocSearch} selectLoc={selectLoc} searchInputRef={searchInputRef}/>
          </div>
        </>
      )}
    </>
  );
}

// ─── Terms & Refund Policy ────────────────────────────────────────────────────
function PolicyModal({ initialTab = "terms", onClose }) {
  const [tab, setTab] = useState(initialTab);
  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: B.text, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: B.textMuted, lineHeight: 1.7 }}>{children}</div>
    </div>
  );
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(12,22,40,0.7)", backdropFilter: "blur(6px)", animation: "fadeIn .2s ease" }}/>
      <div style={{ position: "fixed", inset: 0, zIndex: 2101, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, pointerEvents: "none" }}>
        <div style={{ width: "100%", maxWidth: 640, maxHeight: "85vh", background: B.surface, borderRadius: 20, border: `1px solid ${B.border}`, boxShadow: "0 32px 80px rgba(0,0,0,0.4)", overflow: "hidden", display: "flex", flexDirection: "column", pointerEvents: "all", animation: "slideUp .3s cubic-bezier(.22,1,.36,1) both" }}>
          <div style={{ background: B.dark, padding: "18px 22px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Legal & Policies</div>
              <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Icon.X/></button>
            </div>
            <div style={{ display: "flex", gap: 24 }}>
              {[{ id: "terms", label: "Terms & Conditions" }, { id: "refunds", label: "Refund Policy" }].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "0 0 10px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", border: "none", borderBottom: tab === t.id ? `2px solid ${B.accent}` : "2px solid transparent", marginBottom: -1, background: "transparent", color: tab === t.id ? "#fff" : "rgba(255,255,255,0.4)" }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ overflowY: "auto", flex: 1, padding: "24px 22px 32px" }}>
            {tab === "terms" && (
              <>
                <div style={{ fontSize: 11, color: B.textMuted, marginBottom: 20 }}>Last updated: June 2026</div>
                <Section title="1. About Evara">
                  Evara is a Sri Lankan online marketplace that connects customers planning events with independent vendors — wedding halls, caterers, photographers, DJs, and other event service providers. Evara is the platform that brings customers and vendors together; the actual event services are provided directly by the vendor, not by Evara.
                </Section>
                <Section title="2. Bookings & Contracts">
                  When you book a vendor through Evara, the agreement for that service is between you and the vendor. Evara facilitates the booking, payment, and communication, but does not itself perform any catering, photography, venue, or other event service.
                </Section>
                <Section title="3. Vendor Listings">
                  Vendors are reviewed before their listing goes live on Evara. Listed pricing, packages, and availability are set by the vendor and should be confirmed for your specific event date before paying. Evara is not responsible for inaccuracies in a vendor's listing, but will investigate any reported mismatch between a listing and the service actually delivered.
                </Section>
                <Section title="4. Payments">
                  All payments are processed securely through PayHere, a Central Bank of Sri Lanka–approved payment gateway. Evara does not store your card details. A platform fee (shown at checkout) is added to the vendor's listed price to cover payment processing and platform operations.
                </Section>
                <Section title="5. Account Responsibilities">
                  You're responsible for keeping your account credentials secure and for the accuracy of the information you provide when booking. Vendor accounts are issued by Evara after listing verification, and vendors are responsible for honouring the services and pricing shown on their profile.
                </Section>
                <Section title="6. Limitation of Liability">
                  Evara is not liable for the quality, safety, or legality of services provided by vendors, or for any loss arising from a vendor's actions or omissions. Evara's role is to investigate reported issues, mediate between customers and vendors, and apply the refund policy below where applicable.
                </Section>
                <Section title="7. Changes to These Terms">
                  These terms may be updated from time to time to reflect changes to the platform. Continued use of Evara after an update means you accept the revised terms.
                </Section>
              </>
            )}

            {tab === "refunds" && (
              <>
                <div style={{ fontSize: 11, color: B.textMuted, marginBottom: 20 }}>Last updated: June 2026</div>
                <Section title="1. Cancellation by You">
                  Refund eligibility depends on the cancellation policy set by the individual vendor for your booking, shown on the vendor's listing page before you pay. As with most event-vendor marketplaces, vendors commonly offer a full refund if you cancel well ahead of the event date, with reduced or no refund the closer you get to the date — since the vendor has reserved that date for you and may have turned away other bookings.
                </Section>
                <Section title="2. Cancellation by the Vendor">
                  If a vendor cancels your booking, you're entitled to a full refund, including the platform fee. Your payment is held securely and is only released to the vendor after your event takes place — so if a vendor cancels or doesn't show up, that money has not yet been paid out and can be returned to you.
                </Section>
                <Section title="3. Service Not as Described">
                  If what was delivered was materially different from the vendor's listing (wrong package, no-show, safety or hygiene issue, etc.), contact support with your booking ID. Evara will review the case with the vendor and may issue a partial or full refund depending on what's found.
                </Section>
                <Section title="4. How Refunds Are Processed">
                  Refunds are issued back through PayHere to your original card or payment method, not as cash or store credit. If a refund is approved on the same day as your payment, it's processed instantly and reflects on your card right away. If it's approved after that, it can take roughly 5–10 business days to appear on your statement, depending on your bank. PayHere refunds the full amount you were charged, including any processing fee.
                </Section>
                <Section title="5. Partial Refunds">
                  Where a partial refund applies — for example, a non-refundable deposit with a refundable balance — the non-refundable portion is paid out to cover the vendor's costs in holding your date, and only the remaining balance is returned to you.
                </Section>
                <Section title="6. Non-Card Payments">
                  If you paid using a method other than a card, refunds for that payment may need to be processed manually rather than automatically through PayHere, which can take a little longer. Our support team will confirm the expected timeline when this applies.
                </Section>
                <Section title="7. How to Request a Refund">
                  Open the support chat, enter your booking ID, and select the issue that applies. Most refund requests are reviewed within a few hours, and urgent issues (no-shows, safety concerns) are prioritised.
                </Section>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ExplorePage({ user, token, onVendorSelect, onShowAuth, favoriteIds, onToggleFavorite, startWithSavedOnly, onConsumedSavedJump }) {
  const [vendors, setVendors] = useState([]);
  const [ratingsMap, setRatingsMap] = useState({}); // vendor_id -> { avg, count }
  const [platformRating, setPlatformRating] = useState(null); // { avg, count } across all vendors
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("All Locations");
  const [showGrid, setShowGrid] = useState(true);
  const [showSavedOnly, setShowSavedOnly] = useState(!!startWithSavedOnly);
  const [sortBy, setSortBy] = useState("default"); // default | price_asc | price_desc | rating_desc
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [policyTab, setPolicyTab] = useState(null); // null | "terms" | "refunds"

  // Consume the one-time "jump to saved" signal from the dashboard so it
  // doesn't keep re-triggering on every re-render of this component.
  useEffect(() => {
    if (startWithSavedOnly) { setShowSavedOnly(true); onConsumedSavedJump && onConsumedSavedJump(); }
  }, [startWithSavedOnly, onConsumedSavedJump]);

  const fetchVendors = useCallback(async () => {
    setLoading(true);
    // Only approved listings are shown publicly — pending applications and
    // rejected ones stay invisible here until an admin approves them.
    let params = "?select=*&status=eq.approved&order=created_at.desc";
    if (category !== "all") params += `&category=eq.${category}`;
    const { data } = await sb.query("vendors", params, null);
    const list = data || [];
    setVendors(list);
    setLoading(false);

    // One batched query for every visible vendor's reviews, instead of one
    // request per card — keeps the Explore grid fast no matter how many
    // vendors are shown.
    if (list.length) {
      const ids = list.map(v => v.id).join(",");
      const { data: allReviews } = await sb.query("reviews", `?vendor_id=in.(${ids})&select=vendor_id,rating`, null);
      const map = {};
      (allReviews || []).forEach(r => {
        if (!map[r.vendor_id]) map[r.vendor_id] = { sum: 0, count: 0 };
        map[r.vendor_id].sum += r.rating || 0;
        map[r.vendor_id].count += 1;
      });
      const avgMap = {};
      Object.entries(map).forEach(([vid, { sum, count }]) => { avgMap[vid] = { avg: sum / count, count }; });
      setRatingsMap(avgMap);
    } else {
      setRatingsMap({});
    }
  }, [category]);

  useEffect(() => { fetchVendors(); }, [fetchVendors]);

  // Platform-wide average across ALL vendors/reviews (independent of the
  // category filter above) — used only for the homepage trust-bar stat, so
  // it doesn't shift every time someone narrows the category filter.
  useEffect(() => {
    sb.query("reviews", "?select=rating", null).then(({ data }) => {
      const list = data || [];
      if (!list.length) { setPlatformRating(null); return; }
      setPlatformRating({ avg: list.reduce((s, r) => s + (r.rating || 0), 0) / list.length, count: list.length });
    });
  }, []);

  const filtered = vendors.filter(v => {
    const mSearch = v.name?.toLowerCase().includes(search.toLowerCase()) || v.location?.toLowerCase().includes(search.toLowerCase());
    const mLoc = location === "All Locations" || v.location?.toLowerCase().includes(location.toLowerCase());
    const mSaved = !showSavedOnly || favoriteIds?.has(v.id);
    const price = v.base_price || 0;
    const mPriceMin = !priceMin || price >= parseFloat(priceMin);
    const mPriceMax = !priceMax || price <= parseFloat(priceMax);
    return mSearch && mLoc && mSaved && mPriceMin && mPriceMax;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "price_asc") return (a.base_price || 0) - (b.base_price || 0);
    if (sortBy === "price_desc") return (b.base_price || 0) - (a.base_price || 0);
    if (sortBy === "rating_desc") {
      const ra = ratingsMap[a.id]?.avg || 0, rb = ratingsMap[b.id]?.avg || 0;
      if (rb !== ra) return rb - ra;
      // Tie-break by review count so a 5.0 from 1 review doesn't outrank a
      // 4.9 from 50 — more-reviewed vendors are the more reliable signal.
      return (ratingsMap[b.id]?.count || 0) - (ratingsMap[a.id]?.count || 0);
    }
    return 0; // "default" keeps the server's created_at.desc order
  });

  const activeFilterCount = (priceMin ? 1 : 0) + (priceMax ? 1 : 0) + (sortBy !== "default" ? 1 : 0);

  const vendorCounts = {};
  CATEGORIES.forEach(c => { vendorCounts[c.id] = vendors.filter(v => v.category === c.id).length; });
  const activeCategory = CATEGORIES.find(c => c.id === category);

  return (
    <div style={{ minHeight: "100vh", background: B.bg, paddingBottom: "clamp(16px, 10vw, 90px)" }}>
      <div className="evara-page-header" style={{ background: B.dark, padding: "52px 0 28px", position: "relative", overflow: "hidden" }}>
        {!user && <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(212,175,106,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(212,175,106,0.04) 1px,transparent 1px)", backgroundSize: "44px 44px", pointerEvents: "none" }}/>}
        <div className="evara-page-header-inner" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, position: "relative", zIndex: 1 }}>
          <div>
            <EvaraLogo size="md" dark onClick={() => { setCategory("all"); setSearch(""); setLocation("All Locations"); setShowGrid(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}/>
            {user && <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>Welcome back, {user.user_metadata?.full_name?.split(" ")[0] || "there"}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {user && (
              <button onClick={() => setShowSavedOnly(s => !s)} aria-label="Show saved vendors" title="Saved vendors" style={{ width: 36, height: 36, borderRadius: "50%", background: showSavedOnly ? "rgba(255,107,129,0.18)" : "rgba(255,255,255,0.08)", border: `1px solid ${showSavedOnly ? "rgba(255,107,129,0.4)" : "rgba(255,255,255,0.14)"}`, color: showSavedOnly ? "#FF6B81" : "rgba(255,255,255,0.85)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill={showSavedOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              </button>
            )}
            {/* Desktop already shows notifications in the sidebar nav — this is the mobile-only equivalent, since there's no sidebar on small screens. */}
            {user && <div className="mobile-signin-btn"><NotificationBell user={user} token={token} variant="header" onNavigateToBooking={() => window.__evaraSetTab && window.__evaraSetTab("bookings")}/></div>}
            <ThemeToggle variant="header"/>
            {!user && <button onClick={onShowAuth} className="mobile-signin-btn" style={{ padding: "9px 20px", borderRadius: 20, background: B.accent, color: B.dark, fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer" }}>Sign In</button>}
          </div>
        </div>
        {!user && (
          <div className="evara-page-header-inner" style={{ marginBottom: 18, position: "relative", zIndex: 1 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(212,175,106,0.1)", border: "1px solid rgba(212,175,106,0.25)", borderRadius: 16, padding: "5px 12px 5px 7px", marginBottom: 14 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: B.accent, display: "inline-block" }}/>
              <span style={{ fontSize: 11, fontWeight: 700, color: B.accent, letterSpacing: 0.3 }}>Sri Lanka's #1 Event Platform</span>
            </div>
            <div className="hero-title" style={{ fontSize: 28, fontFamily: "'Playfair Display',serif", color: "#fff", fontWeight: 700, lineHeight: 1.2, marginBottom: 8, letterSpacing: -0.5 }}>Your perfect event,<br/><em style={{ color: B.accent, fontStyle: "italic" }}>planned in minutes</em></div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, maxWidth: 420 }}>Browse verified wedding halls, chefs, DJs, photographers & more across every district. Pay safely with secure payment protection.</div>
          </div>
        )}
        <div className="evara-page-header-inner" style={{ maxWidth: "none", position: "relative", zIndex: 1 }}>
          <LocationSearchBar search={search} setSearch={setSearch} setShowGrid={setShowGrid} location={location} setLocation={setLocation}/>
        </div>
      </div>

      {!user && (
        <div style={{ background: B.surface, borderBottom: `1px solid ${B.border}`, display: "flex", justifyContent: "center" }}>
          <div style={{ display: "flex", width: "100%" }}>
            {[["2,400+", "Verified vendors"], ["18,000+", "Events booked"], ["25", "Districts"], [platformRating ? `${platformRating.avg.toFixed(1)}★` : "New", "Avg. rating"]].map(([n, l], i) => (
              <div key={i} style={{ flex: 1, padding: "14px 8px", textAlign: "center", borderRight: i < 3 ? `1px solid ${B.border}` : "none" }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, fontWeight: 700, color: B.text }}>{n}</div>
                <div style={{ fontSize: 10, color: B.textMuted, fontWeight: 500, marginTop: 1 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="trust-bar" style={{ display: "flex", gap: 8, padding: "14px 16px 0", justifyContent: "center" }}>
        {[
          { icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1A9B6C" strokeWidth="2.2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>, label: "Secure Payments" },
          { icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0369A1" strokeWidth="2.2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>, label: "Verified Vendors" },
          { icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#D4AF6A" strokeWidth="2.2" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>, label: "Instant Booking" },
        ].map((b, i) => (
          <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, background: B.surface, borderRadius: 10, padding: "8px 10px", border: `1px solid ${B.border}` }}>
            {b.icon}
            <span style={{ fontSize: 11, fontWeight: 600, color: B.textMuted }}>{b.label}</span>
          </div>
        ))}
      </div>

      {showGrid && category === "all" && !search ? (
        <div style={{ padding: "20px 16px 0", maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 700, color: B.text }}>Browse by Category</div>
          </div>
          <div style={{ fontSize: 12, color: B.textMuted, marginBottom: 16 }}>Choose a service to see available vendors</div>
          <div className="cat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {CATEGORIES.filter(c => c.id !== "all").map(cat => {
              const active = category === cat.id;
              return (
                <button key={cat.id} onClick={() => { setCategory(cat.id); setShowGrid(false); }} style={{ background: B.surface, border: `1.5px solid ${active ? B.accent : B.border}`, borderRadius: 16, padding: "16px 14px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12, transition: "transform .15s, box-shadow .15s, border-color .15s", boxShadow: active ? `0 0 0 1.5px ${B.accent}, 0 6px 18px rgba(28,43,75,0.08)` : "0 1px 3px rgba(28,43,75,0.05)", position: "relative" }} onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = active ? `0 0 0 1.5px ${B.accent}, 0 10px 24px rgba(28,43,75,0.12)` : "0 8px 20px rgba(28,43,75,0.1)"; }} onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = active ? `0 0 0 1.5px ${B.accent}, 0 6px 18px rgba(28,43,75,0.08)` : "0 1px 3px rgba(28,43,75,0.05)"; }}>
                  {active && <div style={{ position: "absolute", top: 10, right: 10, width: 18, height: 18, borderRadius: "50%", background: B.accent, display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={B.dark} strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg></div>}
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: cat.tint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {getCatIcon(cat.id, 21, B.primary)}
                  </div>
                  <div style={{ textAlign: "left", width: "100%" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: active ? B.primary : B.text, lineHeight: 1.3 }}>{cat.label}</div>
                    <div style={{ fontSize: 11, color: B.textMuted, marginTop: 2 }}>{vendorCounts[cat.id] > 0 ? `${vendorCounts[cat.id]} vendors` : "Coming soon"}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {!user && (
            <>
              {/* ── How it works ── */}
              <div style={{ background: B.dark, borderRadius: 18, padding: "32px 22px", marginTop: 40 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: B.accent, marginBottom: 8 }}>Simple from start to finish</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 24 }}>Book in three steps</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {[
                    { n: "01", title: "Browse & compare", desc: "Search by category, district, and budget. Every vendor has verified reviews and clear pricing.",
                      icon: <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></> },
                    { n: "02", title: "Book instantly", desc: "Choose your date, package and guest count. Get instant confirmation — no phone calls needed.",
                      icon: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></> },
                    { n: "03", title: "Pay safely, enjoy", desc: "Payment is securely processed via PayHere and only released after your event. Zero risk.",
                      icon: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/> },
                  ].map(s => (
                    <div key={s.n} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                      <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 700, color: "rgba(212,175,106,0.25)", lineHeight: 1, flexShrink: 0, width: 36 }}>{s.n}</div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ color: B.accent, display: "flex" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{s.icon}</svg></span>
                          <span style={{ fontSize: 14.5, fontWeight: 700, color: "#fff" }}>{s.title}</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>{s.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Trust ── */}
              <div style={{ marginTop: 32 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: B.accent, marginBottom: 8 }}>Why Evara</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 700, color: B.text, marginBottom: 16 }}>Built for Sri Lankan events</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { bg: "#EDFAF4", stroke: "#1A9B6C", title: "Secure payment protection", text: "Your money is held securely and only released to the vendor after your event completes.", icon: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/> },
                    { bg: "#E8F5FF", stroke: "#0369A1", title: "Verified vendors only", text: "Every vendor is reviewed before appearing on Evara — real photos, authentic reviews.", icon: <polyline points="20 6 9 17 4 12"/> },
                    { bg: B.accentSoft || "#FBF5E9", stroke: "#B8923E", title: "Instant confirmation", text: "Book online and get a digital receipt immediately. No back-and-forth calls needed.", icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></> },
                  ].map((t, i) => (
                    <div key={i} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 14, padding: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <div style={{ width: 38, height: 38, borderRadius: 10, background: t.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={t.stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{t.icon}</svg>
                      </div>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: B.text, marginBottom: 3 }}>{t.title}</div>
                        <div style={{ fontSize: 12, color: B.textMuted, lineHeight: 1.55 }}>{t.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Testimonials ── */}
              <div style={{ marginTop: 32 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: B.accent, marginBottom: 8 }}>From our community</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 700, color: B.text, marginBottom: 16 }}>What people are saying</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { q: "Found our wedding photographer in 10 minutes. Real portfolio, clear pricing, and secure payment gave us complete peace of mind.", init: "AT", name: "Amaya & Thilina", role: "Wedding · Kandy" },
                    { q: "I compared five catering companies side by side with prices upfront. Booked in 20 minutes — never going back to WhatsApp enquiries.", init: "RD", name: "Ruwanthi D.", role: "Corporate event · Colombo" },
                    { q: "As a vendor, Evara tripled my bookings in two months. Simple dashboard, fast payments, customers come pre-qualified.", init: "NK", name: "Nalaka K.", role: "DJ · Vendor on Evara", dark: true },
                  ].map((t, i) => (
                    <div key={i} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 14, padding: 18 }}>
                      <div style={{ fontSize: 13, color: B.text, lineHeight: 1.65, fontStyle: "italic", marginBottom: 14 }}>"{t.q}"</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: t.dark ? "linear-gradient(135deg,#1C2B4B,#3A5080)" : `linear-gradient(135deg,${B.accent},#B8923E)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: t.dark ? "#fff" : B.dark, flexShrink: 0 }}>{t.init}</div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: B.text }}>{t.name}</div>
                          <div style={{ fontSize: 10.5, color: B.textMuted }}>{t.role}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Footer ── */}
              <div style={{ background: B.dark, borderRadius: 18, padding: "28px 22px", marginTop: 32 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <EvaraLogo size="sm" dark/>
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.6, marginBottom: 18 }}>Sri Lanka's trusted event booking platform. Connect with verified vendors across all 25 districts.</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "4px 9px" }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(212,175,106,0.7)" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>Secured by PayHere</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "4px 9px" }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(212,175,106,0.7)" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>SSL Secured</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
                  <button onClick={() => setPolicyTab("terms")} style={{ background: "none", border: "none", padding: 0, fontSize: 11.5, color: "rgba(255,255,255,0.45)", fontWeight: 600, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.2)" }}>Terms & Conditions</button>
                  <button onClick={() => setPolicyTab("refunds")} style={{ background: "none", border: "none", padding: 0, fontSize: 11.5, color: "rgba(255,255,255,0.45)", fontWeight: 600, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.2)" }}>Refund Policy</button>
                </div>
                <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.22)", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>© 2026 Evara. All rights reserved. Made in Sri Lanka 🇱🇰</div>
              </div>
              {policyTab && <PolicyModal initialTab={policyTab} onClose={() => setPolicyTab(null)}/>}
            </>
          )}
        </div>
      ) : (
        <div>
          {category !== "all" && (
            <div style={{ padding: "16px 16px 0", display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => { setCategory("all"); setShowGrid(true); }} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 10, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: B.textMuted, cursor: "pointer" }}>← All</button>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, overflow: "hidden", border: `1px solid ${B.border}`, flexShrink: 0 }}>
                  {activeCategory?.photo
                    ? <img src={activeCategory.photo} alt={activeCategory.label} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                    : <div style={{ width: "100%", height: "100%", background: B.surface, display: "flex", alignItems: "center", justifyContent: "center", color: B.primary }}>{getCatIcon(activeCategory?.id, 18, B.primary)}</div>
                  }
                </div>
                <div><div style={{ fontWeight: 700, fontSize: 15, color: B.text }}>{activeCategory?.label}</div><div style={{ fontSize: 11, color: B.textMuted }}>{filtered.length} vendor{filtered.length !== 1 ? "s" : ""} found</div></div>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 16px 0", scrollbarWidth: "none" }}>
            {CATEGORIES.map(cat => {
              const active = category === cat.id;
              return (
                <button key={cat.id} onClick={() => { setCategory(cat.id); if (cat.id === "all") setShowGrid(true); else setShowGrid(false); }} style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", padding: "7px 14px", borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: active ? B.primary : B.surface, color: active ? "#fff" : B.textMuted, border: `1.5px solid ${active ? B.primary : B.border}`, flexShrink: 0, transition: "all .15s" }}>
                  <span style={{ color: active ? "#fff" : B.primary, display: "flex", alignItems: "center" }}>{cat.id === "all" ? getCatIcon("all", 13, active ? "#fff" : B.primary) : getCatIcon(cat.id, 13, active ? "#fff" : B.primary)}</span>
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(!showGrid || category !== "all" || search || showSavedOnly || activeFilterCount > 0) && (
        <div className="evara-page-inner" style={{ padding: "16px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10, position: "relative" }}>
            {!loading && filtered.length > 0 ? (
              <div style={{ fontSize: 12, color: B.textMuted, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                {showSavedOnly && <span style={{ color: "#FF6B81", display: "flex" }}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></span>}
                {filtered.length} {showSavedOnly ? "saved vendor" : "vendor"}{filtered.length !== 1 ? "s" : ""} found
              </div>
            ) : <div/>}
            <button onClick={() => setShowFilterPanel(o => !o)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 10, background: activeFilterCount > 0 ? B.accentSoft : B.surface, border: `1.5px solid ${activeFilterCount > 0 ? B.accent : B.border}`, color: activeFilterCount > 0 ? B.accent : B.textMuted, fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="currentColor"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2" fill="currentColor"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2" fill="currentColor"/></svg>
              Sort & Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
            {showFilterPanel && (
              <>
                <div onClick={() => setShowFilterPanel(false)} style={{ position: "fixed", inset: 0, zIndex: 400 }}/>
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 280, maxWidth: "calc(100vw - 32px)", background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, boxShadow: "0 16px 48px rgba(0,0,0,0.18)", padding: 16, zIndex: 401 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: B.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Sort By</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
                    {[["default", "Newest"], ["rating_desc", "Highest Rated"], ["price_asc", "Price: Low to High"], ["price_desc", "Price: High to Low"]].map(([id, label]) => (
                      <button key={id} onClick={() => setSortBy(id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 8, background: sortBy === id ? B.accentSoft : "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                        <span style={{ width: 14, height: 14, borderRadius: "50%", border: `1.5px solid ${sortBy === id ? B.accent : B.border}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{sortBy === id && <span style={{ width: 7, height: 7, borderRadius: "50%", background: B.accent }}/>}</span>
                        <span style={{ fontSize: 13, fontWeight: sortBy === id ? 700 : 500, color: B.text }}>{label}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: B.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Price Range (LKR)</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    <input type="number" value={priceMin} onChange={e => setPriceMin(e.target.value)} placeholder="Min" min="0" style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${B.border}`, background: B.bg, color: B.text, fontSize: 13, outline: "none", boxSizing: "border-box" }}/>
                    <input type="number" value={priceMax} onChange={e => setPriceMax(e.target.value)} placeholder="Max" min="0" style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${B.border}`, background: B.bg, color: B.text, fontSize: 13, outline: "none", boxSizing: "border-box" }}/>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => { setSortBy("default"); setPriceMin(""); setPriceMax(""); }} style={{ flex: 1, padding: 10, borderRadius: 9, background: "transparent", border: `1.5px solid ${B.border}`, color: B.textMuted, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Reset</button>
                    <button onClick={() => setShowFilterPanel(false)} style={{ flex: 1, padding: 10, borderRadius: 9, background: B.primary, border: "none", color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Apply</button>
                  </div>
                </div>
              </>
            )}
          </div>
          {loading ? (
            <div className="vendor-grid" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[1, 2, 3, 4].map(i => <div key={i} style={{ background: B.surface, borderRadius: 16, border: `1px solid ${B.border}`, padding: 16, display: "flex", gap: 12 }}><Skeleton w={72} h={72} r={12}/><div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}><Skeleton h={16} w="60%"/><Skeleton h={12} w="40%"/><Skeleton h={12} w="80%"/></div></div>)}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: B.surface, border: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: B.textMuted }}>
                {showSavedOnly ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> : <Icon.Search/>}
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: B.text, marginBottom: 6 }}>{showSavedOnly ? "No saved vendors yet" : "No vendors found"}</div>
              <div style={{ fontSize: 13, color: B.textMuted, marginBottom: 20 }}>{showSavedOnly ? "Tap the heart on a vendor to save it here" : "Try a different category or search term"}</div>
              <button onClick={() => { setCategory("all"); setSearch(""); setLocation("All Locations"); setShowGrid(true); setShowSavedOnly(false); setSortBy("default"); setPriceMin(""); setPriceMax(""); }} style={{ padding: "10px 24px", borderRadius: 10, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer" }}>Browse All</button>
            </div>
          ) : (
            <div className="vendor-grid" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {sorted.map(v => <VendorCard key={v.id} vendor={v} onSelect={onVendorSelect} rating={ratingsMap[v.id]} isFavorited={favoriteIds?.has(v.id)} onToggleFavorite={user ? onToggleFavorite : null} onNeedAuth={onShowAuth}/>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Bookings Page with PayHere integration ───────────────────────────────────
function BookingsPage({ user, token, onShowAuth, showToast }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [receipt, setReceipt] = useState(null);
  const [payingId, setPayingId] = useState(null);
  const [releasingId, setReleasingId] = useState(null);
  const [reviewedBookingIds, setReviewedBookingIds] = useState(new Set());
  const [reviewBooking, setReviewBooking] = useState(null);

  const fetch = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await sb.query("bookings", `?user_id=eq.${user.id}&select=*,vendors(name,category,location)&order=created_at.desc`, token);
    setBookings(data || []);
    setLoading(false);
    // Find which of this user's bookings already have a review, so we don't
    // show "Rate this vendor" twice for the same completed booking.
    const { data: myReviews } = await sb.query("reviews", `?user_id=eq.${user.id}&select=booking_id`, token);
    setReviewedBookingIds(new Set((myReviews || []).map(r => r.booking_id)));
  }, [user, token]);

  useEffect(() => { fetch(); }, [fetch]);

  const requestRelease = async (booking) => {
    setReleasingId(booking.id);
    const { error } = await sb.query("bookings", `?id=eq.${booking.id}`, token, "PATCH", { status: "release_requested" });
    setReleasingId(null);
    if (error) { showToast("Update failed", "error"); return; }
    setBookings(prev => prev.map(b => b.id === booking.id ? { ...b, status: "release_requested" } : b));
    showToast("Payment release requested! Admin will process within 24 hours.", "success");
  };

  const handlePayNow = (booking) => {
    setPayingId(booking.id);
    const vendor = booking.vendors || { name: "Vendor", id: booking.vendor_id };
    initiatePayHerePayment({
      booking, vendor, user,
      onSuccess: async (orderId) => {
        const { error } = await sb.query("bookings", `?id=eq.${booking.id}`, token, "PATCH", {
          status: "paid", payment_method: "payhere", payment_date: new Date().toISOString(), payhere_order_id: orderId,
        });
        setPayingId(null);
        if (error) { showToast("Payment recorded but update failed. Contact support.", "error"); return; }
        setBookings(prev => prev.map(b => b.id === booking.id ? { ...b, status: "paid", payment_method: "payhere" } : b));
        showToast("Payment successful! 🎉 Your payment is protected.", "success");
      },
      onError: () => { setPayingId(null); showToast("Payment failed. Try again.", "error"); }
    });
  };

  if (!user) {
    return (
      <div style={{ minHeight: "100vh", background: B.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: B.surface, border: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: B.textMuted }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <div style={{ fontWeight: 700, fontSize: 18, color: B.text, marginBottom: 8 }}>Sign in to see your bookings</div>
        <button onClick={onShowAuth} style={{ padding: "12px 32px", borderRadius: 12, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 15, border: "none", cursor: "pointer" }}>Sign In</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: B.bg, paddingBottom: "clamp(16px, 10vw, 90px)" }}>
      <div className="evara-page-header" style={{ background: B.dark, padding: "52px 0 20px" }}>
        <div className="evara-page-header-inner">
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, fontWeight: 700, color: "#fff" }}>My Bookings</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>Track your events & payments</div>
        </div>
      </div>
      <div className="evara-page-inner" style={{ padding: 16 }}>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3].map(i => <div key={i} style={{ background: B.surface, borderRadius: 16, height: 130, border: `1px solid ${B.border}` }}><Skeleton h="100%" r={16}/></div>)}
          </div>
        ) : bookings.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: B.surface, border: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: B.textMuted }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div style={{ fontWeight: 700, fontSize: 18, color: B.text, marginBottom: 8 }}>No bookings yet</div>
            <div style={{ fontSize: 14, color: B.textMuted }}>Start exploring to book your first vendor</div>
          </div>
        ) : (
          <div className="bookings-grid" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {bookings.map(booking => {
              const ss = STATUS_STYLE[booking.status] || STATUS_STYLE.pending;
              const isPaying = payingId === booking.id;
              return (
                <div key={booking.id} style={{ background: B.surface, borderRadius: 16, border: `1px solid ${B.border}`, padding: 16 }}>
                  <div onClick={() => setReceipt(booking)} style={{ cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: B.text }}>{booking.vendors?.name || "Vendor"}</div>
                        <div style={{ fontSize: 12, color: B.textMuted, marginTop: 2 }}>{CAT_LABELS[booking.vendors?.category] || booking.vendors?.category}</div>
                      </div>
                      <div style={{ background: ss.bg, color: ss.c, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, border: `1px solid ${ss.c}33` }}>{ss.label}</div>
                    </div>
                    <div style={{ display: "flex", gap: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: B.textMuted }}><Icon.Calendar/>{formatDate(booking.event_date)}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: B.textMuted }}><Icon.Users/>{booking.guests || "—"} guests</div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${B.border}` }}>
                      <span style={{ fontSize: 12, color: B.textMuted }}>#{shortId(booking.id)}</span>
                      <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, fontWeight: 700, color: B.primary }}>{fmt(booking.amount)}</span>
                    </div>
                  </div>

                  {/* Action buttons based on status */}
                  {booking.status === "confirmed" && !booking.payment_method && (
                    <button onClick={() => handlePayNow(booking)} disabled={isPaying} style={{ marginTop: 12, width: "100%", padding: 10, borderRadius: 10, background: isPaying ? B.textLight : "#0F3460", color: "#fff", fontWeight: 700, fontSize: 13, cursor: isPaying ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                      {isPaying ? <>Processing...</> : <><Icon.CreditCard/> Pay Now via PayHere</>}
                    </button>
                  )}
                  {booking.status === "paid" && (
                    <button onClick={() => requestRelease(booking)} disabled={releasingId === booking.id} style={{ marginTop: 12, width: "100%", padding: 10, borderRadius: 10, background: "#FFF4E5", border: "1.5px solid #C0562133", color: "#C05621", fontWeight: 700, fontSize: 13, cursor: releasingId === booking.id ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                      <Icon.Unlock/>{releasingId === booking.id ? "Requesting…" : "Event Done — Request Payment Release"}
                    </button>
                  )}
                  {booking.status === "completed" && (
                    reviewedBookingIds.has(booking.id) ? (
                      <div style={{ marginTop: 12, width: "100%", padding: 10, borderRadius: 10, background: B.accentSoft, color: B.textMuted, fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                        <Icon.Check/> You reviewed this vendor
                      </div>
                    ) : (
                      <button onClick={() => setReviewBooking(booking)} style={{ marginTop: 12, width: "100%", padding: 10, borderRadius: 10, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, border: "none" }}>
                        <Icon.Star filled/> Rate this vendor
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {receipt && <Receipt booking={receipt} onClose={() => setReceipt(null)}/>}
      {reviewBooking && (
        <ReviewModal
          booking={reviewBooking}
          token={token}
          showToast={showToast}
          onClose={() => setReviewBooking(null)}
          onSubmitted={() => setReviewedBookingIds(prev => new Set(prev).add(reviewBooking.id))}
        />
      )}
    </div>
  );
}

// ─── Profile Page ─────────────────────────────────────────────────────────────
function ProfilePage({ user, token, onSignOut, onShowAuth, isVendor, isAdmin, onVendorApplicationSubmitted }) {
  const [policyTab, setPolicyTab] = useState(null); // null | "terms" | "refunds"
  const [showVendorApp, setShowVendorApp] = useState(false);
  if (!user) {
    return (
      <div style={{ minHeight: "100vh", background: B.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ fontSize: 60, marginBottom: 16 }}>👤</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: B.text, marginBottom: 8 }}>Sign in to view profile</div>
        <button onClick={onShowAuth} style={{ padding: "12px 32px", borderRadius: 12, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 15, border: "none", cursor: "pointer", marginTop: 8 }}>Sign In</button>
      </div>
    );
  }
  const name = user.user_metadata?.full_name || user.email?.split("@")[0] || "User";
  const initials = name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div style={{ minHeight: "100vh", background: B.bg, paddingBottom: "clamp(16px, 10vw, 90px)" }}>
      <div className="evara-page-header" style={{ background: B.dark, padding: "52px 0 30px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: B.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: B.dark, marginBottom: 12 }}>{initials}</div>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{name}</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>{user.email}</div>
      </div>
      <div className="evara-page-inner" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: B.surface, borderRadius: 16, border: `1px solid ${B.border}`, overflow: "hidden" }}>
          {[["Name", name], ["Email", user.email], ["Member since", formatDate(user.created_at)]].map(([label, value], i, arr) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${B.border}` : "none" }}>
              <span style={{ fontSize: 13, color: B.textMuted }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: B.text, textAlign: "right", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
            </div>
          ))}
        </div>
        <div style={{ background: "#E8F5FF", borderRadius: 14, padding: "14px 16px", border: "1px solid rgba(3,105,161,0.2)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0369A1", marginBottom: 6 }}>💳 PayHere Payments</div>
          <div style={{ fontSize: 12, color: "#0369A1", lineHeight: 1.6 }}>All payments are processed securely through PayHere. Your payment information is never stored on Evara's servers.</div>
        </div>
        <div style={{ background: B.accentSoft, borderRadius: 14, padding: "14px 16px", border: `1px solid ${B.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: B.text, marginBottom: 6 }}>🛡️ Payment Protection</div>
          <div style={{ fontSize: 12, color: B.textMuted, lineHeight: 1.6 }}>All payments on Evara are held securely until your event is completed, protecting both you and the vendor.</div>
        </div>
        {!isVendor && !isAdmin && (
          <button onClick={() => setShowVendorApp(true)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: B.surface, borderRadius: 14, padding: "14px 16px", border: `1.5px solid ${B.accent}55`, cursor: "pointer" }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: B.accentSoft, color: B.primary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon.TrendUp/></span>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: B.text }}>Become a Vendor</span>
              <span style={{ display: "block", fontSize: 12, color: B.textMuted, marginTop: 1 }}>List your business and start getting bookings</span>
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={B.textMuted} strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        )}
        <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, overflow: "hidden" }}>
          <ThemeToggle variant="row"/>
        </div>
        <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, overflow: "hidden" }}>
          {[{ id: "terms", label: "Terms & Conditions" }, { id: "refunds", label: "Refund Policy" }].map((p, i) => (
            <button key={p.id} onClick={() => setPolicyTab(p.id)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "none", border: "none", borderBottom: i === 0 ? `1px solid ${B.border}` : "none", cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: B.text }}>{p.label}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={B.textMuted} strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          ))}
        </div>
        <button onClick={onSignOut} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: 14, borderRadius: 12, background: "#FEF2F2", color: B.danger, fontWeight: 700, fontSize: 14, border: `1.5px solid #D9404033`, cursor: "pointer" }}>
          <Icon.LogOut/> Sign Out
        </button>
      </div>
      {policyTab && <PolicyModal initialTab={policyTab} onClose={() => setPolicyTab(null)}/>}
      {showVendorApp && <VendorApplicationModal user={user} token={token} onClose={() => setShowVendorApp(false)} onSubmitted={onVendorApplicationSubmitted}/>}
    </div>
  );
}

// ─── Vendor Application (self-serve onboarding) ──────────────────────────────
// Lets a signed-in customer apply to list their own business, instead of
// requiring an admin to create the listing and link the account by hand.
// The application lands as status='pending' — invisible on Explore — until
// an admin approves it from the Admin → Vendors → Pending tab.
function VendorApplicationModal({ user, token, onClose, onSubmitted }) {
  const [form, setForm] = useState({ name: "", category: "wedding", location: "", base_price: "", description: "", response_time: "", phone: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim() || !form.location.trim() || !form.base_price) { setError("Please fill in your business name, location, and starting price."); return; }
    setLoading(true); setError("");
    const body = {
      user_id: user.id,
      status: "pending",
      name: form.name.trim(),
      category: form.category,
      location: form.location.trim(),
      base_price: parseFloat(form.base_price) || 0,
      description: form.description.trim() || null,
      response_time: form.response_time.trim() || null,
    };
    const { error: err } = await sb.query("vendors", "", token, "POST", body);
    if (err) {
      setLoading(false);
      setError(err.message?.includes("duplicate") ? "You already have a vendor application or listing on Evara." : (err.message || "Couldn't submit your application. Please try again."));
      return;
    }
    // Flip their profile role to vendor so they get routed to the Vendor
    // dashboard (which shows a "pending review" state) instead of staying
    // on the customer Explore/Bookings view after this.
    await sb.query("profiles", `?id=eq.${user.id}`, token, "PATCH", { role: "vendor" });
    setLoading(false);
    onSubmitted && onSubmitted();
    onClose();
  };

  const inputStyle = { width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${B.border}`, background: B.bg, fontSize: 14, color: B.text, outline: "none", boxSizing: "border-box" };
  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: B.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(12,22,40,0.65)", backdropFilter: "blur(4px)" }}/>
      <div style={{ position: "fixed", inset: 0, zIndex: 700, display: "flex", alignItems: "flex-end", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "100%", maxWidth: 480, maxHeight: "92vh", background: B.bg, borderRadius: "22px 22px 0 0", overflow: "hidden", display: "flex", flexDirection: "column", pointerEvents: "all", animation: "slideUp .35s cubic-bezier(.22,1,.36,1) both" }}>
          <div style={{ padding: "16px 20px", background: B.surface, borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>Become a Vendor</div>
              <div style={{ fontSize: 12, color: B.textMuted, marginTop: 2 }}>List your business on Evara</div>
            </div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 8, border: `1.5px solid ${B.border}`, background: B.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: B.textMuted }}><Icon.X/></button>
          </div>
          <div style={{ overflowY: "auto", flex: 1, padding: "20px 16px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: B.accentSoft, borderRadius: 12, padding: "12px 14px", fontSize: 12.5, color: B.textMuted, lineHeight: 1.55, display: "flex", gap: 8 }}>
              <span style={{ flexShrink: 0, color: B.primary }}><Icon.Shield/></span>
              Your listing won't appear publicly until our team reviews and approves it — usually within a day or two.
            </div>
            <div><label style={labelStyle}>Business Name *</label><input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Grand Royal Banquet Hall" style={inputStyle}/></div>
            <div><label style={labelStyle}>Category *</label><select value={form.category} onChange={e => set("category", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>{VENDOR_CATEGORIES.map(({ id, label, emoji }) => <option key={id} value={id}>{emoji} {label}</option>)}</select></div>
            <div><label style={labelStyle}>Location *</label><input value={form.location} onChange={e => set("location", e.target.value)} placeholder="e.g. Colombo 03, Sri Lanka" style={inputStyle}/></div>
            <div><label style={labelStyle}>Contact Phone</label><input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="07X XXX XXXX" style={inputStyle}/></div>
            <div><label style={labelStyle}>Starting Price (LKR) *</label><input type="number" value={form.base_price} onChange={e => set("base_price", e.target.value)} placeholder="e.g. 50000" style={inputStyle} min="0"/></div>
            <div><label style={labelStyle}>Typical Response Time</label><input value={form.response_time} onChange={e => set("response_time", e.target.value)} placeholder="e.g. < 1hr" style={inputStyle}/></div>
            <div><label style={labelStyle}>Tell customers about your business</label><textarea value={form.description} onChange={e => set("description", e.target.value)} placeholder="What makes your service stand out?" style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}/></div>
            {error && <div style={{ background: "#FEF2F2", border: "1px solid #D9404033", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: B.danger, fontWeight: 600 }}>{error}</div>}
            <button onClick={submit} disabled={loading} style={{ width: "100%", padding: 14, borderRadius: 12, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 15, border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, marginTop: 4 }}>
              {loading ? "Submitting…" : "Submit Application"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}


// Shown to signed-in customers (not admins/vendors) when they tap the
// "Dashboard" tab. Gives a quick at-a-glance summary of their activity on
// Evara — upcoming events, spend, and a shortcut back into My Bookings.
function CustomerDashboard({ user, token, onGoToBookings, onGoToExplore, favoritesCount, onGoToSaved }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchBookings = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await sb.query("bookings", `?user_id=eq.${user.id}&select=*,vendors(name,category,location)&order=created_at.desc`, token);
    setBookings(data || []);
    setLoading(false);
  }, [user, token]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  const name = user?.user_metadata?.full_name?.split(" ")[0] || "there";
  const today = new Date();
  const upcoming = bookings.filter(b => b.event_date && new Date(b.event_date) >= today && !["cancelled"].includes(b.status));
  const completed = bookings.filter(b => b.status === "completed" || b.status === "released");
  const totalSpent = bookings.filter(b => ["paid", "release_requested", "released", "completed"].includes(b.status)).reduce((s, b) => s + (b.amount || 0), 0);
  const nextEvent = [...upcoming].sort((a, b) => new Date(a.event_date) - new Date(b.event_date))[0];

  const stats = [
    { label: "Total Bookings", value: bookings.length, icon: <Icon.Bookmark/> },
    { label: "Upcoming Events", value: upcoming.length, icon: <Icon.Calendar/> },
    { label: "Completed", value: completed.length, icon: <Icon.Check/> },
    { label: "Total Spent", value: fmt(totalSpent), icon: <Icon.CreditCard/> },
  ];

  return (
    <div style={{ minHeight: "100vh", background: B.bg, paddingBottom: "clamp(16px, 10vw, 90px)" }}>
      <div className="evara-page-header" style={{ background: B.dark, padding: "52px 0 28px" }}>
        <div className="evara-page-header-inner">
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, fontWeight: 700, color: "#fff" }}>My Dashboard</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>Welcome back, {name} 👋</div>
        </div>
      </div>

      <div className="evara-page-inner" style={{ padding: 16 }}>
        {loading ? (
          <div className="dash-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 20 }}>
            {[1, 2, 3, 4].map(i => <div key={i} style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16, height: 78 }}><Skeleton h="100%" r={14}/></div>)}
          </div>
        ) : (
          <div className="dash-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 20 }}>
            {stats.map((s, i) => (
              <div key={i} style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: B.accentSoft, color: B.primary, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>{s.icon}</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 19, fontWeight: 700, color: B.text }}>{s.value}</div>
                <div style={{ fontSize: 11.5, color: B.textMuted, marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {!loading && nextEvent && (
          <div style={{ background: B.surface, borderRadius: 16, border: `1.5px solid ${B.accent}55`, padding: 18, marginBottom: 20, position: "relative", overflow: "hidden" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: B.accent, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 8 }}>Your Next Event</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>{nextEvent.vendors?.name || "Vendor"}</div>
                <div style={{ fontSize: 12, color: B.textMuted, marginTop: 2 }}>{CAT_LABELS[nextEvent.vendors?.category] || nextEvent.vendors?.category}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: B.textMuted, marginTop: 8 }}><Icon.Calendar/>{formatDate(nextEvent.event_date)}</div>
              </div>
              <span style={{ background: (STATUS_STYLE[nextEvent.status] || STATUS_STYLE.pending).bg, color: (STATUS_STYLE[nextEvent.status] || STATUS_STYLE.pending).c, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>{(STATUS_STYLE[nextEvent.status] || STATUS_STYLE.pending).label}</span>
            </div>
          </div>
        )}

        {!loading && bookings.length === 0 ? (
          <div style={{ textAlign: "center", padding: "50px 20px" }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: B.surface, border: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: B.textMuted }}>
              <Icon.TrendUp/>
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: B.text, marginBottom: 6 }}>Nothing to show yet</div>
            <div style={{ fontSize: 13, color: B.textMuted, marginBottom: 20 }}>Book your first vendor and your activity will show up here</div>
            <button onClick={onGoToExplore} style={{ padding: "10px 24px", borderRadius: 10, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer" }}>Browse Vendors</button>
          </div>
        ) : (
          <button onClick={onGoToBookings} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer" }}>
            <Icon.Bookmark/> View All Bookings
          </button>
        )}

        {!!favoritesCount && (
          <button onClick={onGoToSaved} style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: B.surface, borderRadius: 14, padding: "14px 16px", border: `1px solid ${B.border}`, cursor: "pointer" }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(255,107,129,0.12)", color: "#FF6B81", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: B.text }}>{favoritesCount} Saved Vendor{favoritesCount !== 1 ? "s" : ""}</span>
              <span style={{ display: "block", fontSize: 12, color: B.textMuted, marginTop: 1 }}>Vendors you've bookmarked to compare later</span>
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={B.textMuted} strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Admin Panel (Fully Functional with Live DB) ──────────────────────────────
function AdminPanel({ user, token, onSignOut, onGoHome }) {
  const [themeMode] = useTheme();
  const [adminTab, setAdminTab] = useState("overview");
  const [vendors, setVendors] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loadingV, setLoadingV] = useState(true);
  const [loadingB, setLoadingB] = useState(true);
  const [loadingT, setLoadingT] = useState(true);
  const [loadingC, setLoadingC] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editVendor, setEditVendor] = useState(null);
  const [showCatForm, setShowCatForm] = useState(false);
  const [editCategory, setEditCategory] = useState(null);
  const [confirmDelCat, setConfirmDelCat] = useState(null);
  const [assignOwnerVendor, setAssignOwnerVendor] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [searchV, setSearchV] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [vendorStatusFilter, setVendorStatusFilter] = useState("all"); // all | pending | approved | rejected
  const [rejectingVendor, setRejectingVendor] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3200); };

  const fetchVendors = useCallback(async () => {
    setLoadingV(true);
    const { data } = await sb.query("vendors", "?select=*&order=created_at.desc", token);
    setVendors(data || []);
    setLoadingV(false);
  }, [token]);

  const fetchBookings = useCallback(async () => {
    setLoadingB(true);
    const { data } = await sb.query("bookings", "?select=*,vendors(name,category,location)&order=created_at.desc", token);
    setBookings(data || []);
    setLoadingB(false);
  }, [token]);

  const fetchTickets = useCallback(async () => {
    setLoadingT(true);
    const { data } = await sb.query("support_tickets", "?select=*&order=created_at.desc", token);
    setTickets(data || []);
    setLoadingT(false);
  }, [token]);

  const fetchCategories = useCallback(async () => {
    setLoadingC(true);
    const { data } = await sb.query("categories", "?select=*&order=sort_order.asc,name.asc", token);
    setCategories(data || []);
    setLoadingC(false);
  }, [token]);

  const refreshAll = async () => {
    setRefreshing(true);
    await Promise.all([fetchVendors(), fetchBookings(), fetchTickets(), fetchCategories()]);
    setRefreshing(false);
    showToast("Data refreshed from database", "info");
  };

  useEffect(() => { fetchVendors(); fetchBookings(); fetchTickets(); fetchCategories(); }, [fetchVendors, fetchBookings, fetchTickets, fetchCategories]);

  const deleteCategory = async (id) => {
    const { error } = await sb.query("categories", `?id=eq.${id}`, token, "DELETE");
    if (error) { showToast("Delete failed: " + (error.message || "unknown error"), "error"); return; }
    setCategories(c => c.filter(x => x.id !== id));
    setConfirmDelCat(null);
    showToast("Category deleted successfully.");
  };

  const deleteVendor = async (id) => {
    const { error } = await sb.query("vendors", `?id=eq.${id}`, token, "DELETE");
    if (error) { showToast("Delete failed: " + (error.message || "unknown error"), "error"); return; }
    setVendors(v => v.filter(x => x.id !== id));
    setConfirmDel(null);
    showToast("Vendor deleted successfully.");
  };

  const updateBookingStatus = async (id, status) => {
    const { error } = await sb.query("bookings", `?id=eq.${id}`, token, "PATCH", { status });
    if (error) {
      const isDoubleBooked = error.message?.includes("duplicate") || error.message?.includes("bookings_vendor_date_locked");
      showToast(isDoubleBooked ? "This vendor already has a confirmed booking for that date — can't confirm two bookings for the same day." : "Update failed", "error");
      return;
    }
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status } : b));
    showToast(`Booking updated to "${STATUS_STYLE[status]?.label || status}"`);
  };

  const updateTicketStatus = async (id, status) => {
    const { error } = await sb.query("support_tickets", `?id=eq.${id}`, token, "PATCH", { status });
    if (error) { showToast("Update failed", "error"); return; }
    setTickets(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    showToast(`Ticket marked as ${status}`);
  };

  // Stats
  const revenue = bookings.filter(b => ["paid", "released", "completed"].includes(b.status)).reduce((s, b) => s + (b.amount || 0), 0);
  const openTickets = tickets.filter(t => t.status === "open").length;
  const pendingBookings = bookings.filter(b => b.status === "pending").length;
  const pendingPayouts = bookings.filter(b => b.status === "release_requested").length;
  const statsIcons = {
    vendors: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    bookings: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    pending: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    payouts: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
    tickets: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    revenue: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  };
  const stats = [
    { label: "Total Vendors", value: vendors.length, color: B.primary, icon: statsIcons.vendors },
    { label: "Total Bookings", value: bookings.length, color: "#0369A1", icon: statsIcons.bookings },
    { label: "Pending Approval", value: pendingBookings, color: B.warning, icon: statsIcons.pending },
    { label: "Payout Requests", value: pendingPayouts, color: "#C05621", icon: statsIcons.payouts },
    { label: "Open Tickets", value: openTickets, color: B.danger, icon: statsIcons.tickets },
    { label: "Revenue (LKR)", value: revenue.toLocaleString(), color: B.success, icon: statsIcons.revenue },
  ];

  const filteredVendors = vendors
    .filter(v => v.name?.toLowerCase().includes(searchV.toLowerCase()) || v.location?.toLowerCase().includes(searchV.toLowerCase()) || v.category?.includes(searchV.toLowerCase()))
    .filter(v => vendorStatusFilter === "all" || (v.status || "approved") === vendorStatusFilter);
  const pendingVendorCount = vendors.filter(v => v.status === "pending").length;

  const approveVendor = async (v) => {
    const { error } = await sb.query("vendors", `?id=eq.${v.id}`, token, "PATCH", { status: "approved", rejection_reason: null });
    if (error) { showToast("Approval failed: " + (error.message || "unknown error"), "error"); return; }
    setVendors(prev => prev.map(x => x.id === v.id ? { ...x, status: "approved", rejection_reason: null } : x));
    showToast(`"${v.name}" is now live on Evara! 🎉`);
  };

  const rejectVendor = async (v, reason) => {
    const { error } = await sb.query("vendors", `?id=eq.${v.id}`, token, "PATCH", { status: "rejected", rejection_reason: reason || null });
    if (error) { showToast("Rejection failed: " + (error.message || "unknown error"), "error"); return; }
    setVendors(prev => prev.map(x => x.id === v.id ? { ...x, status: "rejected", rejection_reason: reason || null } : x));
    setRejectingVendor(null);
    showToast(`"${v.name}" was declined.`, "info");
  };
  const filteredBookings = filterStatus === "all" ? bookings : bookings.filter(b => b.status === filterStatus);

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "vendors", label: "Vendors", count: vendors.length },
    { id: "categories", label: "Categories", count: categories.length },
    { id: "bookings", label: "Bookings", count: pendingBookings, urgent: pendingBookings > 0 },
    { id: "payouts", label: "Payouts", count: pendingPayouts, urgent: pendingPayouts > 0 },
    { id: "tickets", label: "Support", count: openTickets, urgent: openTickets > 0 },
  ];

  return (
    <div style={{ minHeight: "100vh", background: B.bg, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{getGlobalStyle(themeMode)}</style>
      {/* Admin Top Bar */}
      <div style={{ background: B.dark, padding: "0 20px", position: "sticky", top: 0, zIndex: 200, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <EvaraLogo size="sm" dark onClick={onGoHome}/>
            <div style={{ background: "rgba(212,175,106,0.12)", border: "1px solid rgba(212,175,106,0.25)", borderRadius: 6, padding: "2px 10px", fontSize: 10.5, fontWeight: 700, color: B.accent, letterSpacing: 1.2 }}>ADMIN PANEL</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={refreshAll} disabled={refreshing} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <span style={{ display: "flex", animation: refreshing ? "spin 1s linear infinite" : "none" }}><Icon.RefreshCw/></span> Refresh
            </button>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{user.email}</span>
            <button onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <Icon.LogOut/> Sign Out
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, overflowX: "auto", scrollbarWidth: "none" }}>
          {tabs.map(({ id, label, count, urgent }) => (
            <button key={id} onClick={() => setAdminTab(id)} style={{ padding: "10px 14px", background: "none", border: "none", borderBottom: adminTab === id ? `2px solid ${B.accent}` : "2px solid transparent", color: adminTab === id ? "#fff" : "rgba(255,255,255,0.4)", fontWeight: adminTab === id ? 700 : 500, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, flexShrink: 0, whiteSpace: "nowrap" }}>
              {label}
              {count !== undefined && <span style={{ background: adminTab === id ? B.accent : urgent ? "rgba(217,64,64,0.7)" : "rgba(255,255,255,0.1)", color: adminTab === id ? B.dark : "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{count}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Row - always visible */}
      <div className="admin-max" style={{ padding: "16px 0 0", overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 12, minWidth: "max-content" }}>
          {stats.map(({ label, value, color, icon }) => (
            <div key={label} style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: "14px 18px", flexShrink: 0, minWidth: 140 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: B.bg, display: "flex", alignItems: "center", justifyContent: "center", color, marginBottom: 8 }}>{icon}</div>
              <div style={{ fontSize: 11, color: B.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'Playfair Display',serif" }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Overview Tab */}
      {adminTab === "overview" && (
        <div className="admin-max" style={{ padding: "16px 0" }}>
          <div className="admin-grid" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {pendingVendorCount > 0 && (
              <button onClick={() => { setAdminTab("vendors"); setVendorStatusFilter("pending"); }} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left", background: "#FFF4E5", borderRadius: 14, border: `1.5px solid ${B.warning}55`, padding: 16, cursor: "pointer" }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, background: "#fff", color: B.warning, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: B.text }}>{pendingVendorCount} vendor application{pendingVendorCount !== 1 ? "s" : ""} awaiting review</span>
                  <span style={{ display: "block", fontSize: 12, color: B.textMuted, marginTop: 1 }}>New self-submitted listings need your approval before they go live</span>
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={B.textMuted} strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            )}
            {/* Recent bookings */}
            <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>Recent Bookings</div>
                <button onClick={() => setAdminTab("bookings")} style={{ fontSize: 12, color: B.accent, fontWeight: 700, background: "none", border: "none", cursor: "pointer" }}>View all →</button>
              </div>
              {loadingB ? [1, 2, 3].map(i => <div key={i} style={{ height: 60, marginBottom: 8 }}><Skeleton h={60} r={10}/></div>) :
                bookings.slice(0, 5).map(b => {
                  const ss = STATUS_STYLE[b.status] || STATUS_STYLE.pending;
                  return (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${B.border}` }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: B.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>{getCatIcon(b.vendors?.category, 16, B.primary)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: B.text }}>{b.vendors?.name || "Vendor"}</div>
                        <div style={{ fontSize: 11, color: B.textMuted }}>#{shortId(b.id)} · {formatDate(b.event_date)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: B.text }}>{fmt(b.amount)}</div>
                        <div style={{ background: ss.bg, color: ss.c, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, marginTop: 2 }}>{ss.label}</div>
                      </div>
                    </div>
                  );
                })
              }
            </div>

            {/* Vendor category breakdown */}
            <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: B.text, marginBottom: 16 }}>Vendors by Category</div>
              {Object.entries(CAT_LABELS).map(([catId, catLabel]) => {
                const count = vendors.filter(v => v.category === catId).length;
                if (count === 0) return null;
                const maxCount = Math.max(...Object.entries(CAT_LABELS).map(([id]) => vendors.filter(v => v.category === id).length));
                return (
                  <div key={catId} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: B.text, fontWeight: 600 }}>{CAT_EMOJI[catId]} {catLabel}</span>
                      <span style={{ fontSize: 12, color: B.textMuted, fontWeight: 700 }}>{count}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: B.bg, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(count / maxCount) * 100}%`, borderRadius: 3, background: B.accent, transition: "width .5s ease" }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Vendors Tab */}
      {adminTab === "vendors" && (
        <div className="admin-max" style={{ padding: "16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12 }}>
            <input value={searchV} onChange={e => setSearchV(e.target.value)} placeholder="Search vendors..." style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${B.border}`, background: B.surface, fontSize: 14, color: B.text, outline: "none" }}/>
            <button onClick={() => { setEditVendor(null); setShowAddForm(true); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 10, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>+ Add Vendor</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {[["all", "All"], ["pending", `Pending${pendingVendorCount ? ` (${pendingVendorCount})` : ""}`], ["approved", "Approved"], ["rejected", "Rejected"]].map(([s, label]) => (
              <button key={s} onClick={() => setVendorStatusFilter(s)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", background: vendorStatusFilter === s ? B.primary : B.surface, color: vendorStatusFilter === s ? "#fff" : (s === "pending" && pendingVendorCount > 0 ? B.warning : B.textMuted), border: `1.5px solid ${vendorStatusFilter === s ? B.primary : (s === "pending" && pendingVendorCount > 0 ? `${B.warning}66` : B.border)}` }}>
                {label}
              </button>
            ))}
          </div>
          {loadingV ? [1, 2, 3].map(i => <div key={i} style={{ background: B.surface, borderRadius: 14, height: 80, border: `1px solid ${B.border}`, marginBottom: 10 }}><Skeleton h="100%" r={14}/></div>) :
            filteredVendors.length === 0 ? <div style={{ textAlign: "center", padding: "60px 0", color: B.textMuted }}><div style={{ width:52,height:52,borderRadius:12,background:B.surface,border:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",color:B.textMuted }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div><div style={{ fontWeight: 700 }}>No vendors found</div></div> :
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredVendors.map(v => {
                const vStatus = v.status || "approved";
                return (
                <div key={v.id} style={{ background: B.surface, borderRadius: 14, border: `1.5px solid ${vStatus === "pending" ? `${B.warning}66` : B.border}`, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: B.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1px solid ${B.border}`, color: B.primary }}>{getCatIcon(v.category, 22, B.primary)}</div>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: B.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</div>
                      {vStatus === "pending" && <span style={{ background: "#FFF4E5", color: B.warning, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, flexShrink: 0 }}>⏳ Pending Review</span>}
                      {vStatus === "rejected" && <span style={{ background: "#FEF2F2", color: B.danger, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, flexShrink: 0 }}>✕ Rejected</span>}
                      {v.user_id ? (
                        <span style={{ background: "#EDFAF4", color: B.success, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, flexShrink: 0 }}>👤 Claimed</span>
                      ) : (
                        <span style={{ background: B.bg, color: B.textLight, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, flexShrink: 0, border: `1px solid ${B.border}` }}>Unclaimed</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: B.textMuted, marginTop: 2 }}>{CAT_LABELS[v.category] || v.category} · {v.location || "—"} · {fmt(v.base_price || 0)}</div>
                    <div style={{ fontSize: 11, color: B.textLight, marginTop: 2 }}>{vStatus === "pending" ? "Applied" : "Added"} {formatDate(v.created_at)}</div>
                    {vStatus === "rejected" && v.rejection_reason && <div style={{ fontSize: 11, color: B.danger, marginTop: 4, fontStyle: "italic" }}>"{v.rejection_reason}"</div>}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                    {vStatus === "pending" && (
                      <>
                        <button onClick={() => approveVendor(v)} style={{ padding: "6px 14px", borderRadius: 8, background: "#EDFAF4", border: "1px solid #1A9B6C33", color: B.success, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>✓ Approve</button>
                        <button onClick={() => setRejectingVendor(v)} style={{ padding: "6px 14px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #D9404033", color: B.danger, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>✕ Reject</button>
                      </>
                    )}
                    <button onClick={() => setAssignOwnerVendor(v)} style={{ padding: "6px 14px", borderRadius: 8, background: "#E8F5FF", border: "1px solid rgba(3,105,161,0.2)", color: "#0369A1", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>{v.user_id ? "Reassign" : "Assign Owner"}</button>
                    <button onClick={() => { setEditVendor(v); setShowAddForm(true); }} style={{ padding: "6px 14px", borderRadius: 8, background: B.accentSoft, border: `1px solid ${B.border}`, color: B.text, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Edit</button>
                    <button onClick={() => setConfirmDel(v)} style={{ padding: "6px 14px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #D9404033", color: B.danger, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Delete</button>
                  </div>
                </div>
                );
              })}
            </div>
          }
        </div>
      )}

      {rejectingVendor && <RejectVendorModal vendor={rejectingVendor} onClose={() => setRejectingVendor(null)} onConfirm={(reason) => rejectVendor(rejectingVendor, reason)}/>}

      {/* Bookings Tab */}
      {adminTab === "bookings" && (
        <div className="admin-max" style={{ padding: "16px 0" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {["all", "pending", "confirmed", "paid", "release_requested", "completed", "cancelled"].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", background: filterStatus === s ? B.primary : B.surface, color: filterStatus === s ? "#fff" : B.textMuted, border: `1.5px solid ${filterStatus === s ? B.primary : B.border}` }}>
                {s === "all" ? "All" : STATUS_STYLE[s]?.label || s} {s === "pending" && pendingBookings > 0 ? `(${pendingBookings})` : ""}
              </button>
            ))}
          </div>
          {loadingB ? [1, 2, 3, 4].map(i => <div key={i} style={{ background: B.surface, borderRadius: 14, height: 110, border: `1px solid ${B.border}`, marginBottom: 10 }}><Skeleton h="100%" r={14}/></div>) :
            filteredBookings.length === 0 ? <div style={{ textAlign: "center", padding: "60px 0", color: B.textMuted }}><div style={{ width:52,height:52,borderRadius:12,background:B.surface,border:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",color:B.textMuted }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div style={{ fontWeight: 700 }}>No bookings for this filter</div></div> :
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredBookings.map(b => {
                const ss = STATUS_STYLE[b.status] || STATUS_STYLE.pending;
                return (
                  <div key={b.id} style={{ background: B.surface, borderRadius: 14, border: `1.5px solid ${b.status === "pending" ? `${B.warning}66` : B.border}`, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: B.text }}>{b.vendors?.name || "Vendor"}</div>
                        <div style={{ fontSize: 12, color: B.textMuted, marginTop: 2 }}>#{shortId(b.id)} · {formatDate(b.event_date)} · {b.guests || "—"} guests · {b.package || "Standard"}</div>
                        {b.event_type && <div style={{ fontSize: 11, color: B.textLight, marginTop: 1 }}>{b.event_type}</div>}
                      </div>
                      <div style={{ background: ss.bg, color: ss.c, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, border: `1px solid ${ss.c}33`, whiteSpace: "nowrap" }}>{ss.label}</div>
                    </div>
                    {b.payment_method && <div style={{ fontSize: 11, color: "#0369A1", fontWeight: 600, marginBottom: 8 }}>💳 Paid via PayHere</div>}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${B.border}`, paddingTop: 10 }}>
                      <span style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 15, color: B.primary }}>{fmt(b.amount)}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {b.status === "pending" && <button onClick={() => updateBookingStatus(b.id, "confirmed")} style={{ padding: "5px 12px", borderRadius: 8, background: "#EDFAF4", border: "1px solid #1A9B6C33", color: B.success, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>✓ Confirm</button>}
                        {b.status === "confirmed" && !b.payment_method && <button onClick={() => updateBookingStatus(b.id, "paid")} style={{ padding: "5px 12px", borderRadius: 8, background: "#E8F5FF", border: "1px solid #0369A133", color: "#0369A1", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>💳 Mark Paid</button>}
                        {b.status === "release_requested" && <button onClick={() => updateBookingStatus(b.id, "released")} style={{ padding: "5px 12px", borderRadius: 8, background: "#EDFAF4", border: "1px solid #1A9B6C33", color: B.success, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>🔓 Release</button>}
                        {b.status === "released" && <button onClick={() => updateBookingStatus(b.id, "completed")} style={{ padding: "5px 12px", borderRadius: 8, background: "#F0F4FF", border: "1px solid #3B4FCC33", color: "#3B4FCC", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Mark Complete</button>}
                        {!["completed", "cancelled"].includes(b.status) && <button onClick={() => updateBookingStatus(b.id, "cancelled")} style={{ padding: "5px 12px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #D9404033", color: B.danger, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>✕</button>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          }
        </div>
      )}

      {/* Payouts Tab */}
      {adminTab === "payouts" && (
        <div className="admin-max" style={{ padding: "16px 0" }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: B.text, marginBottom: 4 }}>Payout Requests</div>
          <div style={{ fontSize: 13, color: B.textMuted, marginBottom: 16 }}>Customers requesting payment release to vendors</div>
          {loadingB ? [1, 2].map(i => <div key={i} style={{ background: B.surface, borderRadius: 14, height: 120, border: `1px solid ${B.border}`, marginBottom: 10 }}><Skeleton h="100%" r={14}/></div>) :
            bookings.filter(b => b.status === "release_requested").length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: B.textMuted }}>
                <div style={{ fontSize: 48, marginBottom: 10 }}>💸</div>
                <div style={{ fontWeight: 700 }}>No payout requests</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>All caught up!</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {bookings.filter(b => b.status === "release_requested").map(b => (
                  <div key={b.id} style={{ background: B.surface, borderRadius: 14, border: "1.5px solid rgba(192,86,33,0.3)", padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: B.text }}>{b.vendors?.name || "Vendor"}</div>
                        <div style={{ fontSize: 12, color: B.textMuted, marginTop: 2 }}>#{shortId(b.id)} · Event: {formatDate(b.event_date)}</div>
                        {b.payment_method && <div style={{ fontSize: 11, color: "#0369A1", fontWeight: 600, marginTop: 2 }}>💳 Paid via PayHere</div>}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 18, color: B.primary }}>{fmt(b.amount)}</div>
                        <div style={{ fontSize: 11, color: "#C05621", fontWeight: 600 }}>Release Requested</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: B.textMuted, marginBottom: 12, background: "#FFF4E5", borderRadius: 8, padding: "8px 12px", border: "1px solid rgba(192,86,33,0.2)" }}>
                      ⚠️ Customer has confirmed their event is complete and is requesting payment release to vendor.
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => updateBookingStatus(b.id, "released")} style={{ flex: 2, padding: "10px", borderRadius: 10, background: "#EDFAF4", border: "1px solid rgba(26,155,108,0.3)", color: B.success, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                        🔓 Release Payment to Vendor
                      </button>
                      <button onClick={() => updateBookingStatus(b.id, "paid")} style={{ flex: 1, padding: "10px", borderRadius: 10, background: "#FEF2F2", border: "1px solid #D9404033", color: B.danger, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                        Hold
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </div>
      )}

      {/* Support Tickets Tab */}
      {adminTab === "tickets" && (
        <div className="admin-max" style={{ padding: "16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>Support Tickets</div>
              <div style={{ fontSize: 12, color: B.textMuted, marginTop: 2 }}>{openTickets} open · {tickets.length} total</div>
            </div>
            <button onClick={fetchTickets} style={{ padding: "7px 14px", borderRadius: 8, background: B.surface, border: `1px solid ${B.border}`, fontWeight: 600, fontSize: 12, color: B.textMuted, cursor: "pointer" }}>Refresh</button>
          </div>
          {loadingT ? [1, 2, 3].map(i => <div key={i} style={{ background: B.surface, borderRadius: 14, height: 120, border: `1px solid ${B.border}`, marginBottom: 10 }}><Skeleton h="100%" r={14}/></div>) :
            tickets.length === 0 ? <div style={{ textAlign: "center", padding: "60px 0", color: B.textMuted }}><div style={{ width:52,height:52,borderRadius:12,background:B.surface,border:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",color:B.textMuted }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><div style={{ fontWeight: 700 }}>No support tickets yet</div><div style={{ fontSize: 13, marginTop: 4 }}>Tickets submitted by users will appear here</div></div> :
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {tickets.map(t => {
                const isOpen = t.status === "open";
                const isResolved = t.status === "resolved";
                return (
                  <div key={t.id} style={{ background: B.surface, borderRadius: 14, border: `1.5px solid ${t.is_urgent && isOpen ? "#D94040" : B.border}`, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          {t.is_urgent && isOpen && <span style={{ background: "#FEF2F2", color: B.danger, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6 }}>URGENT</span>}
                          <span style={{ fontSize: 13, fontWeight: 700, color: B.text }}>{t.issue_label || "General Issue"}</span>
                        </div>
                        <div style={{ fontSize: 12, color: B.textMuted }}>{t.user_email || "Anonymous"}{t.user_phone ? ` · ${t.user_phone}` : ""} · {t.vendor_name ? `${t.vendor_name} · ` : ""}{formatDate(t.created_at)}</div>
                        {t.booking_id && <div style={{ fontSize: 11, color: B.textMuted, marginTop: 2 }}>Booking #{t.booking_id.replace(/-/g, "").slice(0, 10).toUpperCase()}</div>}
                      </div>
                      <div style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, flexShrink: 0, background: isResolved ? "#EDFAF4" : isOpen ? (t.is_urgent ? "#FEF2F2" : "#FFFBEB") : "#F0F4FF", color: isResolved ? B.success : isOpen ? (t.is_urgent ? B.danger : B.warning) : "#3B4FCC" }}>
                        {isResolved ? "✓ Resolved" : isOpen ? "Open" : t.status}
                      </div>
                    </div>
                    {t.message && <div style={{ background: B.bg, borderRadius: 8, padding: "10px 12px", fontSize: 13, color: B.text, lineHeight: 1.5, marginBottom: 10, borderLeft: `3px solid ${t.is_urgent ? B.danger : B.accent}` }}>{t.message}</div>}
                    <div style={{ display: "flex", gap: 8 }}>
                      {t.user_email && <a href={`mailto:${t.user_email}?subject=Re: Your Evara Support Ticket`} style={{ flex: 1, padding: 8, borderRadius: 8, background: B.accentSoft, border: `1px solid ${B.border}`, color: B.text, fontWeight: 600, fontSize: 12, cursor: "pointer", textAlign: "center", textDecoration: "none" }}>Reply via Email</a>}
                      {t.user_phone && <a href={`tel:${t.user_phone.replace(/[^0-9+]/g, "")}`} style={{ flex: 1, padding: 8, borderRadius: 8, background: B.accentSoft, border: `1px solid ${B.border}`, color: B.text, fontWeight: 600, fontSize: 12, cursor: "pointer", textAlign: "center", textDecoration: "none" }}>Call {t.user_phone}</a>}
                      {!isResolved && <button onClick={() => updateTicketStatus(t.id, "resolved")} style={{ flex: 1, padding: 8, borderRadius: 8, background: "#EDFAF4", border: "1px solid rgba(26,155,108,0.2)", color: B.success, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Mark Resolved</button>}
                      {isResolved && <button onClick={() => updateTicketStatus(t.id, "open")} style={{ flex: 1, padding: 8, borderRadius: 8, background: B.bg, border: `1px solid ${B.border}`, color: B.textMuted, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Reopen</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          }
        </div>
      )}

      {/* Categories Tab */}
      {adminTab === "categories" && (
        <div className="admin-max" style={{ padding: "16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>Event Categories</div>
              <div style={{ fontSize: 12, color: B.textMuted, marginTop: 2 }}>{categories.length} categories · used to classify vendor listings</div>
            </div>
            <button onClick={() => { setEditCategory(null); setShowCatForm(true); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 10, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>+ Add Category</button>
          </div>

          {/* Vendor counts per category from live DB */}
          {loadingC ? (
            [1,2,3,4,5].map(i => <div key={i} style={{ background: B.surface, borderRadius: 14, height: 76, border: `1px solid ${B.border}`, marginBottom: 10 }}><Skeleton h="100%" r={14}/></div>)
          ) : categories.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: B.textMuted }}>
              <div style={{ width:60,height:60,borderRadius:14,background:B.surface,border:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",color:B.textMuted }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></div>
              <div style={{ fontWeight: 700, fontSize: 16, color: B.text, marginBottom: 6 }}>No categories yet</div>
              <div style={{ fontSize: 13, marginBottom: 20 }}>Add your first category to start organising vendors</div>
              <button onClick={() => { setEditCategory(null); setShowCatForm(true); }} style={{ padding: "10px 24px", borderRadius: 10, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer" }}>+ Add Category</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {categories.map(cat => {
                const vendorCount = vendors.filter(v => v.category === (cat.slug || cat.id)).length;
                return (
                  <div key={cat.id} style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: B.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0, border: `1px solid ${B.border}` }}>
                      {cat.emoji || CAT_EMOJI[cat.slug] || CAT_EMOJI[cat.name?.toLowerCase()] || "🏷️"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: B.text }}>{cat.name}</div>
                      <div style={{ fontSize: 12, color: B.textMuted, marginTop: 2 }}>
                        {cat.slug && <span style={{ background: B.bg, border: `1px solid ${B.border}`, borderRadius: 6, padding: "1px 7px", fontSize: 11, fontWeight: 600, color: B.textMuted, marginRight: 8 }}>{cat.slug}</span>}
                        {vendorCount > 0 ? <span style={{ color: B.success, fontWeight: 600 }}>{vendorCount} vendor{vendorCount !== 1 ? "s" : ""} listed</span> : <span style={{ color: B.textLight }}>No vendors yet</span>}
                      </div>
                      {cat.description && <div style={{ fontSize: 11, color: B.textLight, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.description}</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      {cat.is_active === false && <span style={{ background: "#FEF2F2", color: B.danger, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6 }}>INACTIVE</span>}
                      {cat.sort_order != null && <span style={{ fontSize: 11, color: B.textLight, fontWeight: 600 }}>#{cat.sort_order}</span>}
                      <button onClick={() => { setEditCategory(cat); setShowCatForm(true); }} style={{ padding: "6px 14px", borderRadius: 8, background: B.accentSoft, border: `1px solid ${B.border}`, color: B.text, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Edit</button>
                      <button onClick={() => setConfirmDelCat(cat)} style={{ padding: "6px 14px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #D9404033", color: B.danger, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Category stats */}
          {!loadingC && categories.length > 0 && (
            <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 20, marginTop: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: B.text, marginBottom: 14 }}>Vendor Distribution by Category</div>
              {categories.map(cat => {
                const count = vendors.filter(v => v.category === (cat.slug || cat.id)).length;
                const maxCount = Math.max(1, ...categories.map(c => vendors.filter(v => v.category === (c.slug || c.id)).length));
                if (count === 0) return null;
                return (
                  <div key={cat.id} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: B.text, fontWeight: 600 }}>{cat.emoji || CAT_EMOJI[cat.slug] || "🏷️"} {cat.name}</span>
                      <span style={{ fontSize: 12, color: B.textMuted, fontWeight: 700 }}>{count}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: B.bg, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(count / maxCount) * 100}%`, borderRadius: 3, background: B.accent, transition: "width .5s ease" }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showCatForm && <CategoryFormModal category={editCategory} token={token} onClose={() => { setShowCatForm(false); setEditCategory(null); }} onSaved={(msg) => { showToast(msg); fetchCategories(); setShowCatForm(false); setEditCategory(null); }}/>}
      {confirmDelCat && (
        <>
          <div onClick={() => setConfirmDelCat(null)} style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(12,22,40,0.65)", backdropFilter: "blur(4px)" }}/>
          <div style={{ position: "fixed", inset: 0, zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div style={{ background: B.surface, borderRadius: 20, padding: 28, maxWidth: 360, width: "100%", textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🗑️</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: B.text, marginBottom: 8 }}>Delete Category?</div>
              <div style={{ fontSize: 14, color: B.textMuted, marginBottom: 8 }}>"{confirmDelCat.name}" will be permanently removed.</div>
              {vendors.filter(v => v.category === (confirmDelCat.slug || confirmDelCat.id)).length > 0 && (
                <div style={{ background: "#FEF2F2", border: "1px solid #D9404033", borderRadius: 10, padding: "8px 14px", fontSize: 12, color: B.danger, fontWeight: 600, marginBottom: 16 }}>
                  ⚠️ {vendors.filter(v => v.category === (confirmDelCat.slug || confirmDelCat.id)).length} vendor(s) use this category
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button onClick={() => setConfirmDelCat(null)} style={{ flex: 1, padding: 12, borderRadius: 10, background: B.bg, border: `1px solid ${B.border}`, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Cancel</button>
                <button onClick={() => deleteCategory(confirmDelCat.id)} style={{ flex: 1, padding: 12, borderRadius: 10, background: B.danger, color: "#fff", border: "none", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Delete</button>
              </div>
            </div>
          </div>
        </>
      )}

      {showAddForm && <VendorFormModal vendor={editVendor} token={token} onClose={() => { setShowAddForm(false); setEditVendor(null); }} onSaved={(msg) => { showToast(msg); fetchVendors(); setShowAddForm(false); setEditVendor(null); }}/>}
      {assignOwnerVendor && <AssignOwnerModal vendor={assignOwnerVendor} token={token} onClose={() => setAssignOwnerVendor(null)} onSaved={(msg) => { showToast(msg); fetchVendors(); setAssignOwnerVendor(null); }}/>}
      {confirmDel && (
        <>
          <div onClick={() => setConfirmDel(null)} style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(12,22,40,0.65)", backdropFilter: "blur(4px)" }}/>
          <div style={{ position: "fixed", inset: 0, zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div style={{ background: B.surface, borderRadius: 20, padding: 28, maxWidth: 360, width: "100%", textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🗑️</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: B.text, marginBottom: 8 }}>Delete Vendor?</div>
              <div style={{ fontSize: 14, color: B.textMuted, marginBottom: 24 }}>"{confirmDel.name}" will be permanently removed.</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setConfirmDel(null)} style={{ flex: 1, padding: 12, borderRadius: 10, background: B.bg, border: `1px solid ${B.border}`, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Cancel</button>
                <button onClick={() => deleteVendor(confirmDel.id)} style={{ flex: 1, padding: 12, borderRadius: 10, background: B.danger, color: "#fff", border: "none", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Delete</button>
              </div>
            </div>
          </div>
        </>
      )}
      <Toast toast={toast}/>
    </div>
  );
}

// ─── Assign Owner Modal ────────────────────────────────────────────────────────
function RejectVendorModal({ vendor, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(12,22,40,0.65)", backdropFilter: "blur(4px)" }}/>
      <div style={{ position: "fixed", inset: 0, zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ width: "100%", maxWidth: 420, background: B.bg, borderRadius: 18, overflow: "hidden", animation: "slideUp .25s ease" }}>
          <div style={{ padding: "16px 20px", background: B.surface, borderBottom: `1px solid ${B.border}` }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: B.text }}>Decline "{vendor.name}"?</div>
            <div style={{ fontSize: 12, color: B.textMuted, marginTop: 2 }}>They'll see this reason and can edit + resubmit.</div>
          </div>
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder={'Optional — e.g. "Please add more details about your packages"'} style={{ width: "100%", minHeight: 90, padding: 12, borderRadius: 10, border: `1.5px solid ${B.border}`, background: B.surface, color: B.text, fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box" }}/>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 10, background: B.surface, border: `1.5px solid ${B.border}`, color: B.text, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => onConfirm(reason.trim())} style={{ flex: 1, padding: 12, borderRadius: 10, background: B.danger, border: "none", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Decline Application</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function AssignOwnerModal({ vendor, token, onClose, onSaved }) {
  const [email, setEmail] = useState("");
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSearch = async () => {
    if (!email.trim()) { setError("Enter an email address."); return; }
    setSearching(true); setError(""); setFound(null);
    const { data, error: err } = await sb.query("profiles", `?email=eq.${encodeURIComponent(email.trim())}&select=id,full_name,email,role`, token);
    setSearching(false);
    if (err) { setError(err.message || "Search failed."); return; }
    if (!data || data.length === 0) { setError("No account found with that email. They need to sign up first."); return; }
    setFound(data[0]);
  };

  const handleAssign = async () => {
    if (!found) return;
    setSaving(true); setError("");
    const { error: vErr } = await sb.query("vendors", `?id=eq.${vendor.id}`, token, "PATCH", { user_id: found.id });
    if (vErr) { setSaving(false); setError(vErr.message || "Failed to assign owner."); return; }
    if (found.role !== "vendor") {
      await sb.query("profiles", `?id=eq.${found.id}`, token, "PATCH", { role: "vendor" });
    }
    setSaving(false);
    onSaved(`"${vendor.name}" is now linked to ${found.full_name || found.email}.`);
  };

  const handleUnassign = async () => {
    setSaving(true); setError("");
    const { error: vErr } = await sb.query("vendors", `?id=eq.${vendor.id}`, token, "PATCH", { user_id: null });
    setSaving(false);
    if (vErr) { setError(vErr.message || "Failed to remove owner."); return; }
    onSaved(`Ownership removed from "${vendor.name}".`);
  };

  const inputStyle = { width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${B.border}`, background: B.bg, fontSize: 14, color: B.text, outline: "none", boxSizing: "border-box" };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(12,22,40,0.65)", backdropFilter: "blur(4px)" }}/>
      <div style={{ position: "fixed", inset: 0, zIndex: 700, display: "flex", alignItems: "flex-end", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "100%", maxWidth: 460, maxHeight: "90vh", background: B.bg, borderRadius: "22px 22px 0 0", overflow: "hidden", display: "flex", flexDirection: "column", pointerEvents: "all", animation: "slideUp .35s cubic-bezier(.22,1,.36,1) both" }}>
          <div style={{ padding: "16px 20px", background: B.surface, borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>Assign Vendor Owner</div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 8, border: `1.5px solid ${B.border}`, background: B.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: B.textMuted }}><Icon.X/></button>
          </div>
          <div style={{ overflowY: "auto", flex: 1, padding: "20px 16px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: B.surface, borderRadius: 12, padding: "12px 16px", border: `1px solid ${B.border}`, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: B.bg, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${B.border}`, color: B.primary }}>{getCatIcon(vendor.category, 22, B.primary)}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: B.text }}>{vendor.name}</div>
                <div style={{ fontSize: 11, color: B.textMuted, marginTop: 2 }}>{vendor.user_id ? `Currently linked to a registered account` : "Currently unclaimed"}</div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: B.textMuted, lineHeight: 1.6 }}>
              Search for the vendor's email — they must already have a customer or vendor account on Evara. Linking will let them sign in and manage this listing themselves.
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()} placeholder="vendor@example.com" style={inputStyle}/>
              <button onClick={handleSearch} disabled={searching} style={{ padding: "0 18px", borderRadius: 10, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 13, border: "none", cursor: searching ? "not-allowed" : "pointer", opacity: searching ? 0.7 : 1, whiteSpace: "nowrap" }}>
                {searching ? "…" : "Search"}
              </button>
            </div>

            {found && (
              <div style={{ background: "#EDFAF4", border: "1px solid rgba(26,155,108,0.25)", borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: B.success, marginBottom: 2 }}>✓ Account found</div>
                <div style={{ fontSize: 13, color: B.text }}>{found.full_name || "—"}</div>
                <div style={{ fontSize: 12, color: B.textMuted }}>{found.email}</div>
              </div>
            )}

            {error && <div style={{ background: "#FEF2F2", border: "1px solid #D9404033", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: B.danger, fontWeight: 600 }}>{error}</div>}

            <button onClick={handleAssign} disabled={!found || saving} style={{ width: "100%", padding: 14, borderRadius: 12, background: !found ? B.border : B.primary, color: "#fff", fontWeight: 700, fontSize: 15, border: "none", cursor: !found || saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving…" : "Assign as Owner"}
            </button>

            {vendor.user_id && (
              <button onClick={handleUnassign} disabled={saving} style={{ width: "100%", padding: 12, borderRadius: 12, background: "#FEF2F2", color: B.danger, fontWeight: 700, fontSize: 13, border: "1px solid #D9404033", cursor: saving ? "not-allowed" : "pointer" }}>
                Remove Current Owner
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Vendor Form Modal ────────────────────────────────────────────────────────
function VendorFormModal({ vendor, token, onClose, onSaved }) {
  const isEdit = !!vendor;
  const [form, setForm] = useState({ name: vendor?.name || "", category: vendor?.category || "wedding", location: vendor?.location || "", base_price: vendor?.base_price || "", description: vendor?.description || "", response_time: vendor?.response_time || "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const handleSave = async () => {
    if (!form.name || !form.category || !form.location || !form.base_price) { setError("Please fill in all required fields."); return; }
    setLoading(true); setError("");
    const body = { name: form.name.trim(), category: form.category, location: form.location.trim(), base_price: parseFloat(form.base_price) || 0, description: form.description.trim() || null, response_time: form.response_time.trim() || null, ...(isEdit ? {} : { status: "approved" }) };
    const { error: err } = isEdit ? await sb.query("vendors", `?id=eq.${vendor.id}`, token, "PATCH", body) : await sb.query("vendors", "", token, "POST", body);
    setLoading(false);
    if (err) { setError(err.message || "Save failed."); return; }
    onSaved(isEdit ? "Vendor updated!" : "Vendor added!");
  };
  const inputStyle = { width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${B.border}`, background: B.bg, fontSize: 14, color: B.text, outline: "none" };
  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: B.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 };
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(12,22,40,0.65)", backdropFilter: "blur(4px)" }}/>
      <div style={{ position: "fixed", inset: 0, zIndex: 700, display: "flex", alignItems: "flex-end", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "100%", maxWidth: 480, maxHeight: "92vh", background: B.bg, borderRadius: "22px 22px 0 0", overflow: "hidden", display: "flex", flexDirection: "column", pointerEvents: "all", animation: "slideUp .35s cubic-bezier(.22,1,.36,1) both" }}>
          <div style={{ padding: "16px 20px", background: B.surface, borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>{isEdit ? "Edit Vendor" : "Add New Vendor"}</div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 8, border: `1.5px solid ${B.border}`, background: B.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: B.textMuted }}><Icon.X/></button>
          </div>
          <div style={{ overflowY: "auto", flex: 1, padding: "20px 16px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div><label style={labelStyle}>Vendor Name *</label><input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Grand Royal Banquet Hall" style={inputStyle}/></div>
            <div><label style={labelStyle}>Category *</label><select value={form.category} onChange={e => set("category", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>{VENDOR_CATEGORIES.map(({ id, label, emoji }) => <option key={id} value={id}>{emoji} {label}</option>)}</select></div>
            <div><label style={labelStyle}>Location *</label><input value={form.location} onChange={e => set("location", e.target.value)} placeholder="e.g. Colombo 03, Sri Lanka" style={inputStyle}/></div>
            <div><label style={labelStyle}>Base Price (LKR) *</label><input type="number" value={form.base_price} onChange={e => set("base_price", e.target.value)} placeholder="e.g. 50000" style={inputStyle} min="0"/>
              {form.base_price > 0 && (
                <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                  {[{ label: "Basic", mult: 1 }, { label: "Standard", mult: 1.5 }, { label: "Premium", mult: 2.5 }].map(({ label, mult }) => (
                    <div key={label} style={{ flex: 1, background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: "7px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: B.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: B.primary, marginTop: 2 }}>{fmt(Math.round(parseFloat(form.base_price) * mult) || 0)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div><label style={labelStyle}>Response Time</label><input value={form.response_time} onChange={e => set("response_time", e.target.value)} placeholder="e.g. < 1hr" style={inputStyle}/></div>
            <div><label style={labelStyle}>Description</label><textarea value={form.description} onChange={e => set("description", e.target.value)} placeholder="Brief description of the vendor's services..." style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}/></div>
            {error && <div style={{ background: "#FEF2F2", border: "1px solid #D9404033", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: B.danger, fontWeight: 600 }}>{error}</div>}
            <button onClick={handleSave} disabled={loading} style={{ width: "100%", padding: 14, borderRadius: 12, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 15, border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, marginTop: 4 }}>
              {loading ? (isEdit ? "Saving…" : "Adding…") : (isEdit ? "Save Changes" : "Add Vendor")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Category Form Modal ──────────────────────────────────────────────────────
function CategoryFormModal({ category, token, onClose, onSaved }) {
  const isEdit = !!category;
  const [form, setForm] = useState({
    name: category?.name || "",
    slug: category?.slug || "",
    emoji: category?.emoji || "",
    description: category?.description || "",
    sort_order: category?.sort_order ?? "",
    is_active: category?.is_active !== false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Auto-generate slug from name
  const handleNameChange = (val) => {
    set("name", val);
    if (!isEdit) {
      set("slug", val.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Category name is required."); return; }
    setLoading(true); setError("");
    const body = {
      name: form.name.trim(),
      slug: form.slug.trim() || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      emoji: form.emoji.trim() || null,
      description: form.description.trim() || null,
      sort_order: form.sort_order !== "" ? parseInt(form.sort_order) : null,
      is_active: form.is_active,
    };
    const { error: err } = isEdit
      ? await sb.query("categories", `?id=eq.${category.id}`, token, "PATCH", body)
      : await sb.query("categories", "", token, "POST", body);
    setLoading(false);
    if (err) { setError(err.message || "Save failed. Check your database has a 'categories' table."); return; }
    onSaved(isEdit ? "Category updated!" : "Category added!");
  };

  const inputStyle = { width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${B.border}`, background: B.bg, fontSize: 14, color: B.text, outline: "none", boxSizing: "border-box" };
  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: B.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(12,22,40,0.65)", backdropFilter: "blur(4px)" }}/>
      <div style={{ position: "fixed", inset: 0, zIndex: 700, display: "flex", alignItems: "flex-end", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "100%", maxWidth: 480, maxHeight: "92vh", background: B.bg, borderRadius: "22px 22px 0 0", overflow: "hidden", display: "flex", flexDirection: "column", pointerEvents: "all", animation: "slideUp .35s cubic-bezier(.22,1,.36,1) both" }}>
          <div style={{ padding: "16px 20px", background: B.surface, borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>{isEdit ? "Edit Category" : "Add New Category"}</div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 8, border: `1.5px solid ${B.border}`, background: B.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: B.textMuted }}><Icon.X/></button>
          </div>
          <div style={{ overflowY: "auto", flex: 1, padding: "20px 16px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Preview */}
            {(form.name || form.emoji) && (
              <div style={{ background: B.surface, borderRadius: 12, padding: "12px 16px", border: `1px solid ${B.border}`, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: B.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, border: `1px solid ${B.border}` }}>
                  {form.emoji || CAT_EMOJI[form.slug] || "🏷️"}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: B.text }}>{form.name || "Category Name"}</div>
                  {form.slug && <div style={{ fontSize: 11, color: B.textMuted, marginTop: 2 }}>slug: {form.slug}</div>}
                </div>
              </div>
            )}

            <div><label style={labelStyle}>Category Name *</label><input value={form.name} onChange={e => handleNameChange(e.target.value)} placeholder="e.g. Wedding Halls" style={inputStyle}/></div>
            <div><label style={labelStyle}>Slug (URL key)</label><input value={form.slug} onChange={e => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, ""))} placeholder="e.g. wedding" style={inputStyle}/><div style={{ fontSize: 11, color: B.textMuted, marginTop: 4 }}>Used to match vendors — must match the vendor category value</div></div>
            <div><label style={labelStyle}>Emoji</label><input value={form.emoji} onChange={e => set("emoji", e.target.value)} placeholder="e.g. 💒" style={{ ...inputStyle, fontSize: 22 }} maxLength={4}/></div>
            <div><label style={labelStyle}>Description</label><textarea value={form.description} onChange={e => set("description", e.target.value)} placeholder="Briefly describe what this category includes..." style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}/></div>
            <div><label style={labelStyle}>Sort Order</label><input type="number" value={form.sort_order} onChange={e => set("sort_order", e.target.value)} placeholder="e.g. 1 (lower = shown first)" style={inputStyle} min="0"/></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: B.surface, borderRadius: 10, padding: "12px 14px", border: `1px solid ${B.border}` }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: B.text }}>Active</div>
                <div style={{ fontSize: 11, color: B.textMuted }}>Inactive categories are hidden from the marketplace</div>
              </div>
              <button onClick={() => set("is_active", !form.is_active)} style={{ width: 44, height: 24, borderRadius: 12, border: "none", background: form.is_active ? B.success : B.border, cursor: "pointer", position: "relative", transition: "background .2s", flexShrink: 0 }}>
                <div style={{ position: "absolute", top: 3, left: form.is_active ? 22 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}/>
              </button>
            </div>
            {error && <div style={{ background: "#FEF2F2", border: "1px solid #D9404033", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: B.danger, fontWeight: 600 }}>{error}</div>}
            <button onClick={handleSave} disabled={loading} style={{ width: "100%", padding: 14, borderRadius: 12, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 15, border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, marginTop: 4 }}>
              {loading ? (isEdit ? "Saving…" : "Adding…") : (isEdit ? "Save Changes" : "Add Category")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Vendor Panel (Self-Service Dashboard) ────────────────────────────────────
function VendorPanel({ user, token, onSignOut, onGoHome }) {
  const [themeMode] = useTheme();
  const [vTab, setVTab] = useState("overview");
  const [myVendor, setMyVendor] = useState(null);
  const [myBookings, setMyBookings] = useState([]);
  const [loadingV, setLoadingV] = useState(true);
  const [loadingB, setLoadingB] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [myReviews, setMyReviews] = useState([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviewAvg, setReviewAvg] = useState(null);
  const [loadingReviews, setLoadingReviews] = useState(true);

  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3200); };

  const fetchMyVendor = useCallback(async () => {
    setLoadingV(true);
    const { data } = await sb.query("vendors", `?user_id=eq.${user.id}&select=*`, token);
    const v = data?.[0] || null;
    setMyVendor(v);
    if (v) setForm({ name: v.name || "", category: v.category || "wedding", location: v.location || "", base_price: v.base_price || "", description: v.description || "", response_time: v.response_time || "" });
    setLoadingV(false);
  }, [token, user.id]);

  const fetchMyBookings = useCallback(async (vendorId) => {
    if (!vendorId) { setMyBookings([]); setLoadingB(false); return; }
    setLoadingB(true);
    const { data } = await sb.query("bookings", `?vendor_id=eq.${vendorId}&select=*&order=created_at.desc`, token);
    setMyBookings(data || []);
    setLoadingB(false);
  }, [token]);

  const fetchMyReviews = useCallback(async (vendorId) => {
    if (!vendorId) { setMyReviews([]); setReviewCount(0); setReviewAvg(null); setLoadingReviews(false); return; }
    setLoadingReviews(true);
    const { reviews, count, avg } = await fetchVendorReviews(vendorId, token);
    setMyReviews(reviews); setReviewCount(count); setReviewAvg(avg);
    setLoadingReviews(false);
  }, [token]);

  useEffect(() => { fetchMyVendor(); }, [fetchMyVendor]);
  useEffect(() => { if (myVendor?.id) { fetchMyBookings(myVendor.id); fetchMyReviews(myVendor.id); } }, [myVendor?.id, fetchMyBookings, fetchMyReviews]);

  const saveListing = async () => {
    if (!form.name || !form.location || !form.base_price) { showToast("Please fill in name, location, and price.", "error"); return; }
    setSaving(true);
    const body = { name: form.name.trim(), category: form.category, location: form.location.trim(), base_price: parseFloat(form.base_price) || 0, description: form.description.trim() || null, response_time: form.response_time.trim() || null };
    const { error } = await sb.query("vendors", `?id=eq.${myVendor.id}`, token, "PATCH", body);
    setSaving(false);
    if (error) { showToast("Save failed: " + (error.message || "unknown error"), "error"); return; }
    showToast("Listing updated!");
    setEditing(false);
    fetchMyVendor();
  };

  const updateBookingStatus = async (id, status) => {
    const { error } = await sb.query("bookings", `?id=eq.${id}`, token, "PATCH", { status });
    if (error) {
      const isDoubleBooked = error.message?.includes("duplicate") || error.message?.includes("bookings_vendor_date_locked");
      showToast(isDoubleBooked ? "You already have a confirmed booking on that date — decline or reschedule one before confirming both." : "Update failed", "error");
      return;
    }
    setMyBookings(prev => prev.map(b => b.id === id ? { ...b, status } : b));
    showToast(`Booking updated to "${STATUS_STYLE[status]?.label || status}"`);
  };

  const revenue = myBookings.filter(b => ["paid", "released", "completed"].includes(b.status)).reduce((s, b) => s + (b.amount || 0), 0);
  const pendingCount = myBookings.filter(b => b.status === "pending").length;
  const confirmedCount = myBookings.filter(b => b.status === "confirmed").length;
  const vpStatsIcons = {
    bookings: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    pending: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    confirmed: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
    earnings: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  };
  const stats = [
    { label: "Total Bookings", value: myBookings.length, color: "#0369A1", icon: vpStatsIcons.bookings },
    { label: "Pending Requests", value: pendingCount, color: B.warning, icon: vpStatsIcons.pending },
    { label: "Confirmed", value: confirmedCount, color: B.success, icon: vpStatsIcons.confirmed },
    { label: "Earnings (LKR)", value: revenue.toLocaleString(), color: B.success, icon: vpStatsIcons.earnings },
  ];
  const filteredBookings = filterStatus === "all" ? myBookings : myBookings.filter(b => b.status === filterStatus);

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "listing", label: "My Listing" },
    { id: "bookings", label: "Bookings", count: myBookings.length, urgent: pendingCount > 0 },
    { id: "reviews", label: "Reviews", count: reviewCount },
  ];

  const inputStyle = { width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${B.border}`, background: B.bg, fontSize: 14, color: B.text, outline: "none", boxSizing: "border-box" };
  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: B.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 };

  if (loadingV) {
    return (
      <div style={{ minHeight: "100vh", background: B.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Skeleton h={40} w={200}/>
      </div>
    );
  }

  if (!myVendor) {
    return (
      <div style={{ minHeight: "100vh", background: B.bg, fontFamily: "'DM Sans', sans-serif" }}>
        <style>{getGlobalStyle(themeMode)}</style>
        <div style={{ background: B.dark, padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <EvaraLogo size="sm" dark onClick={onGoHome}/>
          <button onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Icon.LogOut/> Sign Out</button>
        </div>
        <div style={{ maxWidth: 480, margin: "60px auto", textAlign: "center", padding: 24 }}>
          <div style={{ width:60,height:60,borderRadius:14,background:B.surface,border:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",color:B.textMuted }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
          <div style={{ fontWeight: 700, fontSize: 18, color: B.text, marginBottom: 8 }}>No listing found for your account</div>
          <div style={{ fontSize: 13, color: B.textMuted, lineHeight: 1.6 }}>Your account is registered as a vendor, but we couldn't find a linked business listing. Contact support so we can connect your account to your listing.</div>
        </div>
      </div>
    );
  }

  // Application submitted but not yet reviewed — show a waiting state
  // instead of the full dashboard, since there are no real bookings or a
  // public listing to manage yet.
  if (myVendor.status === "pending") {
    return (
      <div style={{ minHeight: "100vh", background: B.bg, fontFamily: "'DM Sans', sans-serif" }}>
        <style>{getGlobalStyle(themeMode)}</style>
        <div style={{ background: B.dark, padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <EvaraLogo size="sm" dark onClick={onGoHome}/>
          <button onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Icon.LogOut/> Sign Out</button>
        </div>
        <div style={{ maxWidth: 480, margin: "60px auto", textAlign: "center", padding: 24 }}>
          <div style={{ width: 60, height: 60, borderRadius: 14, background: "#FFF4E5", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: B.warning }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div style={{ fontWeight: 700, fontSize: 18, color: B.text, marginBottom: 8 }}>Your application is under review</div>
          <div style={{ fontSize: 13, color: B.textMuted, lineHeight: 1.6, marginBottom: 20 }}>Thanks for applying to list <strong style={{ color: B.text }}>{myVendor.name}</strong> on Evara. Our team typically reviews new applications within a day or two — we'll notify you once it's approved and live.</div>
          <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16, textAlign: "left" }}>
            {[["Category", CAT_LABELS[myVendor.category] || myVendor.category], ["Location", myVendor.location], ["Starting price", fmt(myVendor.base_price)]].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13 }}>
                <span style={{ color: B.textMuted }}>{label}</span>
                <span style={{ fontWeight: 600, color: B.text }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Application reviewed and declined — explain why (if a reason was left)
  // and let them edit + resubmit, which the resubmit trigger in Supabase
  // quietly moves back to 'pending' for another review.
  if (myVendor.status === "rejected") {
    return (
      <div style={{ minHeight: "100vh", background: B.bg, fontFamily: "'DM Sans', sans-serif" }}>
        <style>{getGlobalStyle(themeMode)}</style>
        <div style={{ background: B.dark, padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <EvaraLogo size="sm" dark onClick={onGoHome}/>
          <button onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Icon.LogOut/> Sign Out</button>
        </div>
        <div style={{ maxWidth: 480, margin: "60px auto", textAlign: "center", padding: 24 }}>
          <div style={{ width: 60, height: 60, borderRadius: 14, background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: B.danger }}>
            <Icon.X/>
          </div>
          <div style={{ fontWeight: 700, fontSize: 18, color: B.text, marginBottom: 8 }}>Your application wasn't approved</div>
          <div style={{ fontSize: 13, color: B.textMuted, lineHeight: 1.6, marginBottom: myVendor.rejection_reason ? 12 : 20 }}>We weren't able to approve <strong style={{ color: B.text }}>{myVendor.name}</strong> for listing on Evara at this time.</div>
          {myVendor.rejection_reason && (
            <div style={{ background: "#FEF2F2", border: "1px solid #D9404033", borderRadius: 12, padding: "12px 14px", fontSize: 13, color: B.danger, textAlign: "left", marginBottom: 20 }}>{myVendor.rejection_reason}</div>
          )}
          <button onClick={() => { setForm({ name: myVendor.name || "", category: myVendor.category || "wedding", location: myVendor.location || "", base_price: myVendor.base_price || "", description: myVendor.description || "", response_time: myVendor.response_time || "" }); setEditing(true); setVTab("listing"); }} style={{ padding: "12px 28px", borderRadius: 10, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer" }}>
            Edit & Resubmit
          </button>
        </div>
        {editing && form && (
          <div style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(12,22,40,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={() => setEditing(false)}>
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "85vh", background: B.bg, borderRadius: "22px 22px 0 0", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "16px 20px", background: B.surface, borderBottom: `1px solid ${B.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>Edit Application</div>
                <button onClick={() => setEditing(false)} style={{ width: 32, height: 32, borderRadius: 8, border: `1.5px solid ${B.border}`, background: B.surface, cursor: "pointer", color: B.textMuted }}><Icon.X/></button>
              </div>
              <div style={{ overflowY: "auto", flex: 1, padding: "18px 16px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div><label style={labelStyle}>Business Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle}/></div>
                <div><label style={labelStyle}>Category</label><select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={{ ...inputStyle, cursor: "pointer" }}>{VENDOR_CATEGORIES.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></div>
                <div><label style={labelStyle}>Location</label><input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} style={inputStyle}/></div>
                <div><label style={labelStyle}>Starting Price (LKR)</label><input type="number" value={form.base_price} onChange={e => setForm(f => ({ ...f, base_price: e.target.value }))} style={inputStyle}/></div>
                <div><label style={labelStyle}>Description</label><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}/></div>
                <button onClick={saveListing} disabled={saving} style={{ width: "100%", padding: 14, borderRadius: 12, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 14, border: "none", cursor: saving ? "not-allowed" : "pointer", marginTop: 6 }}>{saving ? "Submitting…" : "Resubmit for Review"}</button>
              </div>
            </div>
          </div>
        )}
        <Toast toast={toast}/>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: B.bg, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{getGlobalStyle(themeMode)}</style>
      <div style={{ background: B.dark, padding: "0 20px", position: "sticky", top: 0, zIndex: 200, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <EvaraLogo size="sm" dark onClick={onGoHome}/>
    <div style={{ background: "rgba(212,175,106,0.12)", border: "1px solid rgba(212,175,106,0.25)", borderRadius: 6, padding: "2px 10px", fontSize: 10.5, fontWeight: 700, color: B.accent, letterSpacing: 1.2 }}>VENDOR PORTAL</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <NotificationBell user={user} token={token} variant="header" onNavigateToBooking={() => setVTab("bookings")}/>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{user.email}</span>
            <button onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <Icon.LogOut/> Sign Out
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, overflowX: "auto", scrollbarWidth: "none" }}>
          {tabs.map(({ id, label, count, urgent }) => (
            <button key={id} onClick={() => setVTab(id)} style={{ padding: "10px 14px", background: "none", border: "none", borderBottom: vTab === id ? `2px solid ${B.accent}` : "2px solid transparent", color: vTab === id ? "#fff" : "rgba(255,255,255,0.4)", fontWeight: vTab === id ? 700 : 500, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, flexShrink: 0, whiteSpace: "nowrap" }}>
              {label}
              {count !== undefined && <span style={{ background: vTab === id ? B.accent : urgent ? "rgba(217,64,64,0.7)" : "rgba(255,255,255,0.1)", color: vTab === id ? B.dark : "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{count}</span>}
            </button>
          ))}
        </div>
      </div>

      {!myVendor.verified && (
        <div className="admin-max" style={{ padding: "14px 0 0" }}>
          <div style={{ background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.25)", borderRadius: 12, padding: "10px 16px", fontSize: 13, color: B.warning, fontWeight: 600 }}>
            Your listing is pending verification. It may not be visible to customers yet.
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="admin-max" style={{ padding: "16px 0 0", overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 12, minWidth: "max-content" }}>
          {stats.map(({ label, value, color, icon }) => (
            <div key={label} style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: "14px 18px", flexShrink: 0, minWidth: 140 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: B.bg, display: "flex", alignItems: "center", justifyContent: "center", color, marginBottom: 8 }}>{icon}</div>
              <div style={{ fontSize: 11, color: B.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'Playfair Display',serif" }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Overview Tab */}
      {vTab === "overview" && (
        <div className="admin-max" style={{ padding: "16px 0" }}>
          <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>Recent Booking Requests</div>
              <button onClick={() => setVTab("bookings")} style={{ fontSize: 12, color: B.accent, fontWeight: 700, background: "none", border: "none", cursor: "pointer" }}>View all →</button>
            </div>
            {loadingB ? [1, 2, 3].map(i => <div key={i} style={{ height: 60, marginBottom: 8 }}><Skeleton h={60} r={10}/></div>) :
              myBookings.length === 0 ? <div style={{ textAlign: "center", padding: "40px 0", color: B.textMuted }}><div style={{ width:44,height:44,borderRadius:10,background:B.bg,border:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 10px",color:B.textMuted }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>No bookings yet</div> :
              myBookings.slice(0, 5).map(b => {
                const ss = STATUS_STYLE[b.status] || STATUS_STYLE.pending;
                return (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${B.border}` }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: B.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>{getCatIcon(myVendor.category, 16, B.primary)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: B.text }}>#{shortId(b.id)}</div>
                      <div style={{ fontSize: 11, color: B.textMuted }}>{b.event_type || "Event"} · {formatDate(b.event_date)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: B.text }}>{fmt(b.amount)}</div>
                      <div style={{ background: ss.bg, color: ss.c, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, marginTop: 2 }}>{ss.label}</div>
                    </div>
                  </div>
                );
              })
            }
          </div>
        </div>
      )}

      {/* My Listing Tab */}
      {vTab === "listing" && (
        <div className="admin-max" style={{ padding: "16px 0" }}>
          <div style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: B.text }}>Listing Details</div>
              {!editing ? (
                <button onClick={() => setEditing(true)} style={{ padding: "8px 16px", borderRadius: 8, background: B.accentSoft, border: `1px solid ${B.border}`, color: B.text, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Edit</button>
              ) : (
                <button onClick={() => { setEditing(false); setForm({ name: myVendor.name || "", category: myVendor.category || "wedding", location: myVendor.location || "", base_price: myVendor.base_price || "", description: myVendor.description || "", response_time: myVendor.response_time || "" }); }} style={{ padding: "8px 16px", borderRadius: 8, background: B.bg, border: `1px solid ${B.border}`, color: B.textMuted, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Cancel</button>
              )}
            </div>

            {!editing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 56, height: 56, borderRadius: 14, background: B.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, border: `1px solid ${B.border}` }}>{getCatIcon(myVendor.category, 16, B.primary)}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 17, color: B.text }}>{myVendor.name}</div>
                    <div style={{ fontSize: 12, color: B.textMuted, marginTop: 2 }}>{CAT_LABELS[myVendor.category] || myVendor.category} · {myVendor.location}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  <div style={{ width: "100%" }}>
                    <div style={labelStyle}>Package Prices</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {[{ label: "Basic", mult: 1 }, { label: "Standard", mult: 1.5, popular: true }, { label: "Premium", mult: 2.5 }].map(({ label, mult, popular }) => (
                        <div key={label} style={{ flex: 1, background: popular ? B.accentSoft : B.bg, border: `1.5px solid ${popular ? B.accent + "55" : B.border}`, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: popular ? B.accent : B.textMuted, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}{popular ? " ★" : ""}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: popular ? B.accent : B.primary, marginTop: 4 }}>{fmt(Math.round(myVendor.base_price * mult))}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div><div style={labelStyle}>Rating</div><div style={{ fontSize: 15, fontWeight: 700, color: B.text }}>{reviewCount ? `⭐ ${reviewAvg.toFixed(1)} (${reviewCount})` : "No reviews yet"}</div></div>
                  <div><div style={labelStyle}>Response Time</div><div style={{ fontSize: 15, fontWeight: 700, color: B.text }}>{myVendor.response_time || "—"}</div></div>
                  <div><div style={labelStyle}>Status</div><div style={{ fontSize: 13, fontWeight: 700, color: myVendor.verified ? B.success : B.warning }}>{myVendor.verified ? "✓ Verified" : "Pending Verification"}</div></div>
                </div>
                <div>
                  <div style={labelStyle}>Description</div>
                  <div style={{ fontSize: 14, color: B.text, lineHeight: 1.6 }}>{myVendor.description || "No description added yet."}</div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div><label style={labelStyle}>Business Name *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle}/></div>
                <div><label style={labelStyle}>Category</label><select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={{ ...inputStyle, cursor: "pointer" }}>{VENDOR_CATEGORIES.map(({ id, label, emoji }) => <option key={id} value={id}>{emoji} {label}</option>)}</select></div>
                <div><label style={labelStyle}>Location *</label><input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} style={inputStyle}/></div>
                <div><label style={labelStyle}>Starting Price (LKR) *</label><input type="number" value={form.base_price} onChange={e => setForm(f => ({ ...f, base_price: e.target.value }))} style={inputStyle} min="0"/>
                  {form.base_price > 0 && (
                    <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                      {[{ label: "Basic", mult: 1 }, { label: "Standard", mult: 1.5 }, { label: "Premium", mult: 2.5 }].map(({ label, mult }) => (
                        <div key={label} style={{ flex: 1, background: B.bg, border: `1px solid ${B.border}`, borderRadius: 8, padding: "7px 10px", textAlign: "center" }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: B.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: B.primary, marginTop: 2 }}>{fmt(Math.round(parseFloat(form.base_price) * mult) || 0)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div><label style={labelStyle}>Response Time</label><input value={form.response_time} onChange={e => setForm(f => ({ ...f, response_time: e.target.value }))} placeholder="e.g. < 1hr" style={inputStyle}/></div>
                <div><label style={labelStyle}>Description</label><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ ...inputStyle, minHeight: 100, resize: "vertical" }}/></div>
                <button onClick={saveListing} disabled={saving} style={{ width: "100%", padding: 14, borderRadius: 12, background: B.primary, color: "#fff", fontWeight: 700, fontSize: 15, border: "none", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bookings Tab */}
      {vTab === "bookings" && (
        <div className="admin-max" style={{ padding: "16px 0" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {["all", "pending", "confirmed", "paid", "completed", "cancelled"].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", background: filterStatus === s ? B.primary : B.surface, color: filterStatus === s ? "#fff" : B.textMuted, border: `1.5px solid ${filterStatus === s ? B.primary : B.border}` }}>
                {s === "all" ? "All" : STATUS_STYLE[s]?.label || s}
              </button>
            ))}
          </div>
          {loadingB ? [1, 2, 3].map(i => <div key={i} style={{ background: B.surface, borderRadius: 14, height: 100, border: `1px solid ${B.border}`, marginBottom: 10 }}><Skeleton h="100%" r={14}/></div>) :
            filteredBookings.length === 0 ? <div style={{ textAlign: "center", padding: "60px 0", color: B.textMuted }}><div style={{ width:52,height:52,borderRadius:12,background:B.surface,border:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",color:B.textMuted }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div style={{ fontWeight: 700 }}>No bookings found</div></div> :
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredBookings.map(b => {
                const ss = STATUS_STYLE[b.status] || STATUS_STYLE.pending;
                // If this is still pending, check whether this date is
                // already locked by a different booking that's further
                // along — confirming this one would hit the database's
                // double-booking safeguard, so flag it before they try.
                const dateAlreadyLocked = b.status === "pending" && myBookings.some(other =>
                  other.id !== b.id &&
                  other.event_date === b.event_date &&
                  ["confirmed", "paid", "release_requested", "released", "completed"].includes(other.status)
                );
                return (
                  <div key={b.id} style={{ background: B.surface, borderRadius: 14, border: `1px solid ${dateAlreadyLocked ? `${B.warning}66` : B.border}`, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: B.text }}>#{shortId(b.id)} · {b.event_type || "Event"}</div>
                        <div style={{ fontSize: 12, color: B.textMuted, marginTop: 2 }}>{formatDate(b.event_date)} · {b.guests ? `${b.guests} guests` : ""} {b.location ? `· ${b.location}` : ""}</div>
                        {b.package && <div style={{ fontSize: 11, color: B.textLight, marginTop: 2 }}>Package: {b.package}</div>}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 16, color: B.primary }}>{fmt(b.amount)}</div>
                        <div style={{ background: ss.bg, color: ss.c, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, marginTop: 4, display: "inline-block" }}>{ss.label}</div>
                      </div>
                    </div>
                    {dateAlreadyLocked && (
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 7, background: "#FFF4E5", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: B.warning, fontWeight: 600, marginBottom: 10 }}>
                        <span style={{ flexShrink: 0, marginTop: 1 }}>⚠️</span>
                        You already have a confirmed booking on this date — confirming this one too isn't possible. Decline it or contact the customer to reschedule.
                      </div>
                    )}
                    {b.notes && <div style={{ background: B.bg, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: B.textMuted, marginBottom: 10 }}>{b.notes}</div>}
                    {b.status === "pending" && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => updateBookingStatus(b.id, "confirmed")} disabled={dateAlreadyLocked} style={{ flex: 1, padding: 10, borderRadius: 10, background: dateAlreadyLocked ? B.bg : "#EDFAF4", border: `1px solid ${dateAlreadyLocked ? B.border : "rgba(26,155,108,0.3)"}`, color: dateAlreadyLocked ? B.textLight : B.success, fontWeight: 700, fontSize: 13, cursor: dateAlreadyLocked ? "not-allowed" : "pointer" }}>✓ Confirm</button>
                        <button onClick={() => updateBookingStatus(b.id, "cancelled")} style={{ flex: 1, padding: 10, borderRadius: 10, background: "#FEF2F2", border: "1px solid #D9404033", color: B.danger, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>✕ Decline</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          }
        </div>
      )}

      {/* Reviews Tab */}
      {vTab === "reviews" && (
        <div className="admin-max" style={{ padding: "16px 0" }}>
          {loadingReviews ? (
            [1, 2, 3].map(i => <div key={i} style={{ background: B.surface, borderRadius: 14, height: 90, border: `1px solid ${B.border}`, marginBottom: 10 }}><Skeleton h="100%" r={14}/></div>)
          ) : reviewCount === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: B.textMuted }}>
              <div style={{ width: 52, height: 52, borderRadius: 12, background: B.surface, border: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", color: B.textMuted }}><Icon.Star/></div>
              <div style={{ fontWeight: 700 }}>No reviews yet</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Reviews appear here once customers rate a completed booking.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16, marginBottom: 4 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 32, fontWeight: 700, color: B.text }}>{reviewAvg.toFixed(1)}</div>
                <div>
                  <StarRow rating={reviewAvg} size={15}/>
                  <div style={{ fontSize: 12, color: B.textMuted, marginTop: 3 }}>Based on {reviewCount} review{reviewCount !== 1 ? "s" : ""}</div>
                </div>
              </div>
              {myReviews.map(r => (
                <div key={r.id} style={{ background: B.surface, borderRadius: 14, border: `1px solid ${B.border}`, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <StarRow rating={r.rating}/>
                    <span style={{ fontSize: 11, color: B.textMuted }}>{formatDate(r.created_at)}</span>
                  </div>
                  {r.comment && <p style={{ fontSize: 13.5, color: B.text, lineHeight: 1.6 }}>{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Toast toast={toast}/>
    </div>
  );
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("signin"); // signin | signup | forgot
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [policyTab, setPolicyTab] = useState(null); // null | "terms" | "refunds"
  const [resetSent, setResetSent] = useState(false);
  const handleSubmit = async () => {
    setError("");
    if (!form.email || !form.password) { setError("Email and password required."); return; }
    if (mode === "signup" && !form.name) { setError("Name required."); return; }
    setLoading(true);
    let res;
    if (mode === "signup") {
      res = await sb.signUp(form.email, form.password, form.name);
    } else {
      res = await sb.signIn(form.email, form.password);
    }
    if (res.error || res.error_description) { setLoading(false); setError(res.error_description || res.error?.message || "Authentication failed."); return; }
    const token = res.access_token;
    const refreshTok = res.refresh_token;
    const user = await sb.getUser(token);
    setLoading(false);
    onAuth({ user, token, refreshToken: refreshTok });
  };
  const handleForgotSubmit = async () => {
    setError("");
    if (!form.email) { setError("Please enter your email."); return; }
    setLoading(true);
    await sb.recoverPassword(form.email, window.location.origin);
    setLoading(false);
    // Always show the same success state regardless of whether the email
    // exists — this is intentional: confirming "no account with that email"
    // would let someone enumerate which emails are registered on Evara.
    setResetSent(true);
  };
  const signInWithGoogle = () => { window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${window.location.origin}`; };

  if (mode === "forgot") {
    return (
      <div style={{ padding: "32px 28px 28px", background: B.dark, borderRadius: 20 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}><EvaraLogo size="lg" dark/></div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>{resetSent ? "Check your email" : "Reset your password"}</div>
        </div>
        {resetSent ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, textAlign: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(212,175,106,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", color: B.accent }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z" opacity="0"/><path d="M22 6l-10 7L2 6"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>
            </div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
              If an Evara account exists for <strong style={{ color: "#fff" }}>{form.email}</strong>, we've sent a link to reset your password. It'll expire soon, so use it shortly.
            </div>
            <button onClick={() => { setMode("signin"); setResetSent(false); setError(""); }} style={{ width: "100%", padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.08)", color: "#fff", fontWeight: 700, fontSize: 14, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", marginTop: 4 }}>
              Back to Sign In
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: -2, lineHeight: 1.5 }}>Enter the email on your account and we'll send you a link to reset your password.</div>
            <div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, fontWeight: 600 }}>Email</div>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="you@example.com" onKeyDown={e => e.key === "Enter" && handleForgotSubmit()} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 14, outline: "none" }}/>
            </div>
            {error && <div style={{ background: "rgba(217,64,64,0.15)", border: "1px solid rgba(217,64,64,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#FF8080" }}>{error}</div>}
            <button onClick={handleForgotSubmit} disabled={loading} style={{ width: "100%", padding: 14, borderRadius: 12, background: B.accent, color: B.dark, fontWeight: 700, fontSize: 15, border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, marginTop: 4 }}>
              {loading ? "Sending…" : "Send Reset Link"}
            </button>
            <button onClick={() => { setMode("signin"); setError(""); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "6px 0", textAlign: "center" }}>
              ← Back to Sign In
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: "32px 28px 28px", background: B.dark, borderRadius: 20 }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}><EvaraLogo size="lg" dark/></div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Sri Lanka's premier event booking platform</div>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.1)", marginBottom: mode === "signup" ? 20 : 28, gap: 28 }}>
        {["signin", "signup"].map(m => (
          <button key={m} onClick={() => { setMode(m); setError(""); }} style={{ padding: "0 0 12px", fontSize: 15, fontWeight: 700, cursor: "pointer", border: "none", borderBottom: mode === m ? `2px solid ${B.accent}` : "2px solid transparent", marginBottom: -1, background: "transparent", color: mode === m ? "#fff" : "rgba(255,255,255,0.4)", transition: "color .2s, border-color .2s" }}>
            {m === "signin" ? "Sign In" : "Create Account"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {mode === "signup" && (
          <div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, fontWeight: 600 }}>Full Name</div>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Your name" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 14, outline: "none" }}/>
          </div>
        )}
        <div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, fontWeight: 600 }}>Email</div>
          <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="you@example.com" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 14, outline: "none" }}/>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>Password</div>
            {mode === "signin" && (
              <button onClick={() => { setMode("forgot"); setError(""); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>Forgot password?</button>
            )}
          </div>
          <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && handleSubmit()} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 14, outline: "none" }}/>
        </div>
        {error && <div style={{ background: "rgba(217,64,64,0.15)", border: "1px solid rgba(217,64,64,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#FF8080" }}>{error}</div>}
        <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", padding: 14, borderRadius: 12, background: B.accent, color: B.dark, fontWeight: 700, fontSize: 15, border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, marginTop: 4 }}>
          {loading ? (mode === "signin" ? "Signing in…" : "Creating account…") : (mode === "signin" ? "Sign In" : "Create Account")}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }}/><span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>or</span><div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }}/>
        </div>
        <button onClick={signInWithGoogle} style={{ width: "100%", padding: 14, borderRadius: 12, background: "#fff", color: "#1C2B4B", fontWeight: 700, fontSize: 15, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Continue with Google
        </button>
      </div>
      <p style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
        By continuing you agree to Evara's{" "}
        <span onClick={() => setPolicyTab("terms")} style={{ color: "rgba(255,255,255,0.45)", textDecoration: "underline", cursor: "pointer" }}>Terms of Service</span>
        {" "}and{" "}
        <span onClick={() => setPolicyTab("refunds")} style={{ color: "rgba(255,255,255,0.45)", textDecoration: "underline", cursor: "pointer" }}>Refund Policy</span>
      </p>
      {policyTab && <PolicyModal initialTab={policyTab} onClose={() => setPolicyTab(null)}/>}
    </div>
  );
}


// Shown when the user arrives via the "reset your password" email link.
// recoveryToken is the short-lived access_token Supabase puts in the URL
// fragment — it's only good for setting a new password, not for normal
// API calls, so this screen signs the user in fresh afterwards rather than
// reusing it as a session token.
function ResetPasswordScreen({ recoveryToken, onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError("");
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    const res = await sb.updatePassword(recoveryToken, password);
    setLoading(false);
    if (res.error || res.error_description || res.msg) {
      setError(res.error_description || res.msg || res.error?.message || "Couldn't update your password. The link may have expired — try requesting a new one.");
      return;
    }
    setDone(true);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(12,22,40,0.7)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "fadeIn .2s ease" }}>
      <div style={{ width: "100%", maxWidth: 440, background: B.dark, borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 32px 80px rgba(0,0,0,0.6)", overflow: "hidden", animation: "slideUp .3s ease" }}>
        <div style={{ padding: "32px 28px 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}><EvaraLogo size="lg" dark/></div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>{done ? "Password updated" : "Set a new password"}</div>
          </div>
          {done ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, textAlign: "center" }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(26,155,108,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", color: B.success }}>
                <Icon.Check/>
              </div>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>Your password has been updated. You can now sign in with your new password.</div>
              <button onClick={onDone} style={{ width: "100%", padding: 14, borderRadius: 12, background: B.accent, color: B.dark, fontWeight: 700, fontSize: 15, border: "none", cursor: "pointer" }}>
                Continue to Sign In
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, fontWeight: 600 }}>New Password</div>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 14, outline: "none" }}/>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, fontWeight: 600 }}>Confirm New Password</div>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Re-enter your new password" onKeyDown={e => e.key === "Enter" && submit()} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 14, outline: "none" }}/>
              </div>
              {error && <div style={{ background: "rgba(217,64,64,0.15)", border: "1px solid rgba(217,64,64,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#FF8080" }}>{error}</div>}
              <button onClick={submit} disabled={loading} style={{ width: "100%", padding: 14, borderRadius: 12, background: B.accent, color: B.dark, fontWeight: 700, fontSize: 15, border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, marginTop: 4 }}>
                {loading ? "Updating…" : "Update Password"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Desktop Sidebar & Mobile Nav ─────────────────────────────────────────────
function DesktopSidebar({ tab, onTab, user, token, onShowAuth, onSignOut, onNavigateToBooking }) {
  const tabs = [{ id: "explore", label: "Explore", icon: Icon.Home, always: true }, { id: "bookings", label: "Bookings", icon: Icon.Bookmark, always: true }, { id: "dashboard", label: "Dashboard", icon: Icon.TrendUp, always: false }, { id: "profile", label: "Profile", icon: Icon.User, always: true }].filter(t => t.always || !!user);
  const name = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "";
  const initials = name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() || "?";
  return (
    <div className="evara-sidebar">
      <div className="evara-sidebar-logo">
        <EvaraLogo size="md" dark onClick={() => onTab("explore")}/>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 8, letterSpacing: 0.5 }}>Sri Lanka's Event Platform</div>
      </div>
      <nav className="evara-sidebar-nav">
        {user && <NotificationBell user={user} token={token} variant="sidebar" onNavigateToBooking={onNavigateToBooking}/>}
        {tabs.map(({ id, label, icon: Ico }) => (
          <button key={id} className={"evara-sidebar-item" + (tab === id ? " active" : "")} onClick={() => onTab(id)}>
            <Ico/><span>{label}</span>
          </button>
        ))}
        <div style={{ marginTop: "auto", paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <ThemeToggle variant="sidebar"/>
        </div>
      </nav>
      <div className="evara-sidebar-footer">
        {user ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
              <div className="evara-sidebar-avatar">{initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
              </div>
            </div>
            <button onClick={onSignOut} className="evara-sidebar-item" style={{ color: "rgba(217,64,64,0.8)", marginTop: 4 }}>
              <Icon.LogOut/><span>Sign Out</span>
            </button>
          </>
        ) : (
          <>
            <button onClick={onShowAuth} style={{ width: "100%", padding: "12px", borderRadius: 10, background: B.accent, color: B.dark, fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer", letterSpacing: "0.2px" }}>
              Sign In to Evara
            </button>
            <div style={{ textAlign: "center", marginTop: 8, fontSize: 11, color: "rgba(255,255,255,0.25)" }}>Free to browse · No credit card needed</div>
          </>
        )}
      </div>
    </div>
  );
}

function BottomNav({ tab, onTab, user }) {
  const tabs = [{ id: "explore", label: "Explore", icon: Icon.Home, always: true }, { id: "bookings", label: "Bookings", icon: Icon.Bookmark, always: true }, { id: "dashboard", label: "Dashboard", icon: Icon.TrendUp, always: false }, { id: "profile", label: "Profile", icon: Icon.User, always: true }].filter(t => t.always || !!user);
  return (
    <div className="evara-bottom-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 500, background: B.surface, borderTop: `1px solid ${B.border}`, display: "flex", padding: "8px 0 env(safe-area-inset-bottom, 8px)" }}>
      {tabs.map(({ id, label, icon: Ico }) => (
        <button key={id} onClick={() => onTab(id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "6px 0", color: tab === id ? B.primary : B.textLight }}>
          <Ico/><span style={{ fontSize: 10, fontWeight: tab === id ? 700 : 500 }}>{label}</span>
          {tab === id && <div style={{ width: 4, height: 4, borderRadius: "50%", background: B.accent, marginTop: -1 }}/>}
        </button>
      ))}
    </div>
  );
}

// ─── Support Widget ───────────────────────────────────────────────────────────
// General issues shown when there's no booking, or after booking-specific ones
const GENERAL_ISSUES = [
  { id: "payment_issue", label: "Payment / billing problem", icon: <><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></>, urgent: true,
    subOptions: ["Charged twice for one booking", "Payment failed but money was deducted", "Refund not received yet", "Issue with invoice / receipt"] },
  { id: "refund_request", label: "Refund request", icon: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></>, urgent: false,
    subOptions: ["I cancelled and want a refund", "Vendor cancelled on me", "Service was not as described", "I was charged by mistake / duplicate"] },
  { id: "account_issue", label: "Account / login problem", icon: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>, urgent: false,
    subOptions: ["Can't log in to my account", "Forgot my password", "Email verification not working", "I want to delete my account"] },
  { id: "website_bug", label: "Website bug", icon: <><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></>, urgent: false,
    subOptions: ["A page isn't loading", "A button isn't working", "Images aren't showing", "Booking or payment is stuck"] },
  { id: "other", label: "Something else", icon: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12.01" y2="16"/><path d="M12 8a2 2 0 0 1 2 2c0 1.5-2 1.5-2 3"/></>, urgent: false,
    subOptions: null },
];

// Issues shown for any booking, regardless of vendor category
const BOOKING_COMMON_ISSUES = [
  { id: "booking_not_confirmed", label: "Booking not confirmed", icon: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>, urgent: true },
  { id: "vendor_no_show", label: "Vendor didn't show up", icon: <><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>, urgent: true },
  { id: "vendor_unresponsive", label: "Vendor not responding", icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>, urgent: false },
  { id: "reschedule", label: "Need to reschedule", icon: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M12 14v3l2 1"/></>, urgent: false },
];

// Issues specific to the vendor's category for this booking
const CATEGORY_ISSUES = {
  wedding: [{ id: "venue_mismatch", label: "Hall different from listing", icon: <><path d="M3 22V12h18v10M2 12l10-9 10 9"/><rect x="9" y="16" width="6" height="6"/></>, urgent: false }, { id: "capacity_issue", label: "Capacity / space issue", icon: <><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/></>, urgent: false }],
  party: [{ id: "venue_mismatch", label: "Hall different from listing", icon: <><path d="M3 22V12h18v10M2 12l10-9 10 9"/><rect x="9" y="16" width="6" height="6"/></>, urgent: false }],
  chefs: [{ id: "food_quality", label: "Food quality / hygiene issue", icon: <><path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/></>, urgent: true }, { id: "menu_mismatch", label: "Menu different from order", icon: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>, urgent: false }],
  catering: [{ id: "food_quality", label: "Food quality / hygiene issue", icon: <><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/></>, urgent: true }, { id: "quantity_issue", label: "Quantity didn't match order", icon: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/></>, urgent: false }],
  djs: [{ id: "equipment_issue", label: "Equipment / sound issue", icon: <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></>, urgent: false }, { id: "playlist_issue", label: "Music selection issue", icon: <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>, urgent: false }],
  photographers: [{ id: "photo_quality", label: "Photo / video quality issue", icon: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></>, urgent: false }, { id: "delivery_delay", label: "Photos / videos not delivered", icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>, urgent: false }],
  videography: [{ id: "delivery_delay", label: "Footage not delivered", icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>, urgent: false }],
  florists: [{ id: "decor_mismatch", label: "Decor different from listing", icon: <><path d="M12 22V12"/><path d="M12 12C10 10 8 7 8 5a4 4 0 0 1 8 0c0 2-2 5-4 7z"/></>, urgent: false }, { id: "flowers_quality", label: "Flowers wilted / damaged", icon: <><path d="M12 22V12"/></>, urgent: false }],
  makeup: [{ id: "service_quality", label: "Result different than expected", icon: <><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></>, urgent: false }, { id: "hygiene_concern", label: "Hygiene concern with products", icon: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>, urgent: true }],
  cakes: [{ id: "cake_mismatch", label: "Cake different from order", icon: <><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2 1 2 1"/></>, urgent: false }, { id: "freshness_issue", label: "Freshness / taste issue", icon: <><path d="M12 2v4"/></>, urgent: true }],
  transport: [{ id: "vehicle_mismatch", label: "Vehicle different from listing", icon: <><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></>, urgent: false }, { id: "driver_issue", label: "Driver / punctuality issue", icon: <><circle cx="12" cy="12" r="10"/></>, urgent: false }],
  outdoor_venues: [{ id: "venue_mismatch", label: "Venue different from listing", icon: <><path d="M3 17l4-8 4 4 4-6 4 10H3z"/></>, urgent: false }, { id: "weather_concern", label: "Weather contingency concern", icon: <><circle cx="12" cy="12" r="5"/></>, urgent: false }],
  lighting_av: [{ id: "equipment_issue", label: "Equipment / AV issue", icon: <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>, urgent: false }],
  sports: [{ id: "facility_issue", label: "Facility / equipment issue", icon: <><circle cx="12" cy="12" r="10"/></>, urgent: false }],
  event_planners: [{ id: "planning_mismatch", label: "Plan didn't match agreement", icon: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M9 15l2 2 4-4"/></>, urgent: false }],
  kids_entertainment: [{ id: "safety_concern", label: "Safety concern", icon: <><circle cx="12" cy="12" r="10"/></>, urgent: true }, { id: "service_quality", label: "Entertainment quality issue", icon: <><circle cx="12" cy="12" r="10"/></>, urgent: false }],
  vendors: [{ id: "service_quality", label: "Service different than expected", icon: <><circle cx="12" cy="12" r="10"/></>, urgent: false }],
};

// Instant canned answers shown right after a ticket is submitted, before the
// "we've received it" confirmation. Keyed by sub-option text (general topics)
// or by issue id (booking-specific / category-specific issues). Written in
// short, plain sentences so any user can understand them at a glance.
const AUTO_REPLIES = {
  // Payment / billing
  "Charged twice for one booking": "Sorry about that. This usually happens when one of the charges is just a temporary hold, not a real second payment — banks normally remove it within 3–5 business days on their own. We've logged your case so our team can check both charges and refund you if needed.",
  "Payment failed but money was deducted": "Don't worry, your money is not lost. This happens when the bank takes the payment but the confirmation doesn't reach us in time. It's usually fixed automatically within 5–7 business days. We've marked this as urgent so our team can check it sooner.",
  "Refund not received yet": "Refunds normally take 5–10 business days to appear in your bank account after they're approved. We've logged this so our team can check exactly where your refund is and update you.",
  "Issue with invoice / receipt": "You can view or download your receipt anytime: go to My Bookings, open the booking, then tap Receipt. If something on it looks wrong, let us know what's incorrect and our team will send you a corrected copy.",

  // Refunds
  "I cancelled and want a refund": "Whether you get a refund depends on the vendor's cancellation rules, which are shown on the booking page before you pay. Your payment is held safely until the event, so nothing has been paid out yet. Our team will check your booking and confirm your refund.",
  "Vendor cancelled on me": "We're sorry this happened. Your payment is safe — it's only released to a vendor after the event takes place, so a vendor who cancels on you gets nothing. We've marked this urgent so our team can refund you and help you find another vendor quickly.",
  "Service was not as described": "We're sorry to hear that. Every vendor on Evara is checked before they're allowed to list, so we take this seriously. Our team will compare what was promised with what you received and follow up with next steps, which may include a refund.",
  "I was charged by mistake / duplicate": "This is usually a payment system glitch, not two real bookings. We've logged it so our team can check your booking history and refund any extra charge.",

  // Account
  "Can't log in to my account": "First, try signing in with the exact same email or method (like Google) you used when you first signed up — that fixes most login problems. If it still doesn't work, our team will check your account directly.",
  "Forgot my password": "On the sign-in screen, tap 'Forgot password?' and a reset link will be sent to your email within a few minutes. If you don't see it, check your spam folder. We'll also follow up here if you still need help.",
  "Email verification not working": "Verification emails can take a few minutes and sometimes land in spam or promotions folders. If it still hasn't arrived after 10 minutes, our team will verify your account manually from this ticket.",
  "I want to delete my account": "We can delete your account, but please finish any upcoming or pending bookings first — deleting your account removes your booking history and any payment protection on bookings that haven't happened yet. Our team will confirm with you before deleting anything.",

  // Website bugs
  "A page isn't loading": "Please try refreshing the page or clearing your browser's cache first — this solves most loading problems. If it keeps happening, tell us which page and which device you're using, and we'll pass it to our engineering team.",
  "A button isn't working": "Try refreshing the page or opening the site in a different browser — this fixes most cases. We've also flagged this for our team to check on our side.",
  "Images aren't showing": "This usually fixes itself with a simple refresh. If images still don't load after that, especially on several pages, let us know and our team will look into it.",
  "Booking or payment is stuck": "Please don't try to pay again — trying twice can cause a double charge. We've marked this as urgent so our team can check your payment status right away and fix it for you.",

  // Booking-specific (keyed by issue id)
  booking_not_confirmed: "Bookings are usually confirmed within minutes, but it can take a bit longer if the vendor needs to manually accept your date. If it's been more than 24 hours, we've marked this urgent so our team can follow up with the vendor directly.",
  vendor_no_show: "We're really sorry this happened. Your payment is held safely and is only released to the vendor after the event happens — so since the vendor didn't show up, your money has not been paid out. We've marked this urgent so our team can refund you.",
  vendor_unresponsive: "Vendors are expected to reply within a few hours. Since they've gone quiet, our team can step in, contact the vendor for you, or help you find another vendor for your event.",
  reschedule: "Rescheduling depends on the vendor's own availability and policy, shown on their listing page. We've logged your request so our team can arrange a new date with the vendor on your behalf.",

  // Category-specific (keyed by issue id)
  venue_mismatch: "Every venue is checked before it's listed, so this is worth a closer look. Our team will compare the listing photos and description with what you actually saw and follow up with you.",
  capacity_issue: "Venue capacity is set by the vendor and should be safe and accurate. We've logged this so our team can double-check the listing with the vendor.",
  food_quality: "Food safety matters a lot to us. We've marked this as urgent so our team can look into it with the vendor right away — this may lead to a refund.",
  menu_mismatch: "We'll check what you ordered against what was actually delivered with the vendor, then follow up with you on next steps.",
  quantity_issue: "We've logged this so our team can compare what you ordered with what the vendor confirmed, and sort out the difference.",
  equipment_issue: "We've recorded this issue on the vendor's profile, since repeated problems affect how they appear on Evara. Our team will follow up about fixing this for your event.",
  playlist_issue: "We'll share your feedback with the vendor. Since music choices are usually agreed in advance, our team will also check what was originally confirmed.",
  photo_quality: "We take the quality of photos and videos seriously, since it's judged after the event is already over. Our team will review your case and the vendor's usual work.",
  delivery_delay: "Vendors list their delivery timelines on their profile. Since you've gone past that window, we've flagged this so our team can follow up with the vendor directly.",
  decor_mismatch: "We'll compare the listing photos with what was actually delivered for your event, then follow up with you about next steps.",
  flowers_quality: "We're sorry to hear that. Flowers don't last long, so timing really matters — we'll check how the vendor handled delivery for your event.",
  service_quality: "We've noted exactly what you expected versus what you received. Our team will follow up with you and review this with the vendor.",
  hygiene_concern: "Hygiene issues are always treated as urgent on Evara. Our team will review this with the vendor immediately and contact you directly.",
  cake_mismatch: "We'll compare your original order with what was delivered, then follow up with you — this may include a partial refund.",
  freshness_issue: "Freshness problems are treated as urgent. Our team will follow up with you and the vendor right away about next steps.",
  vehicle_mismatch: "We'll check the vehicle listed by the vendor against what actually showed up, then follow up about fixing this.",
  driver_issue: "We've logged this driver/timing issue. It affects how the vendor appears on Evara, and our team will follow up with you.",
  weather_concern: "Outdoor venues should have a backup plan for bad weather, listed on their profile. If that wasn't followed, we'll follow up with the vendor on your behalf.",
  facility_issue: "We've logged this facility or equipment issue so our team can review it with the vendor.",
  planning_mismatch: "We'll compare what was agreed with what was actually delivered by the event planner, then follow up with next steps.",
  safety_concern: "Safety concerns involving children's events are always treated as urgent. Our team will contact you and the vendor immediately.",

  // Catch-all for "Something else" or any unmapped issue
  other: "Thanks for letting us know. A real person on our support team reads every message and will get back to you directly, usually within a few hours.",
};

function getAutoReply(issue, subOption) {
  if (subOption && AUTO_REPLIES[subOption]) return AUTO_REPLIES[subOption];
  if (issue?.id && AUTO_REPLIES[issue.id]) return AUTO_REPLIES[issue.id];
  return AUTO_REPLIES.other;
}

function SupportWidget({ user, token }) {
  const [open, setOpen] = useState(false);
  // menu | ask_id | lookup | booking_issues | detail | sent
  const [stage, setStage] = useState("menu");
  const [bookingIdInput, setBookingIdInput] = useState("");
  const [foundBooking, setFoundBooking] = useState(null);
  const [lookupError, setLookupError] = useState("");
  const [looking, setLooking] = useState(false);
  const [issue, setIssue] = useState(null);
  const [subOption, setSubOption] = useState(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);

  const reset = () => {
    setStage("menu"); setBookingIdInput(""); setFoundBooking(null);
    setLookupError(""); setIssue(null); setSubOption(null); setMessage(""); setPhone("");
  };

  const handleLookup = async () => {
    const clean = bookingIdInput.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (clean.length < 6) { setLookupError("Enter a valid booking ID."); return; }
    setLooking(true); setLookupError("");
    // Booking IDs are UUIDs; shortId() strips dashes & uppercases the first 10 chars.
    // Logged-in users: search within their own bookings.
    // Guests: search is limited by database access rules and may not find the booking —
    // in that case they can still continue via "Skip" below.
    const filter = user ? `?user_id=eq.${user.id}&select=*,vendors(name,category,location)` : `?select=*,vendors(name,category,location)&limit=200`;
    const { data } = await sb.query("bookings", filter, token);
    const match = (data || []).find(b => b.id.replace(/-/g, "").toUpperCase().startsWith(clean));
    setLooking(false);
    if (!match) {
      setLookupError(user ? "No booking found with that ID. Check and try again, or skip." : "Couldn't find it. Try signing in, or skip to continue without it.");
      setFoundBooking(null);
      return;
    }
    setFoundBooking(match);
    setStage("booking_issues");
  };

  // Booking-specific issues already have a precise label, so go straight to detail.
  // General topics have broader labels, so show specific sub-options first when available.
  const handleSelectIssue = (iss) => {
    setIssue(iss); setSubOption(null);
    if (iss.subOptions && iss.subOptions.length > 0) setStage("general_sub");
    else setStage("detail");
  };

  const handleSelectSubOption = (opt) => { setSubOption(opt); setStage("detail"); };

  const handleSubmit = async () => {
    if (!subOption && !message.trim()) return;
    setSending(true);
    const payload = {
      issue_label: subOption || issue.label,
      message: message.trim() || subOption || issue.label,
      user_email: email.trim() || null,
      user_phone: phone.trim() || null,
      booking_id: foundBooking?.id || null,
      vendor_name: foundBooking?.vendors?.name || null,
      is_urgent: !!issue.urgent,
      status: "open",
    };
    let { error } = await sb.query("support_tickets", "", token, "POST", payload);
    if (error) {
      // Fallback if the `user_phone` column doesn't exist yet in the database —
      // fold the phone number into the message so the ticket still saves.
      const { user_phone, ...rest } = payload;
      rest.message = phone.trim() ? `[Phone: ${phone.trim()}]\n${rest.message}` : rest.message;
      await sb.query("support_tickets", "", token, "POST", rest);
    }
    setSending(false);
    setStage("sent");
  };

  const categoryIssues = foundBooking ? (CATEGORY_ISSUES[foundBooking.vendors?.category] || []) : [];

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => { setOpen(v => !v); if (!open) reset(); }}
        aria-label="Support"
        className="support-launcher"
        style={{ position: "fixed", right: 20, width: 56, height: 56, borderRadius: "50%", background: open ? B.dark : B.accent, color: open ? "#fff" : B.dark, border: "none", boxShadow: "0 8px 24px rgba(28,43,75,0.28)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 1500, transition: "background .2s, transform .15s" }}
        onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
        onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
      >
        {open
          ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        }
      </button>

      {/* Panel */}
      {open && (
        <div className="support-panel" style={{ position: "fixed", right: 20, width: "min(360px, calc(100vw - 32px))", maxHeight: "min(560px, calc(100vh - 180px))", background: B.surface, borderRadius: 20, border: `1px solid ${B.border}`, boxShadow: "0 24px 64px rgba(28,43,75,0.3)", zIndex: 1500, display: "flex", flexDirection: "column", overflow: "hidden", animation: "slideUp .25s cubic-bezier(.22,1,.36,1) both" }}>

          {/* Header */}
          <div style={{ background: B.dark, padding: "16px 18px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(212,175,106,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={B.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Evara Support</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1A9B6C", display: "inline-block" }}/>
                Online now
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>

            {/* ── Stage: menu ── */}
            {stage === "menu" && (
              <>
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: B.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14 }}>👋</div>
                  <div style={{ background: B.bg, borderRadius: "4px 14px 14px 14px", padding: "10px 14px", fontSize: 13.5, color: B.text, lineHeight: 1.55, maxWidth: "85%" }}>
                    Hi! Is this about a specific booking?
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
                  <button onClick={() => { setStage("ask_id"); setLookupError(""); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 13px", borderRadius: 12, background: B.accentSoft, border: `1.5px solid ${B.accent}55`, cursor: "pointer", textAlign: "left" }}>
                    <span style={{ color: B.primary, display: "flex", flexShrink: 0 }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: B.text, flex: 1 }}>Yes, I have a booking ID</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={B.textMuted} strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                  <button onClick={() => setStage("general")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 13px", borderRadius: 12, background: B.surface, border: `1px solid ${B.border}`, cursor: "pointer", textAlign: "left" }}>
                    <span style={{ color: B.textMuted, display: "flex", flexShrink: 0 }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12.01" y2="16"/><path d="M12 8a2 2 0 0 1 2 2c0 1.5-2 1.5-2 3"/></svg></span>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: B.text, flex: 1 }}>No, it's something else</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={B.textMuted} strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                </div>
              </>
            )}

            {/* ── Stage: ask for booking ID ── */}
            {stage === "ask_id" && (
              <>
                <button onClick={() => setStage("menu")} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: B.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 16 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                  Back
                </button>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: B.text, marginBottom: 6 }}>Enter your Booking ID</div>
                <div style={{ fontSize: 12, color: B.textMuted, marginBottom: 12, lineHeight: 1.55 }}>You'll find this on your booking card or receipt under "My Bookings".</div>
                <input value={bookingIdInput} onChange={e => { setBookingIdInput(e.target.value); setLookupError(""); }} onKeyDown={e => e.key === "Enter" && handleLookup()} placeholder="e.g. A1B2C3D4E5" style={{ width: "100%", padding: "11px 13px", borderRadius: 10, border: `1.5px solid ${lookupError ? B.danger : B.border}`, background: B.bg, fontSize: 14, color: B.text, outline: "none", marginBottom: 8, boxSizing: "border-box", letterSpacing: 0.5, fontFamily: "monospace" }}/>
                {lookupError && <div style={{ fontSize: 12, color: B.danger, marginBottom: 10 }}>{lookupError}</div>}
                <button onClick={handleLookup} disabled={!bookingIdInput.trim() || looking} style={{ width: "100%", padding: 12, borderRadius: 10, background: !bookingIdInput.trim() || looking ? B.border : B.accent, color: !bookingIdInput.trim() || looking ? B.textMuted : B.dark, fontWeight: 700, fontSize: 13.5, border: "none", cursor: !bookingIdInput.trim() || looking ? "default" : "pointer", marginBottom: 10 }}>
                  {looking ? "Looking up..." : "Find my booking"}
                </button>
                <button onClick={() => setStage("general")} style={{ width: "100%", padding: 10, borderRadius: 10, background: "none", border: "none", color: B.textMuted, fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
                  Skip — I don't have it
                </button>
              </>
            )}

            {/* ── Stage: booking found → show vendor + category-specific issues ── */}
            {stage === "booking_issues" && foundBooking && (
              <>
                <button onClick={() => setStage("ask_id")} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: B.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 14 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                  Back
                </button>
                <div style={{ background: B.bg, borderRadius: 12, padding: 12, marginBottom: 14, border: `1px solid ${B.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: B.success, letterSpacing: 0.5, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    BOOKING FOUND
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: B.text }}>{foundBooking.vendors?.name || "Vendor"}</div>
                  <div style={{ fontSize: 11.5, color: B.textMuted, marginTop: 2 }}>{CATEGORIES.find(c => c.id === foundBooking.vendors?.category)?.label || foundBooking.vendors?.category || "—"} · {foundBooking.vendors?.location || "—"}</div>
                  <div style={{ fontSize: 10.5, color: B.textMuted, marginTop: 4, fontFamily: "monospace" }}>#{shortId(foundBooking.id)}</div>
                </div>
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: B.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14 }}>👋</div>
                  <div style={{ background: B.bg, borderRadius: "4px 14px 14px 14px", padding: "10px 14px", fontSize: 13.5, color: B.text, lineHeight: 1.55, maxWidth: "85%" }}>
                    Got it, found your booking with {foundBooking.vendors?.name || "this vendor"}. What's going on?
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {[...categoryIssues, ...BOOKING_COMMON_ISSUES].map(iss => (
                    <button key={iss.id} onClick={() => handleSelectIssue(iss)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 11, background: B.surface, border: `1px solid ${B.border}`, cursor: "pointer", textAlign: "left" }} onMouseEnter={e => { e.currentTarget.style.borderColor = B.accent; e.currentTarget.style.background = B.accentSoft; }} onMouseLeave={e => { e.currentTarget.style.borderColor = B.border; e.currentTarget.style.background = B.surface; }}>
                      <span style={{ color: B.primary, display: "flex", flexShrink: 0 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{iss.icon}</svg></span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: B.text, flex: 1 }}>{iss.label}</span>
                    </button>
                  ))}
                  <button onClick={() => setStage("general")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 11, background: "none", border: `1px dashed ${B.border}`, cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: B.textMuted, flex: 1 }}>None of these — show other topics</span>
                  </button>
                </div>
              </>
            )}

            {/* ── Stage: general issues (no booking, or "something else") ── */}
            {stage === "general" && (
              <>
                <button onClick={() => setStage(foundBooking ? "booking_issues" : "menu")} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: B.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 16 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                  Back
                </button>
                <div style={{ fontSize: 12.5, color: B.textMuted, marginBottom: 10 }}>Choose a topic:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {GENERAL_ISSUES.map(iss => (
                    <button key={iss.id} onClick={() => handleSelectIssue(iss)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 12, background: B.surface, border: `1px solid ${B.border}`, cursor: "pointer", textAlign: "left" }} onMouseEnter={e => { e.currentTarget.style.borderColor = B.accent; e.currentTarget.style.background = B.accentSoft; }} onMouseLeave={e => { e.currentTarget.style.borderColor = B.border; e.currentTarget.style.background = B.surface; }}>
                      <span style={{ color: B.primary, display: "flex", flexShrink: 0 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{iss.icon}</svg></span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: B.text, flex: 1 }}>{iss.label}</span>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={B.textMuted} strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6"/></svg>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ── Stage: general sub-options (specific choices for the chosen topic) ── */}
            {stage === "general_sub" && issue && (
              <>
                <button onClick={() => setStage("general")} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: B.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 16 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                  Back
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 9, background: B.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", color: B.primary, flexShrink: 0 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{issue.icon}</svg></span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: B.text }}>{issue.label}</span>
                </div>
                <div style={{ fontSize: 12.5, color: B.textMuted, marginBottom: 10 }}>Which best describes it?</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {issue.subOptions.map(opt => (
                    <button key={opt} onClick={() => handleSelectSubOption(opt)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 11, background: B.surface, border: `1px solid ${B.border}`, cursor: "pointer", textAlign: "left" }} onMouseEnter={e => { e.currentTarget.style.borderColor = B.accent; e.currentTarget.style.background = B.accentSoft; }} onMouseLeave={e => { e.currentTarget.style.borderColor = B.border; e.currentTarget.style.background = B.surface; }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: B.text, flex: 1 }}>{opt}</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={B.textMuted} strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6"/></svg>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ── Stage: detail (message + phone + email) ── */}
            {stage === "detail" && issue && (
              <>
                <button onClick={() => setStage(foundBooking ? "booking_issues" : (issue.subOptions ? "general_sub" : "general"))} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: B.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 16 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                  Back
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 9, background: B.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", color: B.primary, flexShrink: 0 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{issue.icon}</svg></span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: B.text }}>{subOption || issue.label}</span>
                </div>
                {subOption && <div style={{ fontSize: 11.5, color: B.textMuted, marginBottom: 12, marginLeft: 40 }}>{issue.label}</div>}
                {foundBooking && <div style={{ fontSize: 11.5, color: B.textMuted, marginBottom: 12, background: B.bg, borderRadius: 8, padding: "7px 10px" }}>Linked to booking #{shortId(foundBooking.id)} · {foundBooking.vendors?.name}</div>}
                <div style={{ fontSize: 12.5, color: B.textMuted, marginBottom: 10, lineHeight: 1.5 }}>{subOption ? "Add any extra details (optional), and how we can reach you." : "Tell us a bit more so we can help faster."}</div>
                <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder={subOption ? "Anything else we should know? (optional)" : "Describe what happened..."} rows={4} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${B.border}`, background: B.bg, fontSize: 13, color: B.text, outline: "none", resize: "none", fontFamily: "inherit", marginBottom: 10, boxSizing: "border-box" }}/>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone number (so we can call you)" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${B.border}`, background: B.bg, fontSize: 13, color: B.text, outline: "none", marginBottom: 10, boxSizing: "border-box" }}/>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Your email (so we can reply)" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${B.border}`, background: B.bg, fontSize: 13, color: B.text, outline: "none", marginBottom: 14, boxSizing: "border-box" }}/>
                <button onClick={handleSubmit} disabled={(!subOption && !message.trim()) || sending} style={{ width: "100%", padding: 12, borderRadius: 10, background: (!subOption && !message.trim()) || sending ? B.border : B.accent, color: (!subOption && !message.trim()) || sending ? B.textMuted : B.dark, fontWeight: 700, fontSize: 13.5, border: "none", cursor: (!subOption && !message.trim()) || sending ? "default" : "pointer" }}>
                  {sending ? "Sending..." : "Send message"}
                </button>
              </>
            )}

            {/* ── Stage: sent ── */}
            {stage === "sent" && (
              <div style={{ padding: "10px 2px" }}>
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: B.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14 }}>👋</div>
                  <div style={{ background: B.bg, borderRadius: "4px 14px 14px 14px", padding: "11px 14px", fontSize: 13, color: B.text, lineHeight: 1.6, maxWidth: "88%" }}>
                    {getAutoReply(issue, subOption)}
                  </div>
                </div>
                <div style={{ textAlign: "center", padding: "16px 10px 6px" }}>
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#EDFAF4", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={B.success} strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: B.text, marginBottom: 6 }}>We've also notified our team</div>
                  <div style={{ fontSize: 12, color: B.textMuted, lineHeight: 1.6, marginBottom: 18 }}>
                    If you need more help, our team will get back to you{phone ? ` at ${phone}` : email ? ` at ${email}` : ""} as soon as possible.
                  </div>
                  <button onClick={reset} style={{ padding: "10px 20px", borderRadius: 10, background: B.surface, border: `1.5px solid ${B.border}`, color: B.text, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Back to menu</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [themeMode] = useTheme();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [refreshTok, setRefreshTok] = useState(null);
  const [tab, setTab] = useState("explore");
  const [showAuth, setShowAuth] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [toast, setToast] = useState(null);
  const [profileRole, setProfileRole] = useState(null);
  const [resetToken, setResetToken] = useState(null); // recovery access_token, while the "set new password" screen is up
  const { favoriteIds, toggleFavorite } = useFavorites(user, token);
  const [jumpToSaved, setJumpToSaved] = useState(false); // true for one mount of ExplorePage when arriving via "Saved Vendors" on the dashboard

  // Apply the stored theme preference once on first mount, and make sure the
  // page has a proper mobile viewport tag even if the host index.html is
  // missing one (this app is meant to fit phones, tablets, and desktops).
  useEffect(() => {
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement("meta");
      viewport.setAttribute("name", "viewport");
      document.head.appendChild(viewport);
    }
    viewport.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover");
    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) {
      metaTheme = document.createElement("meta");
      metaTheme.setAttribute("name", "theme-color");
      document.head.appendChild(metaTheme);
    }
    applyTheme(getStoredTheme());
  }, []);

  const isAdmin = user?.email === ADMIN_EMAIL;
  const isVendor = !isAdmin && profileRole === "vendor";
  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const refreshTimerRef = useRef(null);
  const scheduleRefresh = useCallback((accessToken, refresh_token) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    if (!refresh_token) return;
    try {
      const payload = JSON.parse(atob(accessToken.split(".")[1]));
      const expiresIn = (payload.exp * 1000) - Date.now() - 5 * 60 * 1000;
      if (expiresIn <= 0) return;
      refreshTimerRef.current = setTimeout(async () => {
        const res = await sb.refreshToken(refresh_token);
        if (res.error || !res.access_token) return;
        setToken(res.access_token);
        setRefreshTok(res.refresh_token);
        scheduleRefresh(res.access_token, res.refresh_token);
      }, expiresIn);
    } catch {}
  }, []);

  useEffect(() => { window.__evaraShowAuth = () => setShowAuth(true); return () => { delete window.__evaraShowAuth; }; }, []);
  useEffect(() => { window.__evaraSetTab = (t) => setTab(t); return () => { delete window.__evaraSetTab; }; }, []);

  const handleAuth = useCallback(async ({ user, token, refreshToken }) => {
    setUser(user); setToken(token); setRefreshTok(refreshToken);
    setShowAuth(false);
    scheduleRefresh(token, refreshToken);
    if (user?.email === ADMIN_EMAIL) {
      setProfileRole("admin");
      setTab("dashboard");
      showToast("Welcome to Admin Panel 🛡️");
      return;
    }
    const { data } = await sb.query("profiles", `?id=eq.${user.id}&select=role`, token);
    const role = data?.[0]?.role || "customer";
    setProfileRole(role);
    if (role === "vendor") {
      setTab("dashboard");
      showToast(`Welcome back, ${user.user_metadata?.full_name?.split(" ")[0] || "there"}! 👋`);
    } else {
      showToast(`Welcome back, ${user.user_metadata?.full_name?.split(" ")[0] || "there"}! 👋`);
    }
  }, [scheduleRefresh]);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes("access_token")) {
      const params = new URLSearchParams(hash.replace("#", "?"));
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      const type = params.get("type");
      if (access_token && type === "recovery") {
        // Recovery link clicked from the "reset your password" email — show
        // the set-new-password screen instead of silently signing them in.
        setResetToken(access_token);
        window.history.replaceState(null, null, window.location.pathname);
      } else if (access_token) {
        sb.getUser(access_token).then(user => {
          handleAuth({ user, token: access_token, refreshToken: refresh_token });
          window.history.replaceState(null, null, window.location.pathname);
        });
      }
    }
  }, [handleAuth]);

  const handleSignOut = async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    await sb.signOut(token);
    setUser(null); setToken(null); setRefreshTok(null);
    setProfileRole(null);
    setTab("explore");
    showToast("Signed out successfully", "info");
  };

  // Password recovery — takes priority over everything else, since the
  // person just clicked a one-time link from their email and the token
  // expires soon. Once they set a new password, drop into the normal app
  // signed-out, so they consciously sign in with it.
  if (resetToken) {
    return (
      <>
        <style>{getGlobalStyle(themeMode)}</style>
        <ResetPasswordScreen recoveryToken={resetToken} onDone={() => { setResetToken(null); setShowAuth(true); }}/>
      </>
    );
  }

  // Admin dashboard
  if (user && isAdmin && tab !== "explore" && tab !== "bookings" && tab !== "profile") {
    return (
      <>
        <style>{getGlobalStyle(themeMode)}</style>
        <AdminPanel user={user} token={token} onSignOut={handleSignOut} onGoHome={() => setTab("explore")}/>
      </>
    );
  }

  // Vendor dashboard
  if (user && isVendor && tab !== "explore" && tab !== "bookings" && tab !== "profile") {
    return (
      <>
        <style>{getGlobalStyle(themeMode)}</style>
        <VendorPanel user={user} token={token} onSignOut={handleSignOut} onGoHome={() => setTab("explore")}/>
      </>
    );
  }

  // Vendor detail
  if (selectedVendor) return (
    <>
      <style>{getGlobalStyle(themeMode)}</style>
      <VendorDetail vendor={selectedVendor} user={user} token={token} onBack={() => setSelectedVendor(null)} onBookingSuccess={() => { showToast("Booking confirmed! 🎉"); setSelectedVendor(null); setTab("bookings"); }} showToast={showToast} onShowAuth={() => setShowAuth(true)} isFavorited={favoriteIds.has(selectedVendor.id)} onToggleFavorite={toggleFavorite}/>
      <Toast toast={toast}/>
      {showAuth && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(12,22,40,0.7)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", animation: "fadeIn .2s ease" }}>
          <div style={{ width: "100%", maxWidth: 440, background: B.dark, borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 32px 80px rgba(0,0,0,0.6)", overflow: "hidden", position: "relative", animation: "slideUp .3s ease" }}>
            <button onClick={() => setShowAuth(false)} style={{ position: "absolute", top: 16, right: 16, width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 10 }}>
              <Icon.X/>
            </button>
            <AuthScreen onAuth={handleAuth}/>
          </div>
        </div>
      )}
    </>
  );

  return (
    <>
      <style>{getGlobalStyle(themeMode)}</style>
      <div className="evara-shell">
        <DesktopSidebar tab={tab} onTab={setTab} user={user} token={token} onShowAuth={() => setShowAuth(true)} onSignOut={handleSignOut} onNavigateToBooking={() => setTab("bookings")}/>
        <main className="evara-main">
          {tab === "explore" && <ExplorePage user={user} token={token} onVendorSelect={setSelectedVendor} onShowAuth={() => setShowAuth(true)} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} startWithSavedOnly={jumpToSaved} onConsumedSavedJump={() => setJumpToSaved(false)}/>}
          {tab === "bookings" && <BookingsPage user={user} token={token} onShowAuth={() => setShowAuth(true)} showToast={showToast}/>}
          {tab === "dashboard" && (user ? <CustomerDashboard user={user} token={token} onGoToBookings={() => setTab("bookings")} onGoToExplore={() => setTab("explore")} favoritesCount={favoriteIds.size} onGoToSaved={() => { setJumpToSaved(true); setTab("explore"); }}/> : <ExplorePage user={user} token={token} onVendorSelect={setSelectedVendor} onShowAuth={() => setShowAuth(true)} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite}/>)}
          {tab === "profile" && <ProfilePage user={user} token={token} onSignOut={handleSignOut} onShowAuth={() => setShowAuth(true)} isVendor={isVendor} isAdmin={isAdmin} onVendorApplicationSubmitted={() => { setProfileRole("vendor"); setTab("dashboard"); showToast("Application submitted! We'll review it shortly. 🎉"); }}/>}
        </main>
      </div>
      <BottomNav tab={tab} onTab={setTab} user={user}/>
      <Toast toast={toast}/>
      <SupportWidget user={user} token={token}/>

      {showAuth && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(12,22,40,0.7)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", animation: "fadeIn .2s ease" }}>
          <div style={{ width: "100%", maxWidth: 440, background: B.dark, borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 32px 80px rgba(0,0,0,0.6)", overflow: "hidden", position: "relative", animation: "slideUp .3s ease" }}>
            <button onClick={() => setShowAuth(false)} style={{ position: "absolute", top: 16, right: 16, width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 10 }}>
              <Icon.X/>
            </button>
            <AuthScreen onAuth={handleAuth}/>
          </div>
        </div>
      )}
    </>
  );
}
