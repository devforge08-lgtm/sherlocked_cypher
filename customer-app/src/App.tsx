import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { EmailOtpType, User } from '@supabase/supabase-js';
import {
  ArrowLeft, ArrowRight, Banknote, Bike, CheckCircle2, Clock3, CreditCard, Leaf,
  LoaderCircle, LocateFixed, LogOut, Mail, MapPin, Minus, Navigation, Package,
  Plus, RefreshCw, Route as RouteIcon, Search, ShieldCheck, ShoppingBag, Smartphone, Wallet, Trash2, X,
} from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet';
import { QRCodeSVG } from 'qrcode.react';
import 'leaflet/dist/leaflet.css';
import './index.css';
import { supabase } from './lib/supabase';

type Product = {
  id: number;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  stock: number;
  image_url: string | null;
};
type Cart = Record<number, number>;
type Address = {
  id: number | string;
  user_id: string;
  label: string;
  recipient_name: string | null;
  phone: string | null;
  address_line: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
};
type DemoOrder = {
  id: string;
  order_number: number | null;
  total_amount: number;
  status: string;
  payment_status: string;
  payment_reference: string | null;
};
type PaymentMethod = 'cod' | 'card' | 'upi';
type ConfirmationItem = {
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};
type OrderConfirmation = {
  id: string;
  order_number: number | null;
  total_amount: number;
  subtotal: number;
  delivery_fee: number;
  status: string;
  payment_status: string;
  payment_method: PaymentMethod;
  delivery_address: string;
  recipient_name: string;
  recipient_phone: string;
  address_line: string;
  items: ConfirmationItem[];
  created_at: string;
  edit_expires_at: string;
  edit_extension_used: boolean;
  scheduled_delivery_at: string | null;
};
type MapPosition = { lat: number; lng: number };

type TrackingOrder = {
  id: string;
  user_id: string;
  address_id: number | string | null;
  order_number: number | string | null;
  total_amount: number;
  status: string;
  payment_method: string | null;
  delivery_status: 'awaiting_rider' | 'accepted' | 'picked_up' | 'delivered' | null;
  rider_id: string | null;
  rider_latitude: number | null;
  rider_longitude: number | null;
  rider_location_updated_at: string | null;
  rider_location_accuracy_m: number | null;
  accepted_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  created_at: string;
  delivery_address: string | null;
};
type TrackingDestination = { latitude: number; longitude: number; address_line: string; city: string };
type FloatingTrackingOrder = {
  id: string;
  order_number: number | string | null;
  delivery_status: 'awaiting_rider' | 'accepted' | 'picked_up' | null;
  status: string;
  order_edit_expires_at: string | null;
  created_at: string;
};
type LatLng = [number, number];

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const ROUTING_URL = import.meta.env.VITE_OSRM_URL || 'https://router.project-osrm.org';

function geoDistanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function TrackingMapBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  const signature = points.map((point) => point.join(',')).join('|');
  useEffect(() => {
    if (points.length > 1) {
      const latitudes = points.map((point) => point[0]);
      const longitudes = points.map((point) => point[1]);
      const southWest: LatLng = [Math.min(...latitudes), Math.min(...longitudes)];
      const northEast: LatLng = [Math.max(...latitudes), Math.max(...longitudes)];
      map.fitBounds([southWest, northEast] as [LatLng, LatLng], { padding: [28, 28], maxZoom: 15 });
    } else if (points.length === 1) map.setView(points[0], 15);
  // Refit only when the coordinate signature changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature]);
  return null;
}

// Avoid verifying the same magic-link token twice under React StrictMode in development.
const tokenHashPromises = new Map<string, ReturnType<typeof supabase.auth.verifyOtp>>();
const codeExchangePromises = new Map<string, ReturnType<typeof supabase.auth.exchangeCodeForSession>>();

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2,
});
const money = (amount: number) => INR.format(amount);
const EMOJI: Record<string, string> = {
  Fruits: '🍌', Vegetables: '🥦', Dairy: '🥛', Bakery: '🍞', Snacks: '🍿',
  Beverages: '🥤', Household: '🧽', 'Personal Care': '🧴', General: '🛒',
};
const DEFAULT_POSITION: MapPosition = { lat: 12.9716, lng: 77.5946 };

