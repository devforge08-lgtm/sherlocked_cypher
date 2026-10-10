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
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [authCooldownUntil, setAuthCooldownUntil] = useState(0);
  const [authCountdown, setAuthCountdown] = useState(0);

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
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('track-order'));
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

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy || authCountdown > 0) return;
    setAuthBusy(true);
    setAuthMessage('');
    setAuthError('');
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}${trackingOrderId ? `?track-order=${encodeURIComponent(trackingOrderId)}` : ''}`;
      const { error } = await supabase.auth.signInWithOtp({
        email: authEmail.trim(),
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setAuthMessage(`Sign-in link sent to ${authEmail.trim()}. Open the newest email in this browser to finish signing in.`);
      // Avoid accidental repeated requests; Supabase also enforces its own limits.
      setAuthCooldownUntil(Date.now() + 60_000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send the sign-in link.';
      if (/over_email_send_rate_limit|email rate limit|rate limit|too many requests|too many emails/i.test(message)) {
        setAuthError('Supabase has temporarily limited email sending. Wait before requesting another link. The built-in email sender is limited to 2 emails per hour; configure custom SMTP for frequent testing.');
        setAuthCooldownUntil(Date.now() + 60_000);
      } else {
        setAuthError(message);
      }
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

  function startCheckout() {
    setCartOpen(false);
    setNotice('');
    if (cartCount === 0) return;
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
        payment_status: 'pending',
        payment_method: paymentMethod,
        payment_reference: `DEMO-BYPASS:${paymentMethod}:${token}`, 
        subtotal,
        delivery_fee: deliveryFee,
        total_amount: total,
      }).select('id, order_number, total_amount, status, payment_status, payment_reference').single();
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
              {orderConfirmation.items.map((item, index) => (
                <div className="qc-confirmation-item" key={`${item.product_name}-${index}`}>
                  <div><strong>{item.product_name}</strong><small>{item.quantity} × {money(Number(item.unit_price))}</small></div>
                  <b>{money(Number(item.line_total))}</b>
                </div>
              ))}
            </div>
            <div className="qc-confirmation-totals"><div><span>Subtotal</span><b>{money(orderConfirmation.subtotal)}</b></div><div><span>Delivery fee</span><b>{orderConfirmation.delivery_fee ? money(orderConfirmation.delivery_fee) : 'FREE'}</b></div><div className="qc-confirmation-grand-total"><span>Order total</span><b>{money(orderConfirmation.total_amount)}</b></div></div>
          </section>

          <div className="qc-confirmation-detail-grid">
            <section className="qc-confirmation-detail"><h2><MapPin size={17} /> Delivering to</h2><strong>{orderConfirmation.recipient_name}</strong><p>{orderConfirmation.address_line}</p><small>{orderConfirmation.recipient_phone}</small></section>
            <section className="qc-confirmation-detail"><h2><Wallet size={17} /> Payment method</h2><strong>{methodLabel[orderConfirmation.payment_method]}</strong>{orderConfirmation.payment_method === 'cod' ? <p>Pay cash to your rider when the order arrives.</p> : <p>Payment gateway is bypassed in demo mode. No payment was taken; this order is confirmed for testing only.</p>}<span className="qc-payment-pending">Payment pending · Demo mode</span></section>
          </div>
          <div className="qc-confirmation-delivery-note"><Clock3 size={18} /><div><strong>You’re all set</strong><p>Your order is saved in QuickCart. The rider workflow can pick it up once the rider app is connected.</p></div></div>
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

          {!authReady ? null : !user && <section className="qc-auth-strip"><div className="qc-auth-icon"><Mail size={20} /></div><div className="min-w-0 flex-1"><h2>Sign in to QuickCart</h2><p>We’ll email you a secure sign-in link. Open it in this browser to finish logging in.</p>{authMessage && <p className="qc-success"><CheckCircle2 size={15} /> {authMessage}</p>}{authError && <p className="qc-error" role="alert">{authError}</p>}</div><form className="qc-auth-form" onSubmit={(e) => void sendMagicLink(e)}><input type="email" required autoComplete="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="Your email address" aria-label="Your email address" /><button type="submit" disabled={authBusy || authCountdown > 0}>{authBusy ? 'Sending…' : authCountdown > 0 ? `Try again in ${authCountdown}s` : 'Email me a link'}</button></form></section>}
          {authError && user && <p className="qc-error mt-4" role="alert">{authError}</p>}
          {notice && <div className="qc-notice mt-4" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div>}

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

          {!user && <div className="qc-checkout-alert"><span className="qc-alert-icon"><Mail size={18} /></span><div><strong>Sign in to place your order</strong><p>Return to the storefront and open your QuickCart email sign-in link, then come back here.</p></div><button type="button" onClick={() => setPage('shop')}>Go to sign in <ArrowRight size={15} /></button></div>}

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

      {cartOpen && <div className="qc-overlay"><button className="qc-overlay-backdrop" onClick={() => setCartOpen(false)} aria-label="Close cart" /><aside className="qc-drawer"><div className="qc-drawer-heading"><div><h2>Your cart</h2><p>{cartCount} {cartCount === 1 ? 'item' : 'items'}</p></div><button onClick={() => setCartOpen(false)} aria-label="Close cart"><X size={21} /></button></div>{cartItems.length === 0 ? <div className="qc-drawer-empty"><ShoppingBag size={36} /><h3>Your cart is waiting</h3><p>Add your everyday essentials and they'll appear here.</p><button onClick={() => setCartOpen(false)}>Browse products</button></div> : <><div className="qc-drawer-items">{cartItems.map(({ product, quantity }) => <div className="qc-drawer-item" key={product.id}><div className="qc-drawer-photo">{product.image_url ? <img src={product.image_url} alt="" /> : <span>{EMOJI[product.category || 'General'] || '🛍️'}</span>}</div><div className="min-w-0 flex-1"><strong>{product.name}</strong><small>{money(Number(product.price))}</small><div className="qc-quantity drawer-quantity"><button onClick={() => changeQuantity(product, -1)} aria-label="Decrease quantity"><Minus size={14} /></button><b>{quantity}</b><button onClick={() => changeQuantity(product, 1)} disabled={quantity >= product.stock} aria-label="Increase quantity"><Plus size={14} /></button></div></div><div className="qc-drawer-line-total"><b>{money(Number(product.price) * quantity)}</b><button onClick={() => setCart((current) => { const next = { ...current }; delete next[product.id]; return next; })} aria-label={`Remove ${product.name}`}><Trash2 size={16} /></button></div></div>)}</div><div className="qc-drawer-summary"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Delivery fee</span><b>{deliveryFee ? money(deliveryFee) : 'FREE'}</b></div><div className="qc-total"><span>Total</span><b>{money(total)}</b></div><button className="qc-checkout-button" onClick={startCheckout}>Go to checkout <ArrowRight size={17} /></button><p><ShieldCheck size={14} /> Demo checkout · No real payment</p></div></>}</aside></div>}
    </div>
  );
}