function MapClickHandler({ onPick }: { onPick: (position: MapPosition) => void }) {
  useMapEvents({ click(event) { onPick({ lat: event.latlng.lat, lng: event.latlng.lng }); } });
  return null;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authFullName, setAuthFullName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [authCooldownUntil, setAuthCooldownUntil] = useState(0);
  const [, setAuthCountdown] = useState(0);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [cart, setCart] = useState<Cart>(() => {
    try {
      const raw = localStorage.getItem('quickcart_cart');
      return raw ? JSON.parse(raw) as Cart : {};
    } catch { return {}; }
  });

  const [page, setPage] = useState<'shop' | 'checkout'>('shop');
  const [cartOpen, setCartOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('new');
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [addressLabel, setAddressLabel] = useState('Home');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [position, setPosition] = useState<MapPosition>(DEFAULT_POSITION);
  const [mapOpen, setMapOpen] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [orderConfirmation, setOrderConfirmation] = useState<OrderConfirmation | null>(null);
  const [orderEditSecondsLeft, setOrderEditSecondsLeft] = useState(0);
  const [orderEditBusy, setOrderEditBusy] = useState(false);
  const [orderEditError, setOrderEditError] = useState('');
  const [orderProductSearch, setOrderProductSearch] = useState('');
  const [deliveryTiming, setDeliveryTiming] = useState<'asap' | 'scheduled'>('asap');
  const [scheduledDeliveryAt, setScheduledDeliveryAt] = useState('');
  const [repeatListName, setRepeatListName] = useState('My regular groceries');
  const [repeatFrequency, setRepeatFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [repeatLists, setRepeatLists] = useState<Array<{id:string;name:string;frequency:'daily'|'weekly'|'monthly';items:Cart;updated_at:string}>>([]);
  const [repeatMessage, setRepeatMessage] = useState('');
  const [repeatBuilderOpen, setRepeatBuilderOpen] = useState(false);
  const [repeatCheckoutName, setRepeatCheckoutName] = useState<string | null>(null);
  const [repeatDraft, setRepeatDraft] = useState<Cart>({});
  const [repeatProductSearch, setRepeatProductSearch] = useState('');
  const [autoRepeatBasketId, setAutoRepeatBasketId] = useState<string | null>(null);
  const [autoRepeatAddressId, setAutoRepeatAddressId] = useState('');
  const [autoRepeatSlot, setAutoRepeatSlot] = useState('09:00');
  const [autoRepeatSchedules, setAutoRepeatSchedules] = useState<Array<{id:string; saved_basket_id:string; is_active:boolean; frequency:'daily'|'weekly'|'monthly'; slot_start:string; next_delivery_at:string; basket_name?:string}>>([]);
  const [autoRepeatBusy, setAutoRepeatBusy] = useState(false);
  const [autoRepeatSetupStep, setAutoRepeatSetupStep] = useState<'checkout' | 'confirmation' | null>(null);
  const [autoRepeatSetupBasket, setAutoRepeatSetupBasket] = useState<{ id: string; name: string; frequency: 'daily'|'weekly'|'monthly'; items: Cart } | null>(null);
  const [autoRepeatPaymentMethod, setAutoRepeatPaymentMethod] = useState<PaymentMethod>('cod');
  const [autoRepeatConfirmed, setAutoRepeatConfirmed] = useState<{ nextDeliveryAt: string; basketName: string; paymentMethod: PaymentMethod } | null>(null);
  const [orderEditNotice, setOrderEditNotice] = useState('');
  const [cancelOrderBusy, setCancelOrderBusy] = useState(false);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('track-order'));
  const [floatingTrackingOrder, setFloatingTrackingOrder] = useState<FloatingTrackingOrder | null>(null);
  const [trackingOrder, setTrackingOrder] = useState<TrackingOrder | null>(null);
  const [trackingDestination, setTrackingDestination] = useState<TrackingDestination | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState('');
  const [trackingRoute, setTrackingRoute] = useState<LatLng[]>([]);
  const [trackingRouteInfo, setTrackingRouteInfo] = useState<{ distance: number; duration: number } | null>(null);
  const [trackingRouteMessage, setTrackingRouteMessage] = useState('');
  const lastTrackingRouteRequest = useRef<{ at: number; latitude: number; longitude: number; destLat: number; destLng: number } | null>(null);
  const trackingRouteRequestSequence = useRef(0);
  const [activeOrder, setActiveOrder] = useState<DemoOrder | null>(null);
  const [paymentApproved, setPaymentApproved] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  // Handle Supabase magic-link callback styles reliably:
  // - PKCE: ?code=...
  // - token hash: ?token_hash=...&type=magiclink
  // - implicit session: #access_token=...&refresh_token=...
  // Subscribe before callback parsing so auth events cannot be overwritten by
  // an older initial-session result. Dedupe one-time exchanges under StrictMode.
  useEffect(() => {
    let alive = true;
    let authEventSeen = false;
    const url = new URL(window.location.href);
    const queryTokenHash = url.searchParams.get('token_hash');
    const queryType = url.searchParams.get('type');
    const queryCode = url.searchParams.get('code');
    const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
    const hashAccessToken = hashParams.get('access_token');
    const hashRefreshToken = hashParams.get('refresh_token');
    const callbackError = url.searchParams.get('error_description') ||
      url.searchParams.get('error') || hashParams.get('error_description') || hashParams.get('error');

    if (callbackError) setAuthError(callbackError.replace(/\+/g, ' '));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      authEventSeen = true;
      if (!alive) return;
      setUser(session?.user ?? null);
      setAuthReady(true);
      if (event === 'SIGNED_IN') {
        setAuthError('');
        setAuthMessage('You are signed in. Welcome to QuickCart!');
      }
      if (event === 'SIGNED_OUT') {
        setAuthMessage('');
        setAddresses([]);
        setSelectedAddressId('new');
      }
    });

    function cleanCallbackUrl() {
      const clean = new URL(window.location.href);
      ['code', 'token_hash', 'type', 'error', 'error_description', 'error_code'].forEach((key) => {
        clean.searchParams.delete(key);
      });
      const fragment = new URLSearchParams(clean.hash.startsWith('#') ? clean.hash.slice(1) : clean.hash);
      const hasAuthFragment = ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'provider_token', 'provider_refresh_token'].some((key) => fragment.has(key));
      if (hasAuthFragment || fragment.has('error') || fragment.has('error_description')) clean.hash = '';
      window.history.replaceState({}, document.title, `${clean.pathname}${clean.search}${clean.hash}`);
    }

    function acceptSignedInUser(user: User | null) {
      if (!alive) return;
      setUser(user);
      setAuthReady(true);
      if (user) {
        setAuthError('');
        setAuthMessage('Email sign-in complete. Welcome to QuickCart!');
      }
      cleanCallbackUrl();
    }

    async function initializeAuth() {
      try {
        // supabase-js automatically handles a standard ConfirmationURL when
        // detectSessionInUrl is enabled. Check that result first to avoid
        // exchanging the same PKCE code a second time.
        const initial = await supabase.auth.getSession();
        if (!alive) return;
        if (initial.data.session?.user) {
          acceptSignedInUser(initial.data.session.user);
          return;
        }

        if (queryTokenHash) {
          const permittedTypes: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];
          const otpType: EmailOtpType = permittedTypes.includes(queryType as EmailOtpType)
            ? queryType as EmailOtpType : 'magiclink';
          let verification = tokenHashPromises.get(queryTokenHash);
          if (!verification) {
            verification = supabase.auth.verifyOtp({ token_hash: queryTokenHash, type: otpType });
            tokenHashPromises.set(queryTokenHash, verification);
          }
          const { data, error } = await verification;
          if (!alive) return;
          if (error) {
            setAuthError(`Could not verify the email link: ${error.message}. Request a fresh link and open the newest email.`);
            setAuthReady(true);
            return;
          }
          acceptSignedInUser(data.session?.user ?? data.user ?? null);
          return;
        }

        if (queryCode) {
          let exchange = codeExchangePromises.get(queryCode);
          if (!exchange) {
            exchange = supabase.auth.exchangeCodeForSession(queryCode);
            codeExchangePromises.set(queryCode, exchange);
          }
          const { data, error } = await exchange;
          if (!alive) return;
          if (error) {
            // A concurrent auto-detection might have completed the exchange.
            const retrySession = await supabase.auth.getSession();
            if (retrySession.data.session?.user) {
              acceptSignedInUser(retrySession.data.session.user);
              return;
            }
            setAuthError(`Could not complete email sign-in: ${error.message}. Request a fresh link and open it in the same browser.`);
            setAuthReady(true);
            return;
          }
          acceptSignedInUser(data.session?.user ?? data.user ?? null);
          return;
        }

        if (hashAccessToken && hashRefreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: hashAccessToken,
            refresh_token: hashRefreshToken,
          });
          if (!alive) return;
          if (error) {
            setAuthError(`Could not complete email sign-in: ${error.message}. Request a fresh link.`);
            setAuthReady(true);
            return;
          }
          acceptSignedInUser(data.user ?? null);
          return;
        }

        if (initial.error) setAuthError(initial.error.message);
        if (!authEventSeen) setUser(initial.data.session?.user ?? null);
        setAuthReady(true);
      } catch (err) {
        if (!alive) return;
        setAuthError(err instanceof Error
          ? `Unable to complete sign-in: ${err.message}. Request a fresh email link.`
          : 'Unable to complete sign-in. Please request a fresh link.');
        setAuthReady(true);
      }
    }

    void initializeAuth();
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!authCooldownUntil) {
      setAuthCountdown(0);
      return;
    }
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((authCooldownUntil - Date.now()) / 1000));
      setAuthCountdown(remaining);
      if (remaining === 0) setAuthCooldownUntil(0);
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [authCooldownUntil]);

  useEffect(() => {
    let alive = true;
    async function loadProducts() {
      setProductsLoading(true);
      setProductsError('');
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, category, stock, image_url')
        .eq('is_active', true)
        .order('name');
      if (!alive) return;
      if (error) setProductsError(error.message);
      else setProducts((data ?? []) as Product[]);
      setProductsLoading(false);
    }
    void loadProducts();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem('quickcart_cart', JSON.stringify(cart)); } catch { /* storage disabled */ }
  }, [cart]);

  useEffect(() => {
    if (!user) { setRepeatLists([]); return; }
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.from('saved_baskets').select('id, name, frequency, items, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false });
      if (!alive) return;
      if (error) { console.warn('Could not load saved baskets:', error.message); return; }
      setRepeatLists((data || []).map((row: any) => ({ id: String(row.id), name: String(row.name), frequency: row.frequency as 'daily'|'weekly'|'monthly', items: Object.fromEntries((Array.isArray(row.items) ? row.items : []).map((item: any) => [Number(item.product_id), Number(item.quantity)])), updated_at: String(row.updated_at) })));
    })();
    return () => { alive = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!user) { setAutoRepeatSchedules([]); return; }
    let alive = true;
    const loadSchedules = async () => {
      const { data, error } = await supabase.from('quickcart_recurring_orders').select('id, saved_basket_id, is_active, frequency, slot_start, next_delivery_at').eq('user_id', user.id).order('created_at', { ascending: false });
      if (!alive) return;
      if (error) { console.warn('Could not load auto-repeat schedules:', error.message); return; }
      const basketNames = new Map(repeatLists.map((basket) => [basket.id, basket.name]));
      setAutoRepeatSchedules((data || []).map((row: any) => ({ ...row, id: String(row.id), saved_basket_id: String(row.saved_basket_id), basket_name: basketNames.get(String(row.saved_basket_id)) })));
    };
    void loadSchedules();
    return () => { alive = false; };
  }, [user?.id, repeatLists]);

  async function createAutoRepeat(basketId: string) {
    if (!user) { setRepeatMessage('Sign in to set up automatic repeat orders.'); return; }
    if (!autoRepeatAddressId) { setRepeatMessage('Choose a saved delivery address first. If you have none, place one normal order to save your address.'); return; }
    const basket = repeatLists.find((entry) => entry.id === basketId);
    if (!basket) { setRepeatMessage('Could not find that saved basket. Refresh and try again.'); return; }
    setAutoRepeatBusy(true); setRepeatMessage('');
    const { data, error } = await supabase.rpc('quickcart_create_recurring_schedule', { p_saved_basket_id: basketId, p_address_id: Number(autoRepeatAddressId), p_slot_start: autoRepeatSlot });
    if (error) { setAutoRepeatBusy(false); setRepeatMessage(`Could not enable auto-repeat: ${error.message}`); return; }
    const scheduleId = String(data.id);
    const { error: paymentError } = await supabase.from('quickcart_recurring_orders').update({ payment_method: autoRepeatPaymentMethod }).eq('id', scheduleId).eq('user_id', user.id);
    if (paymentError) {
      // Avoid leaving an unintended schedule active if saving the chosen method failed.
      await supabase.from('quickcart_recurring_orders').update({ is_active: false }).eq('id', scheduleId).eq('user_id', user.id);
      setAutoRepeatBusy(false);
      setRepeatMessage(`Schedule was not enabled because the payment method could not be saved: ${paymentError.message}`);
      return;
    }
    setAutoRepeatBusy(false);
    setAutoRepeatConfirmed({ nextDeliveryAt: String(data.next_delivery_at), basketName: basket.name, paymentMethod: autoRepeatPaymentMethod });
    setAutoRepeatSetupStep('confirmation');
    const { data: rows } = await supabase.from('quickcart_recurring_orders').select('id, saved_basket_id, is_active, frequency, slot_start, next_delivery_at').eq('user_id', user.id).order('created_at', { ascending: false });
    setAutoRepeatSchedules((rows || []).map((row: any) => ({ ...row, id: String(row.id), saved_basket_id: String(row.saved_basket_id), basket_name: repeatLists.find((b) => b.id === String(row.saved_basket_id))?.name })));
  }

  async function toggleAutoRepeat(scheduleId: string, active: boolean) {
    const { error } = await supabase.from('quickcart_recurring_orders').update({ is_active: active }).eq('id', scheduleId);
    if (error) { setRepeatMessage(`Could not update auto-repeat: ${error.message}`); return; }
    setAutoRepeatSchedules((current) => current.map((schedule) => schedule.id === scheduleId ? { ...schedule, is_active: active } : schedule));
    setRepeatMessage(active ? 'Auto-repeat resumed.' : 'Auto-repeat paused.');
  }

  // A fake payment approval page is selected with a query parameter rather than a
  // hash route, because Supabase uses URL hashes during some auth redirect flows.
  const query = new URLSearchParams(window.location.search);
  const demoPaymentOrderId = query.get('demo-payment');
  const demoPaymentToken = query.get('demo-token');
  const isPaymentPage = Boolean(demoPaymentOrderId && demoPaymentToken);

  // Customer tracking only ever queries an order belonging to the signed-in customer.
  // Realtime provides quick updates; polling is the fallback for browsers/configurations without it.
  useEffect(() => {
    if (!trackingOrderId || !user) {
      setTrackingOrder(null);
      setTrackingDestination(null);
      setTrackingLoading(false);
      setTrackingError('');
      return;
    }
    let alive = true;
    let inFlight = false;
    let cachedAddressId: string | number | null = null;
    let cachedDestination: TrackingDestination | null = null;
    setTrackingOrder(null);
    setTrackingDestination(null);
    setTrackingRoute([]);
    lastTrackingRouteRequest.current = null;
    const loadTrackedOrder = async () => {
      if (inFlight || !alive) return;
      inFlight = true;
      setTrackingLoading(true);
      const { data, error } = await supabase
        .from('orders')
        .select('id, user_id, address_id, order_number, total_amount, status, payment_method, delivery_status, rider_id, rider_latitude, rider_longitude, rider_location_updated_at, rider_location_accuracy_m, accepted_at, picked_up_at, delivered_at, created_at, delivery_address')
        .eq('id', trackingOrderId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!alive) { inFlight = false; return; }
      if (error) {
        setTrackingError(`Could not load this order: ${error.message}`);
        setTrackingLoading(false);
        inFlight = false;
        return;
      }
      if (!data) {
        setTrackingError('We could not find this order under your signed-in QuickCart account. Please return to the shop and open tracking from your order confirmation.');
        setTrackingOrder(null);
        setTrackingDestination(null);
        setTrackingLoading(false);
        inFlight = false;
        return;
      }
      const row = data as unknown as TrackingOrder;
      setTrackingOrder(row);
      setTrackingError('');
      const nextAddressId = row.address_id;
      if (nextAddressId != null && (cachedAddressId !== nextAddressId || !cachedDestination)) {
        const { data: address, error: addressError } = await supabase
          .from('addresses')
          .select('latitude, longitude, address_line, city')
          .eq('id', nextAddressId)
          .maybeSingle();
        if (!alive) { inFlight = false; return; }
        cachedAddressId = nextAddressId;
        if (!addressError && address && address.latitude != null && address.longitude != null) {
          cachedDestination = {
            latitude: Number(address.latitude),
            longitude: Number(address.longitude),
            address_line: String(address.address_line || ''),
            city: String(address.city || ''),
          };
          setTrackingDestination(cachedDestination);
        } else {
          cachedDestination = null;
          setTrackingDestination(null);
        }
      }
      setTrackingLoading(false);
      inFlight = false;
    };
    void loadTrackedOrder();
    const timer = window.setInterval(() => { void loadTrackedOrder(); }, 10000);
    const channel = supabase
      .channel(`quickcart-customer-tracking-${trackingOrderId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${trackingOrderId}` }, () => { void loadTrackedOrder(); })
      .subscribe();
    return () => {
      alive = false;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [trackingOrderId, user?.id]);

  // Keep a compact floating "Track your order" tab visible on the storefront
  // whenever this customer has an order still in progress.
  useEffect(() => {
    if (!user) {
      setFloatingTrackingOrder(null);
      return;
    }

    let alive = true;
    let inFlight = false;

    const loadActiveOrder = async () => {
      if (inFlight || !alive) return;
      inFlight = true;
      const fields = 'id, order_number, delivery_status, status, order_edit_expires_at, created_at';
      const activeResult = await supabase
        .from('orders')
        .select(fields)
        .eq('user_id', user.id)
        .in('delivery_status', ['awaiting_rider', 'accepted', 'picked_up'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      let data = activeResult.data as FloatingTrackingOrder | null;
      let error = activeResult.error;
      // During the 2-minute edit window, dispatch is deliberately held and
      // delivery_status stays NULL. Still surface the floating tab so the
      // customer can reopen the editor after leaving the confirmation page.
      if (!error && !data) {
        const heldResult = await supabase
          .from('orders')
          .select(fields)
          .eq('user_id', user.id)
          .eq('status', 'confirmed')
          .is('delivery_status', null)
          .gt('order_edit_expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        data = heldResult.data as FloatingTrackingOrder | null;
        error = heldResult.error;
      }

      if (alive) {
        if (error) {
          console.warn('Could not load active order for floating tracker:', error.message);
        } else {
          setFloatingTrackingOrder(data ?? null);
        }
      }
      inFlight = false;
    };

    void loadActiveOrder();
    const timer = window.setInterval(() => { void loadActiveOrder(); }, 10000);
    const channel = supabase
      .channel(`quickcart-floating-tracker-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${user.id}` }, () => {
        void loadActiveOrder();
      })
      .subscribe();

    return () => {
      alive = false;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const trackerCanSeeRider = trackingOrder?.delivery_status === 'picked_up' || trackingOrder?.delivery_status === 'delivered';
  const liveRiderPoint = trackerCanSeeRider && trackingOrder?.rider_latitude != null && trackingOrder.rider_longitude != null
    ? { latitude: Number(trackingOrder.rider_latitude), longitude: Number(trackingOrder.rider_longitude) }
    : null;

  useEffect(() => {
    if (!trackingOrderId || !liveRiderPoint || !trackingDestination) {
      trackingRouteRequestSequence.current += 1;
      setTrackingRoute([]);
      setTrackingRouteInfo(null);
      setTrackingRouteMessage(!trackerCanSeeRider ? 'Live rider location appears after the order is picked up.' : 'Route will appear when rider and delivery coordinates are available.');
      return;
    }
    const now = Date.now();
    const previous = lastTrackingRouteRequest.current;
    const movedEnough = !previous || geoDistanceMeters(liveRiderPoint, { latitude: previous.latitude, longitude: previous.longitude }) >= 100;
    const destinationChanged = !previous || Math.abs(trackingDestination.latitude - previous.destLat) > 0.00001 || Math.abs(trackingDestination.longitude - previous.destLng) > 0.00001;
    if (previous && !movedEnough && !destinationChanged && now - previous.at < 30000) return;
    const requestId = ++trackingRouteRequestSequence.current;
    lastTrackingRouteRequest.current = { at: now, latitude: liveRiderPoint.latitude, longitude: liveRiderPoint.longitude, destLat: trackingDestination.latitude, destLng: trackingDestination.longitude };
    setTrackingRouteMessage('Updating road route…');
    setTrackingRouteInfo(null);
    fetch(`${ROUTING_URL}/route/v1/driving/${liveRiderPoint.longitude},${liveRiderPoint.latitude};${trackingDestination.longitude},${trackingDestination.latitude}?overview=full&geometries=geojson&steps=false`)
      .then((response) => { if (!response.ok) throw new Error(`Routing service returned ${response.status}`); return response.json(); })
      .then((json: { code?: string; routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> }; distance?: number; duration?: number }> }) => {
        const coordinates = json.routes?.[0]?.geometry?.coordinates;
        if (json.code !== 'Ok' || !coordinates?.length) throw new Error('Could not calculate a road route to your address.');
        if (trackingRouteRequestSequence.current === requestId) { setTrackingRoute(coordinates.map(([lng, lat]) => [lat, lng] as LatLng)); setTrackingRouteInfo({ distance: Number(json.routes?.[0]?.distance ?? 0), duration: Number(json.routes?.[0]?.duration ?? 0) }); setTrackingRouteMessage('Live route by OSRM'); }
      })
      .catch((error: unknown) => { if (trackingRouteRequestSequence.current === requestId) setTrackingRouteMessage(error instanceof Error ? error.message : 'Route unavailable.'); });
  }, [trackingOrderId, liveRiderPoint?.latitude, liveRiderPoint?.longitude, trackingDestination?.latitude, trackingDestination?.longitude, trackerCanSeeRider]);

  async function reopenOrderEditor(orderId: string) {
    if (!user) return;
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, order_number, total_amount, subtotal, delivery_fee, status, payment_status, payment_method, delivery_address, created_at, order_edit_expires_at, order_edit_extension_used, scheduled_delivery_at')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (orderError || !order) {
      setNotice(orderError?.message || 'Could not reopen this order.');
      return;
    }
    const expiresAt = (order as any).order_edit_expires_at as string | null;
    if (!expiresAt || new Date(expiresAt).getTime() <= Date.now() || (order as any).status !== 'confirmed') {
      openTracking(orderId);
      return;
    }
    const { data: rows, error: itemsError } = await supabase
      .from('order_items')
      .select('product_id, product_name, quantity, unit_price, line_total')
      .eq('order_id', orderId)
      .order('product_name', { ascending: true });
    if (itemsError) {
      setNotice(`Could not load order items: ${itemsError.message}`);
      return;
    }
    const deliveryAddress = String((order as any).delivery_address || '');
    const parts = deliveryAddress.split(' · ');
    const confirmation: OrderConfirmation = {
      id: String((order as any).id),
      order_number: (order as any).order_number ?? null,
      total_amount: Number((order as any).total_amount ?? 0),
      subtotal: Number((order as any).subtotal ?? 0),
      delivery_fee: Number((order as any).delivery_fee ?? 0),
      status: String((order as any).status || 'confirmed'),
      payment_status: String((order as any).payment_status || 'pending'),
      payment_method: ((order as any).payment_method || 'cod') as PaymentMethod,
      delivery_address: deliveryAddress,
      recipient_name: parts[0] || 'Customer',
      recipient_phone: parts[1] || '',
      address_line: parts.slice(2).join(' · ') || deliveryAddress,
      items: (rows || []).map((item: any) => ({
        product_id: Number(item.product_id), product_name: String(item.product_name),
        quantity: Number(item.quantity), unit_price: Number(item.unit_price), line_total: Number(item.line_total),
      })),
      created_at: String((order as any).created_at),
      edit_expires_at: expiresAt,
      edit_extension_used: Boolean((order as any).order_edit_extension_used),
      scheduled_delivery_at: (order as any).scheduled_delivery_at ? String((order as any).scheduled_delivery_at) : null,
    };
    setOrderEditError('');
    setOrderEditNotice('You can still change or cancel this order until the timer reaches zero.');
    setTrackingOrderId(null);
    setOrderConfirmation(confirmation);
    window.history.replaceState({}, '', window.location.pathname);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openTracking(orderId: string) {
    const next = new URL(window.location.href);
    next.searchParams.delete('demo-payment');
    next.searchParams.delete('demo-token');
    next.searchParams.set('track-order', orderId);
    window.history.pushState({}, '', next.toString());
    setTrackingOrderId(orderId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeTracking() {
    const next = new URL(window.location.href);
    next.searchParams.delete('track-order');
    window.history.pushState({}, '', `${next.pathname}${next.search}${next.hash}`);
    setTrackingOrderId(null);
    setTrackingOrder(null);
    setTrackingDestination(null);
    setTrackingRoute([]);
    lastTrackingRouteRequest.current = null;
  }

  useEffect(() => {
    let alive = true;
    async function loadDemoOrder() {
      if (!isPaymentPage || !user || !demoPaymentOrderId || !demoPaymentToken) return;
      setPaymentError('');
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, total_amount, status, payment_status, payment_reference')
        .eq('id', demoPaymentOrderId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!alive) return;
      if (error) { setPaymentError(error.message); return; }
      if (!data) { setPaymentError('Order not found for this signed-in account. Open the payment link in the same browser/account used to place the order.'); return; }
      const order = data as DemoOrder;
      setActiveOrder(order);
      setPaymentApproved(order.payment_status === 'paid' && order.payment_reference === `DEMO-APPROVED:${demoPaymentToken}`);
      if (order.payment_reference !== `DEMO-PENDING:${demoPaymentToken}` && order.payment_status !== 'paid') {
        setPaymentError('This demo payment link is invalid or no longer active. Return to checkout and create a new test order.');
      }
    }
    void loadDemoOrder();
    return () => { alive = false; };
  }, [isPaymentPage, user, demoPaymentOrderId, demoPaymentToken]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    async function loadAddresses() {
      setAddressesLoading(true);
      // The migration supports the established numeric address ID and supplies these columns.
      const { data, error } = await supabase
        .from('addresses')
        .select('id, user_id, label, recipient_name, phone, address_line, city, latitude, longitude, is_default')
        .order('created_at', { ascending: false });
      if (!alive) return;
      if (error) {
        console.error('Could not load saved addresses:', error.message);
      } else {
        const rows = (data ?? []) as Address[];
        setAddresses(rows);
        if (rows.length) {
          const defaultRow = rows.find((row) => row.is_default) ?? rows[0];
          setSelectedAddressId(String(defaultRow.id));
          setRecipientName(defaultRow.recipient_name || '');
          setRecipientPhone(defaultRow.phone || '');
          setAddressLabel(defaultRow.label || 'Home');
          setAddressLine(defaultRow.address_line || '');
          setCity(defaultRow.city || '');
          if (defaultRow.latitude != null && defaultRow.longitude != null) {
            setPosition({ lat: Number(defaultRow.latitude), lng: Number(defaultRow.longitude) });
          }
        }
      }
      setAddressesLoading(false);
    }
    void loadAddresses();
    return () => { alive = false; };
  }, [user]);

  useEffect(() => {
    if (!orderConfirmation) { setOrderEditSecondsLeft(0); return; }
    let releaseRequested = false;
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((new Date(orderConfirmation.edit_expires_at).getTime() - Date.now()) / 1000));
      setOrderEditSecondsLeft(remaining);
      // Release dispatch exactly when the open confirmation page reaches zero.
      // The database cron job is the fallback if this browser has been closed.
      if (remaining === 0 && !releaseRequested) {
        releaseRequested = true;
        void supabase.rpc('quickcart_release_expired_orders').then(({ error }) => {
          if (error) console.warn('Dispatch release will be handled by the scheduled database job:', error.message);
        });
      }
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [orderConfirmation?.id, orderConfirmation?.edit_expires_at]);

  function formatCountdown(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  async function editConfirmedOrder(productId: number, delta: number) {
    if (!orderConfirmation || orderEditBusy || orderEditSecondsLeft <= 0) return;
    setOrderEditBusy(true); setOrderEditError(''); setOrderEditNotice('');
    try {
      const next = new Map<number, number>();
      orderConfirmation.items.forEach((item) => next.set(item.product_id, item.quantity));
      const product = products.find((item) => item.id === productId);
      const newQuantity = (next.get(productId) ?? 0) + delta;
      if (newQuantity <= 0) next.delete(productId);
      else {
        if (!product) throw new Error('That product is no longer available in the catalogue.');
        if (newQuantity > product.stock) throw new Error(`Only ${product.stock} ${product.name} available right now.`);
        next.set(productId, newQuantity);
      }
      if (next.size === 0) throw new Error('Your order cannot be empty. Use Cancel order to cancel the whole order.');
      const { data, error } = await supabase.rpc('quickcart_edit_order', {
        p_order_id: orderConfirmation.id,
        p_items: Array.from(next.entries()).map(([id, quantity]) => ({ product_id: id, quantity })),
      });
      if (error) throw new Error(error.message);
      const result = data as { items: ConfirmationItem[]; subtotal: number; delivery_fee: number; total_amount: number; edit_expires_at: string; edit_extension_used: boolean };
      setOrderConfirmation((current) => current ? {
        ...current,
        items: result.items,
        subtotal: Number(result.subtotal),
        delivery_fee: Number(result.delivery_fee),
        total_amount: Number(result.total_amount),
        edit_expires_at: result.edit_expires_at,
        edit_extension_used: Boolean(result.edit_extension_used),
      } : current);
      setOrderEditNotice('Your order has been updated. The original 2-minute deadline has not changed.');
    } catch (err) {
      setOrderEditError(err instanceof Error ? err.message : 'Could not update your order.');
    } finally { setOrderEditBusy(false); }
  }

  async function cancelConfirmedOrder() {
    if (!orderConfirmation || orderEditSecondsLeft <= 0 || cancelOrderBusy) return;
    const confirmed = window.confirm('Cancel this entire order? This cannot be undone.');
    if (!confirmed) return;
    setCancelOrderBusy(true); setOrderEditError(''); setOrderEditNotice('');
    try {
      const { error } = await supabase.rpc('quickcart_cancel_order', { p_order_id: orderConfirmation.id });
      if (error) throw new Error(error.message);
      setOrderConfirmation(null);
      setNotice('Your order has been cancelled.');
      setPage('shop');
      window.history.replaceState({}, '', window.location.pathname);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setOrderEditError(err instanceof Error ? err.message : 'Could not cancel your order.');
    } finally { setCancelOrderBusy(false); }
  }

  const categories = useMemo(() => ['All', ...new Set(products.map((p) => p.category || 'General'))], [products]);
  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      const categoryMatch = category === 'All' || (p.category || 'General') === category;
      const searchMatch = !term || p.name.toLowerCase().includes(term) ||
        (p.description || '').toLowerCase().includes(term) || (p.category || '').toLowerCase().includes(term);
      return categoryMatch && searchMatch;
    });
  }, [products, search, category]);
  const cartItems = useMemo(() => products
    .filter((p) => (cart[p.id] ?? 0) > 0)
    .map((product) => ({ product, quantity: cart[product.id] })), [products, cart]);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  const deliveryFee = cartCount === 0 || subtotal >= 499 ? 0 : 30;
  const total = subtotal + deliveryFee;
  const savedAddress = addresses.find((a) => String(a.id) === selectedAddressId);

  async function handlePasswordAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy) return;
    setAuthBusy(true);
    setAuthMessage('');
    setAuthError('');
    const cleanEmail = authEmail.trim().toLowerCase();
    try {
      if (authMode === 'signup') {
        if (!authFullName.trim() || !authPhone.trim()) {
          throw new Error('Enter your full name and phone number to create an account.');
        }
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password: authPassword,
          options: { data: { full_name: authFullName.trim(), phone: authPhone.trim(), role: 'customer' } },
        });
        if (error) throw error;
        if (!data.session) {
          setAuthMessage('Account created. Email confirmation is enabled in Supabase, so disable Confirm email for no-email hackathon testing.');
        } else {
          setAuthMessage('Account created and signed in.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password: authPassword });
        if (error) throw error;
        setAuthMessage('Signed in successfully.');
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) setNotice(error.message);
  }

  function changeQuantity(product: Product, amount: number) {
    setNotice('');
    setCart((current) => {
      const next = { ...current };
      const newQty = (next[product.id] ?? 0) + amount;
      if (newQty <= 0) delete next[product.id];
      else if (newQty <= product.stock) next[product.id] = newQty;
      else setNotice(`Only ${product.stock} ${product.name} available.`);
      return next;
    });
  }

  async function saveRepeatBasket(itemsCart: Cart) {
    if (!user) { setRepeatMessage('Sign in to save a repeat basket.'); return; }
    const items = Object.entries(itemsCart).filter(([, quantity]) => Number(quantity) > 0).map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity: Number(quantity) }));
    if (!items.length) { setRepeatMessage('Add at least one product to this basket first.'); return; }
    const name = repeatListName.trim() || 'My regular groceries';
    const existing = repeatLists.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    const payload = { user_id: user.id, name, frequency: repeatFrequency, items, updated_at: new Date().toISOString() };
    const result = existing
      ? await supabase.from('saved_baskets').update(payload).eq('id', existing.id).select('id').maybeSingle()
      : await supabase.from('saved_baskets').insert(payload).select('id').single();
    if (result.error) { setRepeatMessage(`Could not save basket: ${result.error.message}`); return; }
    const list = { id: String(result.data?.id || existing?.id), name, frequency: repeatFrequency, items: { ...itemsCart }, updated_at: new Date().toISOString() };
    setRepeatLists((current) => [list, ...current.filter((entry) => entry.id !== list.id && entry.name.toLowerCase() !== name.toLowerCase())]);
    setRepeatMessage(`Saved “${name}” to your account.`);
    setRepeatBuilderOpen(false);
  }

  function editRepeatBasket(list: {id:string;name:string;frequency:'daily'|'weekly'|'monthly';items:Cart;updated_at:string}) {
    setRepeatListName(list.name);
    setRepeatFrequency(list.frequency);
    setRepeatDraft({ ...list.items });
    setRepeatProductSearch('');
    setRepeatBuilderOpen(true);
    setRepeatMessage(`Editing “${list.name}”. Changes apply to future automatic orders, except within one hour of the next delivery.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function checkoutRepeatBasket(items: Cart, name: string) {
    const next: Cart = {};
    for (const [id, qty] of Object.entries(items)) {
      const product = products.find((p) => p.id === Number(id));
      if (product && product.stock > 0) next[Number(id)] = Math.min(product.stock, Number(qty));
    }
    if (!Object.keys(next).length) { setRepeatMessage('None of the items in this basket are currently available.'); return; }
    setCart(next);
    setCheckoutError('');
    setRepeatCheckoutName(name);
    setDeliveryTiming('asap');
    setScheduledDeliveryAt('');
    setPage('checkout');
    setCartOpen(false);
    setRepeatMessage(`Checkout opened for “${name}”. Review the basket and delivery details below.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startCheckout() {
    setCartOpen(false);
    setNotice('');
    if (cartCount === 0) return;
    setRepeatCheckoutName(null);
    setPage('checkout');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (!user) setNotice('Sign in with your email link before placing an order.');
  }

  function requestCurrentLocation() {
    if (!navigator.geolocation) { setCheckoutError('Your browser does not support location. Enter the address manually.'); return; }
    setGettingLocation(true); setCheckoutError('');
    navigator.geolocation.getCurrentPosition(
      (result) => {
        const next = { lat: result.coords.latitude, lng: result.coords.longitude };
        setPosition(next); setMapOpen(true); setGettingLocation(false);
        // Best-effort reverse geocoding; the address remains editable if lookup fails.
        fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${next.lat}&lon=${next.lng}`)
          .then((r) => r.ok ? r.json() : Promise.reject(new Error('Reverse geocoding unavailable')))
          .then((json: { display_name?: string }) => {
            if (json.display_name) setAddressLine(json.display_name);
          })
          .catch(() => { /* coordinates still work; user can type address */ });
      },
      (error) => {
        setGettingLocation(false);
        setCheckoutError(error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. You can still pin a spot on the map or enter the address manually.'
          : 'Could not detect your location. Try the map or enter the address manually.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  function chooseSavedAddress(id: string) {
    setSelectedAddressId(id);
    const row = addresses.find((a) => String(a.id) === id);
    if (row) {
      setRecipientName(row.recipient_name || '');
      setRecipientPhone(row.phone || '');
      setAddressLabel(row.label || 'Home');
      setAddressLine(row.address_line || '');
      setCity(row.city || '');
      if (row.latitude != null && row.longitude != null) {
        setPosition({ lat: Number(row.latitude), lng: Number(row.longitude) });
      }
    }
  }

  async function saveNewAddress(): Promise<Address> {
    if (!user) throw new Error('Please sign in before saving a delivery address.');
    const base = {
      user_id: user.id,
      label: addressLabel.trim() || 'Home',
      recipient_name: recipientName.trim(),
      phone: recipientPhone.trim(),
      address_line: addressLine.trim(),
      city: city.trim(),
      latitude: position.lat,
      longitude: position.lng,
      is_default: addresses.length === 0,
    };
    // Match the existing Supabase schema: `address_line` is the stored column.
    // Do not retry with a legacy `address` field; this table has no such column.
    const { data, error } = await supabase
      .from('addresses')
      .insert(base)
      .select('id, user_id, label, recipient_name, phone, address_line, city, latitude, longitude, is_default')
      .single();
    if (error) throw new Error(`Could not save delivery address: ${error.message}`);
    const saved = data as Address;
    setAddresses((current) => [saved, ...current]);
    setSelectedAddressId(String(saved.id));
    return saved;
  }

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCheckoutError(''); setNotice('');
    if (!user) { setCheckoutError('Please request and open your email sign-in link before placing an order.'); return; }
    if (cartItems.length === 0) { setCheckoutError('Your cart is empty. Add products before checking out.'); return; }
    if (!recipientName.trim() || !recipientPhone.trim() || !addressLine.trim() || !city.trim()) {
      setCheckoutError('Add the recipient name, phone number, complete delivery address, and city.'); return;
    }
    if (deliveryTiming === 'scheduled') {
      const selected = new Date(scheduledDeliveryAt);
      const now = new Date();
      const sameDay = selected.getFullYear() === now.getFullYear() && selected.getMonth() === now.getMonth() && selected.getDate() === now.getDate();
      const hour = selected.getHours();
      const minute = selected.getMinutes();
      const endHour = hour + 2;
      if (!scheduledDeliveryAt || Number.isNaN(selected.getTime()) || !sameDay || minute !== 0 || hour < 9 || endHour > 22 || selected.getTime() < Date.now() + 60 * 60 * 1000) {
        setCheckoutError('Choose one of today’s available 2-hour delivery slots, starting at least one hour from now and ending by 10:00 PM.'); return;
      }
    }
    if (cartItems.some(({ product, quantity }) => quantity > product.stock)) {
      setCheckoutError('One or more items no longer have enough stock. Please update your cart.'); return;
    }

    setPlacingOrder(true);
    try {
      let addressId: number | string | null = null;
      if (selectedAddressId !== 'new' && savedAddress) {
        addressId = savedAddress.id;
      } else {
        const saved = await saveNewAddress();
        addressId = saved.id;
      }
      const token = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const deliveryAddress = `${recipientName.trim()} · ${recipientPhone.trim()} · ${addressLine.trim()}, ${city.trim()}`;
      const { data: order, error: orderError } = await supabase.from('orders').insert({
        user_id: user.id,
        address_id: addressId,
        delivery_address: deliveryAddress,
        // Demo checkout deliberately bypasses the real payment gateway.
        // Keep the order payment pending so the database never claims money was collected.
        status: 'confirmed',
        delivery_status: null,
        scheduled_delivery_at: deliveryTiming === 'scheduled' ? new Date(scheduledDeliveryAt).toISOString() : null,
        payment_status: 'pending',
        payment_method: paymentMethod,
        payment_reference: `DEMO-BYPASS:${paymentMethod}:${token}`, 
        subtotal,
        delivery_fee: deliveryFee,
        total_amount: total,
      }).select('id, order_number, total_amount, status, payment_status, payment_reference, order_edit_expires_at, order_edit_extension_used').single();
      if (orderError) throw new Error(`Could not create order: ${orderError.message}`);

      const orderItems = cartItems.map(({ product, quantity }) => ({
        order_id: order.id,
        product_id: product.id,
        product_name: product.name,
        quantity,
        unit_price: Number(product.price),
        line_total: Number(product.price) * quantity,
      }));
      const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
      if (itemsError) {
        await supabase.from('orders').delete().eq('id', order.id).eq('user_id', user.id);
        throw new Error(`Order items could not be saved: ${itemsError.message}`);
      }
      const confirmation: OrderConfirmation = {
        id: String(order.id),
        order_number: order.order_number ?? null,
        total_amount: Number(order.total_amount ?? total),
        subtotal,
        delivery_fee: deliveryFee,
        status: 'confirmed',
        payment_status: 'pending',
        payment_method: paymentMethod,
        delivery_address: deliveryAddress,
        recipient_name: recipientName.trim(),
        recipient_phone: recipientPhone.trim(),
        address_line: `${addressLine.trim()}, ${city.trim()}`,
        items: orderItems,
        created_at: new Date().toISOString(),
        edit_expires_at: order.order_edit_expires_at || new Date(Date.now() + 120_000).toISOString(),
        edit_extension_used: Boolean(order.order_edit_extension_used),
        scheduled_delivery_at: (order as any).scheduled_delivery_at ? String((order as any).scheduled_delivery_at) : null,
      };
      setOrderConfirmation(confirmation);
      setActiveOrder(order as DemoOrder);
      setPaymentApproved(false);
      setCart({});
      localStorage.removeItem('quickcart_cart');
      const target = new URL(window.location.href);
      target.search = '';
      target.hash = '';
      window.history.replaceState({}, '', target.toString());
      setPage('shop');
      setCartOpen(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Could not place the order.');
    } finally { setPlacingOrder(false); }
  }

  async function approveFakePayment() {
    if (!user || !demoPaymentOrderId || !demoPaymentToken) {
      setPaymentError('Sign in with the same QuickCart account that created this demo order.');
      return;
    }
    setPaymentBusy(true); setPaymentError('');
    const { data, error } = await supabase.from('orders').update({
      payment_status: 'paid',
      status: 'confirmed',
      payment_reference: `DEMO-APPROVED:${demoPaymentToken}`,
      updated_at: new Date().toISOString(),
    }).eq('id', demoPaymentOrderId)
      .eq('user_id', user.id)
      .eq('payment_reference', `DEMO-PENDING:${demoPaymentToken}`)
      .select('id, order_number, total_amount, status, payment_status, payment_reference')
      .maybeSingle();
    if (error) setPaymentError(error.message);
    else if (!data) setPaymentError('This demo payment was already approved or the payment link is invalid.');
    else { setActiveOrder(data as DemoOrder); setPaymentApproved(true); }
    setPaymentBusy(false);
  }

  const qrUrl = isPaymentPage && demoPaymentOrderId && demoPaymentToken
    ? `${window.location.origin}${window.location.pathname}?demo-payment=${encodeURIComponent(demoPaymentOrderId)}&demo-token=${encodeURIComponent(demoPaymentToken)}`
    : '';

  if (isPaymentPage) {
    return (
      <main className="qc-app min-h-screen px-4 py-10">
        <section className="mx-auto max-w-xl rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-xl backdrop-blur-xl sm:p-9">
          <a href={`${window.location.pathname}`} className="mb-7 inline-flex items-center gap-2 text-sm font-bold text-emerald-700"><ArrowLeft size={16} /> QuickCart</a>
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-emerald-100 to-sky-100 text-emerald-700"><CreditCard size={29} /></div>
          <p className="mt-5 text-center text-xs font-extrabold tracking-[.18em] text-emerald-700">DEMO PAYMENT GATEWAY</p>
          <h1 className="mt-2 text-center text-3xl font-black tracking-tight">Approve test payment</h1>
          <p className="mx-auto mt-3 max-w-md text-center text-sm leading-6 text-slate-500">This is a simulation for QuickCart development. It does not transfer money or contact a real payment provider.</p>
          {paymentApproved ? (
            <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
              <CheckCircle2 size={38} className="mx-auto text-emerald-600" />
              <h2 className="mt-3 text-xl font-black text-emerald-900">Demo payment approved!</h2>
              <p className="mt-2 text-sm text-emerald-800">Your order status is now confirmed in QuickCart.</p>
              {activeOrder && <p className="mt-3 text-sm font-bold">Order #{activeOrder.order_number ?? activeOrder.id.slice(0, 8)} · {money(Number(activeOrder.total_amount))}</p>}
              <a className="qc-primary-button mt-5 inline-flex" href={window.location.pathname}>Return to QuickCart <ArrowRight size={16} /></a>
            </div>
          ) : (
            <>
              {activeOrder && <div className="mt-7 flex justify-between rounded-2xl bg-slate-50 p-4"><span className="text-sm text-slate-500">Order total</span><strong>{money(Number(activeOrder.total_amount))}</strong></div>}
              {!user && authReady && <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Sign in to the same QuickCart account that created this order before approving the test payment.</p>}
              {paymentError && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{paymentError}</p>}
              {!authReady && <p className="mt-5 text-center text-sm text-slate-500">Checking your session…</p>}
              <div className="mt-7 flex justify-center rounded-2xl border bg-white p-5"><QRCodeSVG value={qrUrl || window.location.href} size={204} level="M" includeMargin /></div>
              <button disabled={!user || !activeOrder || paymentBusy || Boolean(paymentError)} onClick={() => void approveFakePayment()} className="qc-primary-button mt-5 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50">{paymentBusy ? <LoaderCircle className="animate-spin" size={18} /> : <CheckCircle2 size={18} />} Approve test payment</button>
              <p className="mt-3 text-center text-xs text-slate-400">Demo only · No real money is moved · Do not use this as a production payment flow</p>
            </>
          )}
        </section>
      </main>
    );
  }

  if (autoRepeatSetupStep && autoRepeatSetupBasket) {
    const repeatItems = Object.entries(autoRepeatSetupBasket.items)
      .map(([id, quantity]) => ({ product: products.find((p) => p.id === Number(id)), quantity: Number(quantity) }))
      .filter((entry): entry is { product: Product; quantity: number } => Boolean(entry.product) && entry.quantity > 0);
    const repeatSubtotal = repeatItems.reduce((sum, entry) => sum + Number(entry.product.price) * entry.quantity, 0);
    const repeatDeliveryFee = repeatSubtotal >= 499 ? 0 : 30;
    const repeatTotal = repeatSubtotal + repeatDeliveryFee;
    const selectedAddress = addresses.find((a) => String(a.id) === autoRepeatAddressId);
    const paymentLabels: Record<PaymentMethod, string> = { cod: 'Cash on Delivery', card: 'Credit / Debit Card (demo)', upi: 'UPI (demo)' };
    if (autoRepeatSetupStep === 'confirmation' && autoRepeatConfirmed) {
      return <main className="qc-app min-h-screen px-4 py-10"><section className="mx-auto max-w-2xl rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-xl sm:p-9"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><CheckCircle2 size={34}/></div><p className="mt-5 text-center text-xs font-extrabold tracking-[.18em] text-emerald-700">AUTO-REPEAT CONFIRMED</p><h1 className="mt-2 text-center text-3xl font-black tracking-tight">Your recurring delivery is set!</h1><p className="mt-3 text-center text-sm leading-6 text-slate-600">QuickCart will create orders automatically using this basket and schedule. No real payment is taken in demo mode.</p><div className="mt-7 rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><div className="flex items-center gap-2 text-emerald-800"><Clock3 size={18}/><strong>Next scheduled delivery</strong></div><p className="mt-2 text-lg font-black text-slate-900">{new Date(autoRepeatConfirmed.nextDeliveryAt).toLocaleString('en-IN',{weekday:'long',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}</p><p className="mt-1 text-sm text-slate-600">The same delivery slot repeats {autoRepeatSetupBasket.frequency}. You can edit or pause it until one hour before the next delivery.</p></div><section className="mt-5 rounded-2xl border border-slate-100 p-4"><h2 className="font-black">{autoRepeatConfirmed.basketName}</h2><div className="mt-3 space-y-3">{repeatItems.map(({product,quantity})=><div key={product.id} className="flex items-center justify-between gap-3 text-sm"><span>{product.name} × {quantity}</span><strong>{money(Number(product.price)*quantity)}</strong></div>)}</div><div className="mt-4 border-t pt-3 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(repeatSubtotal)}</span></div><div className="mt-1 flex justify-between"><span>Delivery fee</span><span>{repeatDeliveryFee ? money(repeatDeliveryFee) : 'FREE'}</span></div><div className="mt-2 flex justify-between text-base font-black"><span>Estimated total per order</span><span>{money(repeatTotal)}</span></div></div><div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><strong>Delivery address</strong><p className="mt-1 text-slate-600">{selectedAddress ? `${selectedAddress.address_line}, ${selectedAddress.city}` : 'Saved delivery address'}</p><strong className="mt-3 block">Payment method</strong><p className="mt-1 text-slate-600">{paymentLabels[autoRepeatConfirmed.paymentMethod]} · Payment pending in demo mode</p></div></section><button className="qc-checkout-button mt-5 w-full justify-center" onClick={()=>{setAutoRepeatSetupStep(null);setAutoRepeatSetupBasket(null);setAutoRepeatBasketId(null);setRepeatMessage('Automatic delivery is enabled.');window.scrollTo({top:0,behavior:'smooth'});}}>Done <ArrowRight size={17}/></button></section></main>;
    }
    return <main className="qc-app min-h-screen px-4 py-8 sm:py-12"><section className="mx-auto max-w-5xl"><button className="mb-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold" onClick={()=>setAutoRepeatSetupStep(null)}><ArrowLeft size={16}/> Back to baskets</button><div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-xl sm:p-8"><p className="text-xs font-extrabold tracking-[.18em] text-emerald-700">REPEAT BUYING · CHECKOUT</p><h1 className="mt-2 text-3xl font-black tracking-tight">Review your recurring order</h1><p className="mt-2 text-sm text-slate-600">Check the basket and choose the payment method before enabling automatic orders.</p><div className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><section className="rounded-2xl border border-slate-100 p-4 sm:p-5"><h2 className="text-lg font-black">{autoRepeatSetupBasket.name}</h2><p className="mt-1 text-sm text-slate-500">Repeats {autoRepeatSetupBasket.frequency} · {repeatItems.length} products</p><div className="mt-4 space-y-3">{repeatItems.map(({product,quantity})=><div key={product.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><div><strong className="block text-sm">{product.name}</strong><small className="text-slate-500">{money(Number(product.price))} × {quantity}</small></div><strong>{money(Number(product.price)*quantity)}</strong></div>)}</div><div className="mt-4 border-t pt-3 text-sm"><div className="flex justify-between"><span>Subtotal</span><strong>{money(repeatSubtotal)}</strong></div><div className="mt-1 flex justify-between"><span>Delivery fee</span><strong>{repeatDeliveryFee ? money(repeatDeliveryFee) : 'FREE'}</strong></div><div className="mt-2 flex justify-between text-base font-black"><span>Estimated total per order</span><strong>{money(repeatTotal)}</strong></div></div></section><section className="space-y-4"><div className="rounded-2xl border border-slate-100 p-4"><h2 className="font-black">Scheduled delivery</h2><p className="mt-1 text-sm text-slate-600">{autoRepeatSlot} slot · repeats {autoRepeatSetupBasket.frequency}</p><p className="mt-2 text-sm text-slate-600">{selectedAddress ? `${selectedAddress.address_line}, ${selectedAddress.city}` : 'No saved address selected'}</p><p className="mt-2 text-xs text-slate-500">The first delivery date is shown on the confirmation screen.</p></div><div className="rounded-2xl border border-slate-100 p-4"><h2 className="font-black">Payment method</h2><p className="mt-1 text-xs text-slate-500">Demo mode only. No real payment is processed.</p><div className="mt-3 space-y-2">{([{value:'cod',label:'Cash on Delivery',detail:'Pay the rider when each delivery arrives',icon:<Banknote size={19} />},{value:'card',label:'Credit / Debit Card',detail:'Demo only — no card is charged',icon:<CreditCard size={19} />},{value:'upi',label:'UPI',detail:'Demo only — no transfer is started',icon:<Smartphone size={19} />}] as const).map((option)=><button key={option.value} type="button" role="radio" aria-checked={autoRepeatPaymentMethod===option.value} onClick={()=>setAutoRepeatPaymentMethod(option.value)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${autoRepeatPaymentMethod===option.value?'border-emerald-500 bg-emerald-50':'border-slate-200 bg-white'}`}><span>{option.icon}</span><span className="flex-1"><strong className="block text-sm">{option.label}</strong><small className="text-slate-500">{option.detail}</small></span>{autoRepeatPaymentMethod===option.value&&<CheckCircle2 size={18} className="text-emerald-600"/>}</button>)}</div></div>{repeatMessage&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{repeatMessage}</p>}<button disabled={autoRepeatBusy||repeatItems.length===0||!autoRepeatAddressId} onClick={()=>void createAutoRepeat(autoRepeatSetupBasket.id)} className="qc-checkout-button w-full justify-center disabled:opacity-50">{autoRepeatBusy?<><LoaderCircle size={18} className="animate-spin"/> Setting up…</>:<>Confirm auto-repeat <ArrowRight size={17}/></>}</button><p className="text-xs leading-5 text-slate-500">Your recurring plan will create orders automatically. You can pause it or edit the basket at least one hour before the next delivery. Payment remains pending in this demo.</p></section></div></div></section></main>;
  }

  if (trackingOrderId) {
    const status = trackingOrder?.delivery_status;
    const statusCopy: Record<string, { title: string; detail: string; step: number }> = {
      awaiting_rider: { title: 'Finding your rider', detail: 'Your order is confirmed. We are waiting for a rider to accept the delivery.', step: 1 },
      accepted: { title: 'Rider accepted your order', detail: 'Your rider is preparing to collect the order. Live location is shared after pickup.', step: 2 },
      picked_up: { title: 'Your order is on the way', detail: 'Your rider has picked up the order. The map updates as their location is shared.', step: 3 },
      delivered: { title: 'Order delivered', detail: 'Your QuickCart delivery is marked complete.', step: 4 },
    };
    const currentStatus = status ? statusCopy[status] : null;
    const destinationPoint: LatLng | null = trackingDestination ? [trackingDestination.latitude, trackingDestination.longitude] : null;
    const riderPoint: LatLng | null = liveRiderPoint ? [liveRiderPoint.latitude, liveRiderPoint.longitude] : null;
    const mapPoints: LatLng[] = [];
    if (riderPoint) mapPoints.push(riderPoint);
    if (destinationPoint) mapPoints.push(destinationPoint);
    const orderRef = trackingOrder?.order_number ?? trackingOrder?.id.slice(0, 8).toUpperCase() ?? trackingOrderId.slice(0, 8).toUpperCase();
    return (
      <main className="qc-app qc-tracking-page min-h-screen px-4 py-7 sm:py-10">
        <section className="qc-tracking-shell mx-auto">
          <button className="qc-tracking-back" onClick={closeTracking}><ArrowLeft size={17} /> Back</button>
          <div className="qc-tracking-heading"><div><p className="qc-confirmation-eyebrow">QUICKCART LIVE TRACKING</p><h1>Follow your <span>delivery.</span></h1><p>Order #{orderRef} · Updates automatically while your rider is active.</p></div><button className="qc-tracking-refresh" onClick={() => window.location.reload()}><RefreshCw size={16} /> Refresh page</button></div>
          {trackingError && <div className="qc-tracking-alert" role="alert">{trackingError}</div>}
          {!user ? <section className="qc-tracking-card qc-tracking-login"><ShieldCheck size={31} /><h2>Sign in to track this order</h2><p>For privacy, delivery details and rider location are only available to the customer who placed the order. Return to QuickCart and sign in with that account.</p><button className="qc-checkout-button" onClick={closeTracking}>Return to QuickCart</button></section> : trackingLoading && !trackingOrder ? <section className="qc-tracking-card qc-tracking-loading"><LoaderCircle size={26} className="animate-spin" /><p>Loading your order…</p></section> : !trackingOrder ? <section className="qc-tracking-card"><h2>Order unavailable</h2><p>We couldn't load this order. Confirm you're signed into the same QuickCart account that placed it.</p></section> : <>
            <section className="qc-tracking-status-card">
              <div className="qc-tracking-status-icon">{status === 'delivered' ? <CheckCircle2 size={28} /> : status === 'picked_up' ? <Bike size={28} /> : <Package size={28} />}</div>
              <div className="qc-tracking-status-copy"><span className="qc-tracking-live"><i /> {status === 'picked_up' ? 'LIVE UPDATES' : status === 'delivered' ? 'DELIVERY COMPLETE' : 'ORDER STATUS'}</span><h2>{currentStatus?.title || 'Waiting for rider setup'}</h2><p>{currentStatus?.detail || 'The delivery queue is being prepared. Refresh in a moment.'}</p></div>
              <div className="qc-tracking-total"><small>ORDER TOTAL</small><strong>{money(Number(trackingOrder.total_amount))}</strong></div>
            </section>
            <section className="qc-tracking-card qc-tracking-progress">
              <div className={`qc-tracking-step ${status && ['awaiting_rider','accepted','picked_up','delivered'].includes(status) ? 'done' : ''}`}><span>1</span><div><strong>Order confirmed</strong><small>QuickCart received your order</small></div></div>
              <div className={`qc-tracking-step ${status && ['accepted','picked_up','delivered'].includes(status) ? 'done' : ''}`}><span>2</span><div><strong>Rider assigned</strong><small>{trackingOrder.accepted_at ? new Date(trackingOrder.accepted_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : 'Waiting for a rider'}</small></div></div>
              <div className={`qc-tracking-step ${status && ['picked_up','delivered'].includes(status) ? 'done' : ''}`}><span>3</span><div><strong>Picked up</strong><small>{trackingOrder.picked_up_at ? new Date(trackingOrder.picked_up_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : 'Not picked up yet'}</small></div></div>
              <div className={`qc-tracking-step ${status === 'delivered' ? 'done' : ''}`}><span>4</span><div><strong>Delivered</strong><small>{trackingOrder.delivered_at ? new Date(trackingOrder.delivered_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : 'Waiting for drop-off'}</small></div></div>
            </section>
            <section className="qc-tracking-card qc-tracking-map-card">
              <div className="qc-tracking-map-title"><div><span className="qc-tracking-kicker"><LocateFixed size={15} /> MAP VIEW</span><h2>{status === 'delivered' ? 'Delivery destination' : status === 'picked_up' ? 'Rider location' : 'Delivery progress'}</h2></div><span className="qc-tracking-update-time">{trackingOrder.rider_location_updated_at && trackerCanSeeRider ? `Updated ${new Date(trackingOrder.rider_location_updated_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'Waiting for live GPS'}</span></div>
              {mapPoints.length > 0 ? <MapContainer className="qc-tracking-map" center={mapPoints[0]} zoom={14} scrollWheelZoom>
                <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
                {riderPoint && <CircleMarker center={riderPoint} radius={9} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}><Popup>Rider's last shared location</Popup></CircleMarker>}
                {destinationPoint && <CircleMarker center={destinationPoint} radius={9} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#159447', fillOpacity: 1 }}><Popup>Your delivery address</Popup></CircleMarker>}
                {trackingRoute.length > 1 && <Polyline positions={trackingRoute} pathOptions={{ color: '#12975b', weight: 5, opacity: .9 }} />}
                <TrackingMapBounds points={[...mapPoints, ...trackingRoute]} />
              </MapContainer> : <div className="qc-tracking-map-empty"><MapPin size={28} /><strong>Map location not available yet</strong><p>{!trackerCanSeeRider ? 'The rider’s location becomes visible after they mark the order picked up.' : 'This order’s saved delivery address has no GPS coordinates. Add coordinates to the saved address to show the map.'}</p></div>}
              <div className="qc-tracking-route-note"><RouteIcon size={15} /><span>{trackingRouteInfo ? `${(trackingRouteInfo.distance / 1000).toFixed(1)} km · about ${Math.max(1, Math.round(trackingRouteInfo.duration / 60))} min by road. ` : ''}{trackingRouteMessage}</span></div>
              <div className="qc-tracking-address"><MapPin size={17} /><div><strong>Delivery address</strong><p>{trackingDestination ? `${trackingDestination.address_line}, ${trackingDestination.city}` : trackingOrder.delivery_address || 'Address saved on the order'}</p></div></div>
              <div className="qc-osm-attribution">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · Routing by <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a></div>
            </section>
            <p className="qc-tracking-privacy"><ShieldCheck size={15} /> The rider’s precise GPS is shared only with the customer who placed this order, and only after pickup.</p>
          </>}
        </section>
      </main>
    );
  }

  if (orderConfirmation) {
    const methodLabel: Record<PaymentMethod, string> = {
      cod: 'Cash on Delivery',
      card: 'Credit / Debit Card',
      upi: 'UPI',
    };
    const reference = orderConfirmation.order_number ?? orderConfirmation.id.slice(0, 8).toUpperCase();
    return (
      <main className="qc-app qc-confirmation-page min-h-screen px-4 py-8 sm:py-12">
        <section className="qc-confirmation-card mx-auto">
          <div className="qc-confirmation-success-icon"><CheckCircle2 size={38} /></div>
          <p className="qc-confirmation-eyebrow">QUICKCART ORDER CONFIRMATION</p>
          <h1>Order placed successfully!</h1>
          <p className="qc-confirmation-intro">Your order is confirmed for our demo. We’ve saved your items and delivery details.</p>
          <div className="qc-confirmation-order-id"><div><small>ORDER NUMBER</small><strong>#{reference}</strong></div><span className="qc-confirmation-status"><CheckCircle2 size={14} /> Confirmed</span></div>

          <section className="qc-confirmation-section">
            <h2><ShoppingBag size={17} /> Items in your order</h2>
            <div className="qc-confirmation-items">
              {orderConfirmation.items.map((item) => (
                <div className="qc-confirmation-item" key={item.product_id}>
                  <div><strong>{item.product_name}</strong><small>{item.quantity} × {money(Number(item.unit_price))}</small></div>
                  <div className="flex items-center gap-3"><b>{money(Number(item.line_total))}</b><div className="qc-quantity"><button disabled={orderEditSecondsLeft <= 0 || orderEditBusy} onClick={() => editConfirmedOrder(item.product_id, -1)} aria-label={`Remove one ${item.product_name}`}><Minus size={14} /></button><button disabled={orderEditSecondsLeft <= 0 || orderEditBusy} onClick={() => editConfirmedOrder(item.product_id, 1)} aria-label={`Add one ${item.product_name}`}><Plus size={14} /></button></div><button disabled={orderEditSecondsLeft <= 0 || orderEditBusy} onClick={() => editConfirmedOrder(item.product_id, -item.quantity)} className="text-red-600" aria-label={`Remove ${item.product_name} from order`}><Trash2 size={16} /></button></div>
                </div>
              ))}
            </div>
            {orderEditSecondsLeft > 0 && <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm text-emerald-950">Find more items to add</strong><p className="mt-1 text-xs text-emerald-800">Search the catalogue instead of scrolling through everything.</p></div><span className="text-xs text-emerald-800">Changes update this order</span></div><label className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2.5"><Search size={17} className="text-slate-500"/><input className="min-w-0 flex-1 bg-transparent text-sm outline-none" value={orderProductSearch} onChange={(e) => setOrderProductSearch(e.target.value)} placeholder="Search milk, eggs, rice, shampoo…" aria-label="Search products to add to order"/><button type="button" onClick={() => setOrderProductSearch('')} aria-label="Clear product search"><X size={15}/></button></label><div className="grid gap-2 sm:grid-cols-2">{products.filter((product) => product.stock > 0 && (!orderProductSearch.trim() || `${product.name} ${product.description || ''} ${product.category || ''}`.toLowerCase().includes(orderProductSearch.trim().toLowerCase()))).slice(0, 12).map((product) => { const existing = orderConfirmation.items.find((item) => item.product_id === product.id); return <div key={product.id} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3"><div className="min-w-0"><strong className="block truncate text-sm">{product.name}</strong><small className="text-slate-500">{money(Number(product.price))} · {product.category || 'General'}</small></div><button disabled={orderEditBusy || (existing?.quantity ?? 0) >= product.stock} onClick={() => editConfirmedOrder(product.id, 1)} className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Plus size={13} className="mr-1 inline" /> Add</button></div>; })}</div>{products.filter((product) => product.stock > 0 && (!orderProductSearch.trim() || `${product.name} ${product.description || ''} ${product.category || ''}`.toLowerCase().includes(orderProductSearch.trim().toLowerCase()))).length === 0 && <p className="rounded-xl bg-white p-4 text-sm text-slate-600">No products match that search. Try a different name.</p>}</div>}
            <div className="qc-confirmation-totals"><div><span>Subtotal</span><b>{money(orderConfirmation.subtotal)}</b></div><div><span>Delivery fee</span><b>{orderConfirmation.delivery_fee ? money(orderConfirmation.delivery_fee) : 'FREE'}</b></div><div className="qc-confirmation-grand-total"><span>Order total</span><b>{money(orderConfirmation.total_amount)}</b></div></div>
          </section>

          <div className="qc-confirmation-detail-grid">
            <section className="qc-confirmation-detail"><h2><MapPin size={17} /> Delivering to</h2><strong>{orderConfirmation.recipient_name}</strong><p>{orderConfirmation.address_line}</p><small>{orderConfirmation.recipient_phone}</small></section>
            <section className="qc-confirmation-detail"><h2><Wallet size={17} /> Payment method</h2><strong>{methodLabel[orderConfirmation.payment_method]}</strong>{orderConfirmation.payment_method === 'cod' ? <p>Pay cash to your rider when the order arrives.</p> : <p>Payment gateway is bypassed in demo mode. No payment was taken; this order is confirmed for testing only.</p>}<span className="qc-payment-pending">Payment pending · Demo mode</span></section>
          </div>
          <section className={`my-5 rounded-2xl border p-4 ${orderEditSecondsLeft > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="flex items-center gap-2 text-slate-900"><Clock3 size={18} /> Order change window</strong><p className="mt-1 text-sm text-slate-600">{orderEditSecondsLeft > 0 ? 'You can add or remove items, or cancel the whole order, before time runs out.' : 'The change window has closed. Your order can no longer be edited or cancelled here.'}</p></div><div className={`rounded-xl px-4 py-2 text-xl font-black tabular-nums ${orderEditSecondsLeft > 0 ? 'bg-white text-amber-700' : 'bg-slate-200 text-slate-600'}`}>{formatCountdown(orderEditSecondsLeft)}</div></div>
                        {orderEditError && <p className="mt-3 rounded-lg bg-red-100 p-3 text-sm text-red-700">{orderEditError}</p>}
            {orderEditNotice && <p className="mt-3 rounded-lg bg-emerald-100 p-3 text-sm text-emerald-800">{orderEditNotice}</p>}
            <button disabled={orderEditSecondsLeft <= 0 || cancelOrderBusy || orderEditBusy} onClick={cancelConfirmedOrder} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-50">{cancelOrderBusy ? <LoaderCircle size={16} className="animate-spin" /> : <X size={16} />} Cancel entire order</button>
            <p className="mt-2 text-xs text-slate-500">This is a fixed 2-minute window. Editing does not extend the deadline.</p>
          </section>
          <div className="qc-confirmation-delivery-note"><Clock3 size={18} /><div><strong>You’re all set</strong><p>{orderConfirmation.scheduled_delivery_at ? `Scheduled for ${new Date(orderConfirmation.scheduled_delivery_at).toLocaleString()}. Rider dispatch starts at the scheduled time, after the edit window closes.` : 'Your order is saved. Rider dispatch starts after the 2-minute edit window closes.'}</p></div></div>
          <button className="qc-checkout-button qc-track-order-button" onClick={() => openTracking(orderConfirmation.id)}><Navigation size={17} /> Track my delivery <ArrowRight size={16} /></button>
          <button className="qc-checkout-button qc-confirmation-continue" onClick={() => { setOrderConfirmation(null); setPage('shop'); window.history.replaceState({}, '', window.location.pathname); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><ArrowLeft size={17} /> Continue shopping</button>
        </section>
      </main>
    );
  }

  return (
    <div className="qc-app min-h-screen text-slate-900">
      <header className="qc-header sticky top-0 z-30">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-3 sm:px-7 xl:px-10">
          <button onClick={() => { setPage('shop'); window.history.replaceState({}, '', window.location.pathname); }} className="flex shrink-0 items-center gap-2.5 text-left">
            <span className="qc-logo"><ShoppingBag size={22} strokeWidth={2.7} /></span>
            <span className="text-[21px] font-black tracking-tight">Quick<span className="qc-gradient-text">Cart</span></span>
          </button>
          <label className="qc-search mx-auto hidden max-w-[530px] flex-1 items-center gap-3 rounded-full px-4 py-3 md:flex"><Search size={19} className="shrink-0 text-slate-500" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search milk, eggs, snacks, fruits…" aria-label="Search products" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={16} /></button>}</label>
          <div className="qc-location hidden items-center gap-2.5 lg:flex"><MapPin size={22} className="text-emerald-600" /><span className="text-left"><small>Delivering to</small><strong>{savedAddress?.label || 'Your location'}</strong></span></div>
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            {authReady && user ? <button className="qc-user-pill" onClick={() => void signOut()} title="Sign out"><span className="qc-avatar">{(user.email || 'Q').slice(0, 1).toUpperCase()}</span><span className="hidden max-w-32 truncate sm:block">{user.email || user.phone}</span><LogOut size={15} className="hidden sm:block" /></button> : <span className="hidden text-xs text-slate-500 sm:block">{authReady ? 'Guest' : 'Checking session…'}</span>}
            <button className="qc-cart-button" onClick={() => setCartOpen(true)} aria-label="Open cart"><ShoppingBag size={21} /><span>{cartCount}</span></button>
          </div>
        </div>
        <div className="px-4 pb-3 md:hidden"><label className="qc-search flex items-center gap-3 rounded-full px-4 py-3"><Search size={18} className="text-slate-500" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search groceries…" aria-label="Search products" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={16} /></button>}</label></div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 pb-16 pt-5 sm:px-7 xl:px-10">
        {page === 'shop' ? <>
          <section className="qc-hero"><div className="qc-hero-copy"><span className="qc-eyebrow"><span className="qc-live-dot" /> Fresh · Fast · Reliable</span><h1>Everyday essentials,<br />delivered <span>in minutes</span></h1><p>Fresh groceries, household essentials and more from your neighbourhood store.</p><button className="qc-primary-button" onClick={() => document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' })}>Shop now <ArrowRight size={18} /></button><div className="qc-trust-row"><span><ShieldCheck size={16} /> Quality picks</span><span><Clock3 size={16} /> Quick delivery</span></div></div><div className="qc-hero-art" aria-hidden="true"><div className="qc-orb qc-orb-one" /><div className="qc-orb qc-orb-two" /><div className="qc-grocery-bag"><div className="qc-bag-handle" /><span className="qc-art-fruit fruit-one">🍌</span><span className="qc-art-fruit fruit-two">🥦</span><span className="qc-art-fruit fruit-three">🥛</span><span className="qc-art-fruit fruit-four">🍞</span><span className="qc-art-fruit fruit-five">🍅</span><div className="qc-bag-front">QuickCart</div></div><div className="qc-floating-chip chip-delivery"><span><Clock3 size={18} /></span><div><strong>10–30 mins</strong><small>Estimated delivery</small></div></div><div className="qc-floating-chip chip-fresh"><span><ShieldCheck size={18} /></span><div><strong>Fresh products</strong><small>Everyday essentials</small></div></div><div className="qc-leaf leaf-one">✦</div><div className="qc-leaf leaf-two">✦</div></div></section>

          {!authReady ? null : !user && <section className="qc-auth-strip"><div className="qc-auth-icon"><ShieldCheck size={20} /></div><div className="min-w-0 flex-1"><h2>{authMode === 'signin' ? 'Sign in to QuickCart' : 'Create your QuickCart account'}</h2><p>Use your email and password. No magic-link email is needed to sign in.</p>{authMessage && <p className="qc-success"><CheckCircle2 size={15} /> {authMessage}</p>}{authError && <p className="qc-error" role="alert">{authError}</p>}</div><form className="qc-auth-form qc-password-auth-form" onSubmit={(e) => void handlePasswordAuth(e)}>{authMode === 'signup' && <><input type="text" required autoComplete="name" value={authFullName} onChange={(e) => setAuthFullName(e.target.value)} placeholder="Full name" aria-label="Full name" /><input type="tel" required autoComplete="tel" value={authPhone} onChange={(e) => setAuthPhone(e.target.value)} placeholder="Phone number" aria-label="Phone number" /></>}<input type="email" required autoComplete="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="Your email address" aria-label="Your email address" /><input type="password" required minLength={6} autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="Password (at least 6 characters)" aria-label="Password" /><button type="submit" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'signin' ? 'Sign in' : 'Create account'}</button><button type="button" className="qc-auth-mode-toggle" onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setAuthMessage(''); setAuthError(''); }}>{authMode === 'signin' ? 'New to QuickCart? Create account' : 'Already have an account? Sign in'}</button></form></section>}
          {authError && user && <p className="qc-error mt-4" role="alert">{authError}</p>}
          {notice && <div className="qc-notice mt-4" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div>}

          {user && <section className="my-5 rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-extrabold tracking-widest text-emerald-700">REPEAT BUYING</p><h2 className="mt-1 text-xl font-black">Your regular baskets</h2><p className="mt-1 text-sm text-slate-500">Save a custom basket for daily, weekly or monthly shopping, then add it to your cart in one tap.</p></div><div className="flex flex-wrap gap-2"><button className="rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700" onClick={() => { setRepeatDraft({}); setRepeatBuilderOpen((open) => !open); setRepeatMessage(''); }}>{repeatBuilderOpen ? 'Close basket builder' : '＋ Create a basket'}</button><button className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" disabled={cartItems.length === 0} onClick={() => void saveRepeatBasket(cart)}>Save current cart</button></div></div><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px]"><input value={repeatListName} onChange={(e) => setRepeatListName(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="Basket name" aria-label="Repeat basket name"/><select value={repeatFrequency} onChange={(e) => setRepeatFrequency(e.target.value as 'daily'|'weekly'|'monthly')} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" aria-label="Repeat basket frequency"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>{repeatBuilderOpen && <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-sm">Build your repeat basket</strong><p className="mt-1 text-xs text-slate-600">Choose products and quantities independently of your normal cart.</p></div><span className="text-xs font-bold text-emerald-800">{Object.values(repeatDraft).reduce<number>((a,b)=>a+Number(b),0)} items</span></div><label className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5"><Search size={16}/><input className="min-w-0 flex-1 bg-transparent text-sm outline-none" value={repeatProductSearch} onChange={(e)=>setRepeatProductSearch(e.target.value)} placeholder="Search products for this basket…" aria-label="Search repeat basket products"/><button type="button" onClick={()=>setRepeatProductSearch('')} aria-label="Clear repeat basket search"><X size={14}/></button></label><div className="mt-3 grid gap-2 sm:grid-cols-2">{products.filter((product)=>product.stock>0&&(!repeatProductSearch.trim()||`${product.name} ${product.category||''} ${product.description||''}`.toLowerCase().includes(repeatProductSearch.trim().toLowerCase()))).slice(0,repeatProductSearch.trim()?16:4).map((product)=>{const qty=repeatDraft[product.id]||0;return <div key={product.id} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3"><div className="min-w-0"><strong className="block truncate text-sm">{product.name}</strong><small className="text-slate-500">{money(Number(product.price))}</small></div><div className="qc-quantity"><button type="button" disabled={qty<=0} onClick={()=>setRepeatDraft((current)=>{const next={...current};if((next[product.id]||0)<=1)delete next[product.id];else next[product.id]--;return next;})} aria-label={`Remove one ${product.name}`}><Minus size={13}/></button><strong>{qty}</strong><button type="button" disabled={qty>=product.stock} onClick={()=>setRepeatDraft((current)=>({...current,[product.id]:(current[product.id]||0)+1}))} aria-label={`Add one ${product.name}`}><Plus size={13}/></button></div></div>;})}</div>{!repeatProductSearch.trim() && <p className="mt-2 text-xs text-slate-500">Showing a few popular items. Search above to find anything else in the catalogue.</p>}{repeatProductSearch.trim() && products.filter((product)=>product.stock>0&&`${product.name} ${product.category||''} ${product.description||''}`.toLowerCase().includes(repeatProductSearch.trim().toLowerCase())).length===0 && <p className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-600">No matching products. Try another search.</p>}<button type="button" className="mt-3 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" disabled={Object.values(repeatDraft).every((qty)=>Number(qty)<=0)} onClick={()=>void saveRepeatBasket(repeatDraft)}>Save this repeat basket</button></div>}{repeatMessage && <p className="mt-2 text-sm text-emerald-700">{repeatMessage}</p>}{repeatLists.length > 0 && <div className="mt-4 grid gap-3 md:grid-cols-2">{repeatLists.map((list) => { const qty = Object.values(list.items).reduce<number>((a,b) => a + Number(b), 0); const itemNames = Object.entries(list.items).map(([id,q]) => `${products.find((p) => p.id === Number(id))?.name || 'Unavailable item'} × ${q}`).slice(0,3); return <div key={list.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><strong className="block">{list.name}</strong><small className="text-slate-500">{list.frequency[0].toUpperCase()+list.frequency.slice(1)} · {qty} items</small><p className="mt-1 text-xs text-slate-500">{itemNames.join(' · ')}{Object.keys(list.items).length > 3 ? '…' : ''}</p></div><button aria-label={`Delete ${list.name}`} className="rounded-lg p-2 text-red-600" onClick={async () => { const { error } = await supabase.from('saved_baskets').delete().eq('id', list.id); if (error) { setRepeatMessage(`Could not delete basket: ${error.message}`); return; } setRepeatLists((current) => current.filter((entry) => entry.id !== list.id)); }}><Trash2 size={16}/></button></div><div className="mt-3 grid gap-2 sm:grid-cols-3"><button className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={() => editRepeatBasket(list)}>Edit basket</button><button className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm font-bold text-emerald-700" onClick={() => { const next: Cart = { ...cart }; for (const [id,qty] of Object.entries(list.items)) { const product = products.find((p) => p.id === Number(id)); if (product && product.stock > 0) next[Number(id)] = Math.min(product.stock, (next[Number(id)] || 0) + Number(qty)); } setCart(next); setRepeatMessage(`Added “${list.name}” to your cart. Review quantities and stock before checkout.`); window.scrollTo({top:0,behavior:'smooth'}); }}>Add to cart</button><button className="w-full rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white" onClick={() => checkoutRepeatBasket(list.items, list.name)}>Checkout this basket <ArrowRight size={14} className="ml-1 inline"/></button></div>{autoRepeatBasketId===list.id && <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3"><strong className="text-sm">Set up automatic delivery</strong><p className="mt-1 text-xs text-slate-600">QuickCart will create each order automatically. The same delivery slot repeats each time. You can pause it or edit the basket until one hour before the next delivery.</p><label className="mt-3 block text-xs font-bold text-slate-700">Delivery address<select value={autoRepeatAddressId} onChange={(e)=>setAutoRepeatAddressId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">Choose saved address</option>{addresses.map((address)=><option key={String(address.id)} value={String(address.id)}>{address.label} — {address.address_line}, {address.city}</option>)}</select></label><label className="mt-3 block text-xs font-bold text-slate-700">Recurring 2-hour delivery slot<select value={autoRepeatSlot} onChange={(e)=>setAutoRepeatSlot(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">{['09:00','11:00','13:00','15:00','17:00','19:00','20:00'].map((time)=>{const h=Number(time.slice(0,2));const fmt=(hour:number)=>new Date(2000,0,1,hour).toLocaleTimeString('en-IN',{hour:'numeric',hour12:true}).replace(' ','').toLowerCase();return <option key={time} value={time}>{fmt(h)} – {fmt(h+2)}</option>;})}</select></label><div className="mt-3 flex gap-2"><button disabled={autoRepeatBusy} onClick={()=>{setAutoRepeatSetupBasket({id:list.id,name:list.name,frequency:list.frequency,items:{...list.items}});setAutoRepeatPaymentMethod('cod');setAutoRepeatConfirmed(null);setAutoRepeatSetupStep('checkout');setRepeatMessage('');}} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Enable auto-repeat</button><button onClick={()=>setAutoRepeatBasketId(null)} className="rounded-xl border px-3 py-2 text-sm font-bold">Cancel</button></div></div>}{autoRepeatSchedules.filter((schedule)=>schedule.saved_basket_id===list.id).map((schedule)=><div key={schedule.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div><strong className="text-sm">Auto-repeat {schedule.is_active?'ON':'PAUSED'}</strong><p className="text-xs text-slate-600">{schedule.frequency} · {schedule.slot_start.slice(0,5)} · Next: {new Date(schedule.next_delivery_at).toLocaleString('en-IN')}</p><p className="text-xs text-slate-500">Can be edited until 1 hour before the next delivery.</p></div><button onClick={()=>void toggleAutoRepeat(schedule.id,!schedule.is_active)} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800">{schedule.is_active?'Pause':'Resume'}</button></div>)}<button className="mt-3 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm font-bold text-emerald-700" onClick={()=>{setAutoRepeatBasketId(autoRepeatBasketId===list.id?null:list.id);setAutoRepeatAddressId(String(addresses.find((a)=>a.is_default)?.id||addresses[0]?.id||''));}}>Set up auto-repeat</button></div>; })}</div>}</section>}
          <div className="qc-catalog-layout" id="catalogue"><section className="min-w-0"><div className="qc-category-row">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={`qc-category ${category === item ? 'active' : ''}`} aria-pressed={category === item}><span className={`qc-category-icon tint-${item === 'All' ? 'mint' : item === 'Fruits' ? 'rose' : item === 'Vegetables' ? 'orange' : item === 'Dairy' ? 'blue' : item === 'Bakery' ? 'amber' : item === 'Snacks' ? 'yellow' : item === 'Beverages' ? 'violet' : 'slate'}`}>{item === 'All' ? '✦' : EMOJI[item] || '🛒'}</span><span>{item}</span></button>)}</div>
            <div className="qc-section-heading"><div><span className="qc-section-kicker">HANDPICKED FOR YOU</span><h2>Popular products</h2><p>Everyday favourites, just a little closer.</p></div><span className="qc-result-count">{filteredProducts.length} items</span></div>
            {productsLoading && <div className="qc-product-grid">{Array.from({ length: 8 }, (_, i) => <div className="qc-skeleton" key={i}><div /><span /><span /></div>)}</div>}
            {productsError && <div className="qc-empty"><Package size={34} /><strong>Couldn’t load products</strong><p>{productsError}</p></div>}
            {!productsLoading && !productsError && filteredProducts.length === 0 && <div className="qc-empty"><Search size={34} /><strong>No products found</strong><p>Try another search or category.</p><button onClick={() => { setSearch(''); setCategory('All'); }}>Clear filters</button></div>}
            {!productsLoading && !productsError && filteredProducts.length > 0 && <div className="qc-product-grid">{filteredProducts.map((product) => { const qty = cart[product.id] || 0; const cat = product.category || 'General'; return <article key={product.id} className="qc-product-card"><div className="qc-product-photo">{product.image_url ? <img src={product.image_url} alt={product.name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <span className="qc-product-emoji">{EMOJI[cat] || '🛍️'}</span>}<span className="qc-product-tag">{cat}</span>{product.stock <= 0 && <span className="qc-sold-out">Sold out</span>}</div><div className="qc-product-info"><h3 title={product.name}>{product.name}</h3><p className="qc-product-description">{product.description || 'An everyday essential.'}</p><div className="qc-product-bottom"><div><strong>{money(Number(product.price))}</strong><small>{product.stock > 0 ? `${product.stock} in stock` : 'Unavailable'}</small></div>{qty === 0 ? <button className="qc-add-button" onClick={() => changeQuantity(product, 1)} disabled={product.stock <= 0}><Plus size={16} /> Add</button> : <div className="qc-quantity"><button onClick={() => changeQuantity(product, -1)} aria-label={`Remove one ${product.name}`}><Minus size={15} /></button><strong>{qty}</strong><button onClick={() => changeQuantity(product, 1)} disabled={qty >= product.stock} aria-label={`Add one ${product.name}`}><Plus size={15} /></button></div>}</div></div></article>; })}</div>}
          </section></div>
          <footer className="qc-footer"><span className="qc-logo small"><ShoppingBag size={16} /></span><span>QuickCart</span><i /><span>Fresh essentials, delivered with care.</span></footer>
        </> : <section className="qc-checkout-page">
          <div className="qc-checkout-topbar">
            <button className="qc-back-button" onClick={() => setPage('shop')}><ArrowLeft size={16} /> Back to shopping</button>
            <div className="qc-checkout-secure"><ShieldCheck size={15} /> Secure checkout experience</div>
          </div>

          <div className="qc-checkout-heading">
            <div>
              <span className="qc-section-kicker">ONE LAST STEP</span>
              <h1>Checkout<span>.</span></h1>
              <p>Delivery details, order review, and payment — all in one place.</p>
            </div>
            <div className="qc-checkout-stepper" aria-label="Checkout steps">
              <div className="active"><span>1</span><small>Delivery</small></div>
              <i />
              <div className="active"><span>2</span><small>Payment</small></div>
              <i />
              <div><span>3</span><small>Confirmation</small></div>
            </div>
          </div>

          {!user && <div className="qc-checkout-alert"><span className="qc-alert-icon"><Mail size={18} /></span><div><strong>Sign in to place your order</strong><p>Return to the storefront and sign in with your email and password.</p></div><button type="button" onClick={() => setPage('shop')}>Go to sign in <ArrowRight size={15} /></button></div>}

          {repeatCheckoutName && <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><strong className="block text-sm text-emerald-900">Checking out your repeat basket: {repeatCheckoutName}</strong><p className="mt-1 text-sm text-emerald-800">You can schedule this basket for any available delivery slot today, just like a normal order. Choose a slot in the delivery section below.</p><button type="button" className="mt-2 text-sm font-bold text-emerald-800 underline" onClick={() => { setRepeatCheckoutName(null); setRepeatMessage('Repeat basket checkout cancelled. Your basket items remain in your cart.'); setPage('shop'); }}>Back to repeat baskets</button></div>}
          <form className="qc-checkout-grid" onSubmit={(e) => void placeOrder(e)}>
            <div className="qc-checkout-main">
              <section className="qc-form-section qc-delivery-section">
                <div className="qc-form-section-title"><span className="qc-step-icon"><MapPin size={19} /></span><div><h2>Delivery details</h2><p>Who should receive the order, and where?</p></div><span className="qc-section-status">STEP 01</span></div>

                {addressesLoading && <p className="qc-muted qc-loading-line"><LoaderCircle size={15} className="animate-spin" /> Loading your saved addresses…</p>}
                {addresses.length > 0 && <div className="qc-field"><label htmlFor="saved-address">Deliver to a saved address</label><select id="saved-address" value={selectedAddressId} onChange={(e) => { if (e.target.value === 'new') { setSelectedAddressId('new'); setRecipientName(''); setRecipientPhone(''); setAddressLine(''); setCity(''); setAddressLabel('Home'); } else chooseSavedAddress(e.target.value); }}><option value="new">＋ Add a new address</option>{addresses.map((a) => <option key={String(a.id)} value={String(a.id)}>{a.label} — {a.address_line}</option>)}</select></div>}

                <div className="qc-form-row"><div className="qc-field"><label htmlFor="recipient-name">Recipient name <em>*</em></label><input id="recipient-name" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Full name" autoComplete="name" required /></div><div className="qc-field"><label htmlFor="recipient-phone">Contact number <em>*</em></label><input id="recipient-phone" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} placeholder="e.g. +91 98765 43210" autoComplete="tel" type="tel" required /></div></div>

                <div className="qc-form-row"><div className="qc-field"><label htmlFor="address-label">Save address as</label><select id="address-label" value={addressLabel} onChange={(e) => setAddressLabel(e.target.value)}><option>Home</option><option>Work</option><option>Other</option></select></div><div className="qc-field qc-location-field"><label>Location helper</label><button type="button" onClick={requestCurrentLocation} disabled={gettingLocation} className="qc-location-button"><Navigation size={16} />{gettingLocation ? 'Finding your location…' : 'Use my current location'}</button></div></div>

                <div className="qc-field"><label htmlFor="address-line">Complete delivery address <em>*</em></label><textarea id="address-line" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder="Flat / house number, street, area, nearby landmark" rows={3} required /><span className="qc-field-hint">Include an apartment number or landmark so your rider can find you easily.</span></div>
                <div className="qc-field"><label htmlFor="address-city">City <em>*</em></label><input id="address-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Bengaluru" autoComplete="address-level2" required /></div>

                <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4"><div className="mb-3"><strong className="text-sm text-slate-900">When should we deliver?</strong><p className="mt-1 text-xs text-slate-600">Get it as soon as possible or choose a later delivery time.</p></div><div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => setDeliveryTiming('asap')} className={`rounded-xl border p-3 text-left ${deliveryTiming === 'asap' ? 'border-emerald-500 bg-white ring-1 ring-emerald-300' : 'border-slate-200 bg-white'}`}><strong className="block text-sm">As soon as possible</strong><small className="text-slate-500">Dispatch after the 2-minute edit window</small></button><button type="button" onClick={() => setDeliveryTiming('scheduled')} className={`rounded-xl border p-3 text-left ${deliveryTiming === 'scheduled' ? 'border-emerald-500 bg-white ring-1 ring-emerald-300' : 'border-slate-200 bg-white'}`}><strong className="block text-sm">Schedule delivery</strong><small className="text-slate-500">Choose a convenient time</small></button></div>{deliveryTiming === 'scheduled' && <div className="mt-3"><strong className="mb-2 block text-sm font-semibold">Today’s delivery slots</strong><p className="mb-3 text-xs text-slate-500">Same-day only · Slots start no earlier than 9:00 AM and finish by 10:00 PM. Each slot is two hours.</p><div className="grid gap-2 sm:grid-cols-2">{(() => { const now = new Date(); const firstCandidate = new Date(now.getTime()+60*60*1000); const firstHour = Math.max(9, firstCandidate.getHours() + (firstCandidate.getMinutes() > 0 || firstCandidate.getSeconds() > 0 || firstCandidate.getMilliseconds() > 0 ? 1 : 0)); const slots: Array<{start:Date;end:Date;label:string;value:string}> = []; for (let h=firstHour; h+2<=22; h+=2) { const start=new Date(now); start.setHours(h,0,0,0); if (start.getTime() < now.getTime()+60*60*1000) continue; const end=new Date(start); end.setHours(h+2,0,0,0); const fmt=(d:Date)=>d.toLocaleTimeString('en-IN',{hour:'numeric',hour12:true}).replace(' ','').toLowerCase(); slots.push({start,end,label:`${fmt(start)} – ${fmt(end)}`,value:`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}T${String(h).padStart(2,'0')}:00`}); } return slots.map((slot)=><button type="button" key={slot.value} onClick={()=>setScheduledDeliveryAt(slot.value)} className={`rounded-xl border p-3 text-left ${scheduledDeliveryAt===slot.value?'border-emerald-500 bg-white ring-1 ring-emerald-300':'border-slate-200 bg-white'}`}><strong className="block text-sm">{slot.label}</strong><small className="text-slate-500">{scheduledDeliveryAt===slot.value?'Selected delivery slot':'Choose this slot'}</small></button>); })()}</div>{!scheduledDeliveryAt && <p className="mt-2 text-xs text-amber-700">Choose an available slot to continue.</p>}<p className="mt-2 text-xs text-slate-500">Scheduled orders stay out of the rider queue until the selected slot starts.</p></div>}</div>
                <div className="qc-map-action-row"><div><strong>Pin your delivery spot</strong><small>Choose the exact location on OpenStreetMap.</small></div><button type="button" className="qc-secondary-button" onClick={() => setMapOpen((open) => !open)}><MapPin size={16} />{mapOpen ? 'Hide map' : 'Choose on map'}</button></div>
                {mapOpen && <div className="qc-map-wrap"><MapContainer key={`${position.lat.toFixed(5)}-${position.lng.toFixed(5)}`} center={[position.lat, position.lng]} zoom={15} scrollWheelZoom className="qc-leaflet-map"><TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} /><MapClickHandler onPick={setPosition} /><CircleMarker center={[position.lat, position.lng]} radius={10} pathOptions={{ color: '#047857', fillColor: '#10b981', fillOpacity: 0.85 }} /></MapContainer><p><MapPin size={14} /> Selected coordinates: {position.lat.toFixed(5)}, {position.lng.toFixed(5)}. You can edit the address above if reverse lookup is unavailable.</p></div>}
                {checkoutError && <p className="qc-error-box" role="alert">{checkoutError}</p>}
              </section>

              <section className="qc-form-section qc-payment-section">
                <div className="qc-form-section-title"><span className="qc-step-icon"><CreditCard size={19} /></span><div><h2>Payment method</h2><p>Choose the demo payment flow for this test order.</p></div><span className="qc-section-status">STEP 02</span></div>
                <div className="qc-payment-options" role="radiogroup" aria-label="Choose a payment method">
                  <button type="button" role="radio" aria-checked={paymentMethod === 'cod'} onClick={() => setPaymentMethod('cod')} className={`qc-payment-option ${paymentMethod === 'cod' ? 'is-selected' : ''}`}>
                    <span className="qc-payment-option-icon"><Banknote size={21} /></span>
                    <span className="qc-payment-option-copy"><strong>Cash on Delivery</strong><small>Pay the rider when your order arrives.</small></span>
                    <span className="qc-payment-option-check">{paymentMethod === 'cod' && <CheckCircle2 size={20} />}</span>
                  </button>
                  <button type="button" role="radio" aria-checked={paymentMethod === 'card'} onClick={() => setPaymentMethod('card')} className={`qc-payment-option ${paymentMethod === 'card' ? 'is-selected' : ''}`}>
                    <span className="qc-payment-option-icon"><CreditCard size={21} /></span>
                    <span className="qc-payment-option-copy"><strong>Credit / Debit Card</strong><small>Card entry is skipped in demo mode.</small></span>
                    <span className="qc-payment-option-check">{paymentMethod === 'card' && <CheckCircle2 size={20} />}</span>
                  </button>
                  <button type="button" role="radio" aria-checked={paymentMethod === 'upi'} onClick={() => setPaymentMethod('upi')} className={`qc-payment-option ${paymentMethod === 'upi' ? 'is-selected' : ''}`}>
                    <span className="qc-payment-option-icon"><Smartphone size={21} /></span>
                    <span className="qc-payment-option-copy"><strong>UPI</strong><small>UPI app / QR payment is skipped in demo mode.</small></span>
                    <span className="qc-payment-option-check">{paymentMethod === 'upi' && <CheckCircle2 size={20} />}</span>
                  </button>
                </div>
                <div className="qc-payment-note"><ShieldCheck size={16} /><p>Demo checkout is enabled. No card is charged and no UPI transfer is started. Your order is confirmed for testing, and payment remains marked pending.</p></div>
              </section>
            </div>

            <aside className="qc-order-summary qc-checkout-summary">
              <div className="qc-summary-heading"><div><span className="qc-summary-kicker">YOUR ORDER</span><h2>Order summary</h2></div><span className="qc-summary-count">{cartCount} {cartCount === 1 ? 'item' : 'items'}</span></div>
              {cartItems.length === 0 ? <div className="qc-summary-empty"><ShoppingBag size={28} /><strong>Your cart is empty</strong><p>Add products before checking out.</p><button type="button" onClick={() => setPage('shop')}>Browse products</button></div> : <>
                <div className="qc-summary-items">{cartItems.map(({ product, quantity }) => <div key={product.id} className="qc-summary-item"><div className="qc-summary-emoji">{product.image_url ? <img src={product.image_url} alt="" /> : EMOJI[product.category || 'General'] || '🛍️'}<span>{quantity}</span></div><div className="qc-summary-product"><strong>{product.name}</strong><small>{money(Number(product.price))} each</small></div><b>{money(Number(product.price) * quantity)}</b></div>)}</div>
                <div className="qc-summary-edit"><button type="button" onClick={() => setPage('shop')}><ArrowLeft size={14} /> Edit cart</button><span>Prices in INR</span></div>
                <div className="qc-cart-totals"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Delivery fee</span><b>{deliveryFee ? money(deliveryFee) : 'FREE'}</b></div><div className="qc-total"><span>Total to pay</span><b>{money(total)}</b></div></div>
                <div className="qc-free-delivery"><Leaf size={17} /><span>{subtotal >= 499 ? 'You unlocked free delivery!' : `Add ${money(499 - subtotal)} more for free delivery.`}</span></div>
                <button type="submit" disabled={placingOrder || !user || cartItems.length === 0} className="qc-checkout-button qc-place-order">{placingOrder ? <><LoaderCircle size={18} className="animate-spin" /> Placing order…</> : <>Place order <span>{money(total)}</span> <ArrowRight size={17} /></>}</button>
                <p className="qc-checkout-fineprint"><ShieldCheck size={14} /> No payment processed · Order confirmation appears immediately</p>
              </>}
            </aside>
          </form>
        </section>}
      </main>

      {page === 'shop' && user && floatingTrackingOrder && !trackingOrderId && !orderConfirmation && !isPaymentPage && (
        <button
          type="button"
          onClick={() => (floatingTrackingOrder.order_edit_expires_at && new Date(floatingTrackingOrder.order_edit_expires_at).getTime() > Date.now() && floatingTrackingOrder.status === 'confirmed' ? void reopenOrderEditor(floatingTrackingOrder.id) : openTracking(floatingTrackingOrder.id))}
          className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-2xl border border-emerald-200/70 bg-white/95 px-4 py-3 text-left shadow-[0_16px_50px_rgba(6,78,59,0.24)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-[0_20px_55px_rgba(6,78,59,0.30)] sm:bottom-6"
          aria-label={floatingTrackingOrder.order_edit_expires_at && new Date(floatingTrackingOrder.order_edit_expires_at).getTime() > Date.now() && floatingTrackingOrder.status === 'confirmed' ? 'Edit or cancel your order' : 'Track your active order'}
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-600/20">
            <Bike size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-[10px] font-extrabold tracking-[.16em] text-emerald-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              QUICKCART DELIVERY
            </span>
            <span className="mt-0.5 block text-base font-black leading-tight text-slate-900">{floatingTrackingOrder.order_edit_expires_at && new Date(floatingTrackingOrder.order_edit_expires_at).getTime() > Date.now() && floatingTrackingOrder.status === 'confirmed' ? 'Edit or cancel your order' : 'Track your order'}</span>
            <span className="mt-0.5 block truncate text-xs font-medium text-slate-500">
              {floatingTrackingOrder.order_edit_expires_at && new Date(floatingTrackingOrder.order_edit_expires_at).getTime() > Date.now() && floatingTrackingOrder.status === 'confirmed'
                ? `Edit window · ${formatCountdown(Math.max(0, Math.ceil((new Date(floatingTrackingOrder.order_edit_expires_at).getTime() - Date.now()) / 1000)))} left`
                : floatingTrackingOrder.delivery_status === 'picked_up'
                  ? 'Your rider is on the way'
                  : floatingTrackingOrder.delivery_status === 'accepted'
                    ? 'A rider accepted your order'
                    : 'Waiting for a rider to accept'}
              {' · '}#{floatingTrackingOrder.order_number ?? floatingTrackingOrder.id.slice(0, 8).toUpperCase()}
            </span>
          </span>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <ArrowRight size={19} />
          </span>
        </button>
      )}

      {cartOpen && <div className="qc-overlay"><button className="qc-overlay-backdrop" onClick={() => setCartOpen(false)} aria-label="Close cart" /><aside className="qc-drawer"><div className="qc-drawer-heading"><div><h2>Your cart</h2><p>{cartCount} {cartCount === 1 ? 'item' : 'items'}</p></div><button onClick={() => setCartOpen(false)} aria-label="Close cart"><X size={21} /></button></div>{cartItems.length === 0 ? <div className="qc-drawer-empty"><ShoppingBag size={36} /><h3>Your cart is waiting</h3><p>Add your everyday essentials and they'll appear here.</p><button onClick={() => setCartOpen(false)}>Browse products</button></div> : <><div className="qc-drawer-items">{cartItems.map(({ product, quantity }) => <div className="qc-drawer-item" key={product.id}><div className="qc-drawer-photo">{product.image_url ? <img src={product.image_url} alt="" /> : <span>{EMOJI[product.category || 'General'] || '🛍️'}</span>}</div><div className="min-w-0 flex-1"><strong>{product.name}</strong><small>{money(Number(product.price))}</small><div className="qc-quantity drawer-quantity"><button onClick={() => changeQuantity(product, -1)} aria-label="Decrease quantity"><Minus size={14} /></button><b>{quantity}</b><button onClick={() => changeQuantity(product, 1)} disabled={quantity >= product.stock} aria-label="Increase quantity"><Plus size={14} /></button></div></div><div className="qc-drawer-line-total"><b>{money(Number(product.price) * quantity)}</b><button onClick={() => setCart((current) => { const next = { ...current }; delete next[product.id]; return next; })} aria-label={`Remove ${product.name}`}><Trash2 size={16} /></button></div></div>)}</div><div className="qc-drawer-summary"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Delivery fee</span><b>{deliveryFee ? money(deliveryFee) : 'FREE'}</b></div><div className="qc-total"><span>Total</span><b>{money(total)}</b></div><button className="qc-checkout-button" onClick={startCheckout}>Go to checkout <ArrowRight size={17} /></button><p><ShieldCheck size={14} /> Demo checkout · No real payment</p></div></>}</aside></div>}
    </div>
  );
}
  