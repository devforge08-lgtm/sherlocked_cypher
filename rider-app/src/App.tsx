import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle, ArrowRight, ArrowDownRight, Banknote, Bike, Check, CheckCircle2,
  Clock3, CreditCard, LoaderCircle, LocateFixed, LogOut, Mail, MapPin, Package,
  PackageCheck, RefreshCw, Route as RouteIcon, ShieldCheck, Smartphone, Truck, WalletCards,
} from 'lucide-react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

type RiderProfile = {
  user_id: string;
  full_name: string;
  phone: string | null;
  vehicle_type: string | null;
  is_active: boolean;
};
type DeliveryStatus = 'awaiting_rider' | 'accepted' | 'picked_up' | 'delivered';
type OrderItem = {
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};
type Coordinates = { latitude: number | null; longitude: number | null; address_line?: string | null; city?: string | null };
type GpsPoint = { latitude: number; longitude: number; accuracy: number; heading: number | null; speed: number | null; capturedAt: number };
type RoutePoint = [number, number];
type RiderOrder = {
  id: string;
  address_id: string | number | null;
  order_number: number | string | null;
  created_at: string;
  delivery_address: string | null;
  total_amount: number;
  subtotal: number | null;
  delivery_fee: number | null;
  payment_method: string | null;
  payment_status: string | null;
  delivery_status: DeliveryStatus | null;
  rider_id: string | null;
  accepted_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  rider_latitude: number | null;
  rider_longitude: number | null;
  rider_location_updated_at: string | null;
  rider_location_accuracy_m: number | null;
  addresses: Coordinates | null;
  order_items: OrderItem[] | null;
};
type View = 'available' | 'active' | 'completed';
type Action = 'accept' | 'picked_up' | 'delivered';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2,
});
const money = (value: number | string | null | undefined) => currency.format(Number(value ?? 0));
const orderLabel = (order: RiderOrder) => String(order.order_number ?? order.id.slice(0, 8)).toUpperCase();

function formatDate(value: string | null | undefined) {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function paymentLabel(method: string | null) {
  switch ((method || '').toLowerCase()) {
    case 'cod': return 'Cash on delivery';
    case 'upi': return 'UPI · demo bypass';
    case 'card': return 'Card · demo bypass';
    default: return method || 'Payment not specified';
  }
}

function PaymentIcon({ method }: { method: string | null }) {
  const icon = (method || '').toLowerCase() === 'cod'
    ? <Banknote size={16} />
    : (method || '').toLowerCase() === 'upi'
      ? <Smartphone size={16} />
      : <CreditCard size={16} />;
  return <span className="payment-icon">{icon}</span>;
}

function deliveryBadge(status: DeliveryStatus | null) {
  if (status === 'accepted') return { label: 'Accepted', className: 'badge-purple' };
  if (status === 'picked_up') return { label: 'Picked up', className: 'badge-blue' };
  if (status === 'delivered') return { label: 'Delivered', className: 'badge-green' };
  return { label: 'Needs a rider', className: 'badge-amber' };
}

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const ROUTING_URL = import.meta.env.VITE_OSRM_URL || 'https://router.project-osrm.org';
const pickupLatRaw = import.meta.env.VITE_PICKUP_LAT;
const pickupLngRaw = import.meta.env.VITE_PICKUP_LNG;
const pickupPoint = pickupLatRaw && pickupLngRaw && Number.isFinite(Number(pickupLatRaw)) && Number.isFinite(Number(pickupLngRaw))
  ? { latitude: Number(pickupLatRaw), longitude: Number(pickupLngRaw) }
  : null;

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function MapFitBounds({ points }: { points: RoutePoint[] }) {
  const map = useMap();
  const signature = points.map((point) => point.join(',')).join('|');
  useEffect(() => {
    if (points.length > 1) {
      const latitudes = points.map((point) => point[0]);
      const longitudes = points.map((point) => point[1]);
      const southWest: RoutePoint = [Math.min(...latitudes), Math.min(...longitudes)];
      const northEast: RoutePoint = [Math.max(...latitudes), Math.max(...longitudes)];
      map.fitBounds([southWest, northEast] as [RoutePoint, RoutePoint], { padding: [28, 28], maxZoom: 15 });
    } else if (points.length === 1) map.setView(points[0], 15);
  // The signature ensures the map only refits when positions change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature]);
  return null;
}

function RiderRouteMap({ order, gps }: { order: RiderOrder; gps: GpsPoint | null }) {
  const [route, setRoute] = useState<RoutePoint[]>([]);
  const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number } | null>(null);
  const [routeError, setRouteError] = useState('');
  const lastRequest = useRef<{ at: number; lat: number; lng: number; targetLat: number; targetLng: number } | null>(null);
  const routeRequestSequence = useRef(0);
  const routeComponentMounted = useRef(true);
  useEffect(() => { routeComponentMounted.current = true; return () => { routeComponentMounted.current = false; routeRequestSequence.current += 1; lastRequest.current = null; }; }, []);
  const usePickup = order.delivery_status === 'accepted';
  const target = usePickup ? pickupPoint : (order.addresses?.latitude != null && order.addresses.longitude != null
    ? { latitude: Number(order.addresses.latitude), longitude: Number(order.addresses.longitude) }
    : null);
  const origin = gps ? { latitude: gps.latitude, longitude: gps.longitude } : null;
  const targetLabel = usePickup ? 'Store pickup' : 'Customer drop-off';

  useEffect(() => {
    if (!origin || !target) {
      routeRequestSequence.current += 1;
      setRoute([]);
      setRouteInfo(null);
      setRouteError(usePickup && !pickupPoint ? 'Set VITE_PICKUP_LAT and VITE_PICKUP_LNG in .env to show the store route before pickup.' : 'Waiting for GPS and destination coordinates.');
      return;
    }
    const now = Date.now();
    const previous = lastRequest.current;
    const movedEnough = !previous || distanceMeters(origin, { latitude: previous.lat, longitude: previous.lng }) >= 100;
    const targetChanged = !previous || Math.abs(target.latitude - previous.targetLat) > 0.00001 || Math.abs(target.longitude - previous.targetLng) > 0.00001;
    if (previous && !movedEnough && !targetChanged && now - previous.at < 30000) return;
    const requestId = ++routeRequestSequence.current;
    const requestOrigin = { ...origin };
    const requestTarget = { ...target };
    lastRequest.current = { at: now, lat: requestOrigin.latitude, lng: requestOrigin.longitude, targetLat: requestTarget.latitude, targetLng: requestTarget.longitude };
    setRouteError('');
    setRouteInfo(null);
    const url = `${ROUTING_URL}/route/v1/driving/${requestOrigin.longitude},${requestOrigin.latitude};${requestTarget.longitude},${requestTarget.latitude}?overview=full&geometries=geojson&steps=false`;
    fetch(url)
      .then((response) => { if (!response.ok) throw new Error(`Routing service returned ${response.status}`); return response.json(); })
      .then((json: { code?: string; routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> }; distance?: number; duration?: number }> }) => {
        const coordinates = json.routes?.[0]?.geometry?.coordinates;
        if (json.code !== 'Ok' || !coordinates?.length) throw new Error('No road route was found for these coordinates.');
        if (routeComponentMounted.current && routeRequestSequence.current === requestId) { setRoute(coordinates.map(([lng, lat]) => [lat, lng] as RoutePoint)); setRouteInfo({ distance: Number(json.routes?.[0]?.distance ?? 0), duration: Number(json.routes?.[0]?.duration ?? 0) }); setRouteError(''); }
      })
      .catch((error: unknown) => { if (routeComponentMounted.current && routeRequestSequence.current === requestId) setRouteError(error instanceof Error ? error.message : 'Could not load the road route.'); });
  }, [gps?.latitude, gps?.longitude, order.delivery_status, order.addresses?.latitude, order.addresses?.longitude]);

  const mapPoints: RoutePoint[] = [];
  if (origin) mapPoints.push([origin.latitude, origin.longitude]);
  if (target) mapPoints.push([target.latitude, target.longitude]);
  const distanceLabel = routeInfo ? `${(routeInfo.distance / 1000).toFixed(1)} km · ${Math.max(1, Math.round(routeInfo.duration / 60))} min by road` : route.length && origin && target ? 'Road route calculated by OSRM' : 'Route will appear when GPS and destination are available';

  return (
    <div className="rider-route-panel">
      <div className="rider-route-heading"><div><span className="route-kicker"><RouteIcon size={14} /> LIVE NAVIGATION</span><strong>{targetLabel}</strong><small>{distanceLabel}</small></div>
        {origin && target && <a className="route-open-link" href={`https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${origin.latitude}%2C${origin.longitude}%3B${target.latitude}%2C${target.longitude}`} target="_blank" rel="noreferrer">Open directions <ArrowRight size={13} /></a>}
      </div>
      {usePickup && !pickupPoint ? <div className="route-message">Add your store pickup latitude/longitude to the Rider App `.env` before using the pickup route.</div> : null}
      {!target && !usePickup ? <div className="route-message">This saved address has no map coordinates. Ask the customer to set a pinned address or update the address coordinates in Supabase.</div> : null}
      {!gps && <div className="route-message">Allow location access in your browser. GPS works on localhost and HTTPS sites.</div>}
      {mapPoints.length > 0 && <MapContainer className="rider-route-map" center={mapPoints[0]} zoom={14} scrollWheelZoom={false}>
        <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
        {origin && <CircleMarker center={[origin.latitude, origin.longitude]} radius={8} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}><Popup>Current rider location</Popup></CircleMarker>}
        {target && <CircleMarker center={[target.latitude, target.longitude]} radius={8} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#15803d', fillOpacity: 1 }}><Popup>{targetLabel}</Popup></CircleMarker>}
        {route.length > 1 && <Polyline positions={route} pathOptions={{ color: '#16834a', weight: 5, opacity: 0.9 }} />}
        <MapFitBounds points={[...mapPoints, ...route]} />
      </MapContainer>}
      {routeError && <div className="route-footnote">{routeError}</div>}
      <div className="osm-credit">Map © OpenStreetMap contributors · Routing by OSRM</div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupVehicle, setSignupVehicle] = useState('Bike');
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileVehicle, setProfileVehicle] = useState('Bike');
  const [profileSaveBusy, setProfileSaveBusy] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [rider, setRider] = useState<RiderProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [orders, setOrders] = useState<RiderOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [view, setView] = useState<View>('available');
  const [search, setSearch] = useState('');
  const [gpsPoint, setGpsPoint] = useState<GpsPoint | null>(null);
  const [gpsError, setGpsError] = useState('');
  const activeOrdersRef = useRef<RiderOrder[]>([]);
  const lastLocationWrite = useRef<Record<string, { at: number; latitude: number; longitude: number }>>({});

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setUser(data.session?.user ?? null);
        setAuthReady(true);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUser(session?.user ?? null);
        setAuthReady(true);
        setAuthMessage('');
        setAuthError('');
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadRiderProfile = useCallback(async () => {
    if (!user) {
      setRider(null);
      setProfileError('');
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    setProfileError('');
    const { data, error } = await supabase
      .from('riders')
      .select('user_id, full_name, phone, vehicle_type, is_active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      setProfileError(error.message);
      setRider(null);
    } else {
      const found = (data as RiderProfile | null) ?? null;
      setRider(found);
      if (found) {
        setProfileName(found.full_name || '');
        setProfilePhone(found.phone || '');
        setProfileVehicle(found.vehicle_type || 'Bike');
      } else {
        setProfileName(String(user.user_metadata?.full_name ?? ''));
        setProfilePhone(String(user.user_metadata?.phone ?? ''));
        setProfileVehicle(String(user.user_metadata?.vehicle_type ?? 'Bike'));
      }
    }
    setProfileLoading(false);
  }, [user]);

  useEffect(() => {
    void loadRiderProfile();
  }, [loadRiderProfile]);

  const loadOrders = useCallback(async (quiet = false) => {
    if (!user || !rider?.is_active) return;
    if (quiet) setRefreshing(true);
    else setOrdersLoading(true);
    setOrdersError('');
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, created_at, address_id, delivery_address, total_amount, subtotal, delivery_fee, payment_method, payment_status, delivery_status, rider_id, accepted_at, picked_up_at, delivered_at, rider_latitude, rider_longitude, rider_location_updated_at, rider_location_accuracy_m, addresses(latitude, longitude, address_line, city), order_items(product_name, quantity, unit_price, line_total)')
      .or(`delivery_status.eq.awaiting_rider,rider_id.eq.${user.id}`)
      .order('created_at', { ascending: false });
    if (error) {
      setOrdersError(error.message);
    } else {
      setOrders((data ?? []) as unknown as RiderOrder[]);
    }
    setOrdersLoading(false);
    setRefreshing(false);
  }, [user, rider]);

  useEffect(() => {
    if (!user || !rider?.is_active) {
      setOrders([]);
      return;
    }
    let alive = true;
    let inFlight = false;
    const load = async (quiet = false) => {
      if (inFlight || !alive) return;
      inFlight = true;
      if (!quiet) setOrdersLoading(true);
      setOrdersError('');
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, created_at, address_id, delivery_address, total_amount, subtotal, delivery_fee, payment_method, payment_status, delivery_status, rider_id, accepted_at, picked_up_at, delivered_at, rider_latitude, rider_longitude, rider_location_updated_at, rider_location_accuracy_m, addresses(latitude, longitude, address_line, city), order_items(product_name, quantity, unit_price, line_total)')
        .or(`delivery_status.eq.awaiting_rider,rider_id.eq.${user.id}`)
        .order('created_at', { ascending: false });
      if (alive) {
        if (error) setOrdersError(error.message);
        else setOrders((data ?? []) as unknown as RiderOrder[]);
        setOrdersLoading(false);
        setRefreshing(false);
      }
      inFlight = false;
    };
    void load();
    const timer = window.setInterval(() => { void load(true); }, 10000);
    const channel = supabase
      .channel(`rider-orders-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { void load(true); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => { void load(true); })
      .subscribe();
    return () => {
      alive = false;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [user, rider]);

  const availableOrders = useMemo(
    () => orders.filter((order) => order.delivery_status === 'awaiting_rider' && !order.rider_id),
    [orders],
  );
  const activeOrders = useMemo(
    () => orders.filter((order) => order.rider_id === user?.id && (order.delivery_status === 'accepted' || order.delivery_status === 'picked_up')),
    [orders, user],
  );
  const completedOrders = useMemo(
    () => orders.filter((order) => order.rider_id === user?.id && order.delivery_status === 'delivered'),
    [orders, user],
  );

  useEffect(() => { activeOrdersRef.current = activeOrders; }, [activeOrders]);

  // Browser GPS runs only while this rider has an accepted/in-progress job.
  // Coordinates are published to the customer only after pickup, and we stop
  // publishing when the job is delivered or the rider has no active jobs.
  useEffect(() => {
    if (!user || !rider?.is_active || activeOrders.length === 0) {
      setGpsPoint(null);
      setGpsError('');
      return;
    }
    if (!navigator.geolocation) {
      setGpsError('This browser does not support geolocation.');
      return;
    }
    setGpsError('');
    const watchId = navigator.geolocation.watchPosition((position) => {
      const point: GpsPoint = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
        capturedAt: position.timestamp || Date.now(),
      };
      setGpsPoint((previous) => {
        if (!previous) return point;
        const moved = distanceMeters(point, previous);
        return moved >= 5 || Date.now() - previous.capturedAt >= 5000 ? point : previous;
      });
      const pickedUpOrders = activeOrdersRef.current.filter((order) => order.delivery_status === 'picked_up' && order.rider_id === user.id);
      for (const order of pickedUpOrders) {
        const previous = lastLocationWrite.current[order.id];
        const moved = !previous || distanceMeters(point, previous) >= 15;
        const timeElapsed = !previous || Date.now() - previous.at >= 15000;
        if (!moved && !timeElapsed) continue;
        // Mark before await to avoid overlapping RPC calls from fast GPS callbacks.
        lastLocationWrite.current[order.id] = { at: Date.now(), latitude: point.latitude, longitude: point.longitude };
        void supabase.rpc('rider_update_location', {
          p_order_id: order.id,
          p_latitude: point.latitude,
          p_longitude: point.longitude,
          p_accuracy_m: point.accuracy,
          p_heading: point.heading,
          p_speed_mps: point.speed,
        }).then(({ error }) => {
          if (error) {
            setGpsError(`GPS is working locally but could not share live location: ${error.message}`);
            delete lastLocationWrite.current[order.id];
          } else setGpsError('');
        });
      }
    }, (error) => {
      setGpsError(error.code === error.PERMISSION_DENIED
        ? 'Location permission denied. Allow location access to show your route and share live tracking after pickup.'
        : 'Could not get GPS. Check device location and try again.');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [user?.id, rider?.is_active, activeOrders.length]);

  // Flush the most recent GPS fix when an order transitions to picked_up. The
  // 15-second/movement guard prevents writes from every browser geolocation tick.
  useEffect(() => {
    if (!gpsPoint || !user || !rider?.is_active) return;
    for (const order of activeOrders) {
      if (order.delivery_status !== 'picked_up' || order.rider_id !== user.id) continue;
      const previous = lastLocationWrite.current[order.id];
      const moved = !previous || distanceMeters(gpsPoint, previous) >= 15;
      const timeElapsed = !previous || Date.now() - previous.at >= 15000;
      if (!moved && !timeElapsed) continue;
      lastLocationWrite.current[order.id] = { at: Date.now(), latitude: gpsPoint.latitude, longitude: gpsPoint.longitude };
      void supabase.rpc('rider_update_location', {
        p_order_id: order.id,
        p_latitude: gpsPoint.latitude,
        p_longitude: gpsPoint.longitude,
        p_accuracy_m: gpsPoint.accuracy,
        p_heading: gpsPoint.heading,
        p_speed_mps: gpsPoint.speed,
      }).then(({ error }) => {
        if (error) {
          setGpsError(`GPS is working locally but could not share live location: ${error.message}`);
          delete lastLocationWrite.current[order.id];
        } else setGpsError('');
      });
    }
  }, [gpsPoint, activeOrders, user?.id, rider?.is_active]);

  const visibleOrders = useMemo(() => {
    const source = view === 'available' ? availableOrders : view === 'active' ? activeOrders : completedOrders;
    const term = search.trim().toLowerCase();
    if (!term) return source;
    return source.filter((order) =>
      orderLabel(order).toLowerCase().includes(term) ||
      (order.delivery_address || '').toLowerCase().includes(term) ||
      (order.order_items || []).some((item) => item.product_name.toLowerCase().includes(term)),
    );
  }, [view, availableOrders, activeOrders, completedOrders, search]);

  async function handlePasswordAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    setAuthMessage('');
    const cleanEmail = email.trim().toLowerCase();
    try {
      if (authMode === 'signup') {
        if (!signupName.trim() || !signupPhone.trim()) {
          throw new Error('Enter your full name and phone number to create a rider account.');
        }
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              app_role: 'rider',
              full_name: signupName.trim(),
              phone: signupPhone.trim(),
              vehicle_type: signupVehicle,
            },
          },
        });
        if (error) throw error;
        setAuthMessage(data.session
          ? 'Rider account created. Setting up your profile…'
          : 'Account created, but Supabase did not start a session. If Confirm email is enabled, turn it off for hackathon testing or confirm the email first.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
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
    if (error) setNotice({ type: 'error', message: error.message });
    else {
      setRider(null);
      setOrders([]);
      setView('available');
      setNotice(null);
    }
  }

  async function performAction(order: RiderOrder, action: Action) {
    setBusyOrderId(order.id);
    setNotice(null);
    let error: { message: string } | null = null;
    if (action === 'accept') {
      const result = await supabase.rpc('rider_claim_order', { p_order_id: order.id });
      error = result.error;
    } else {
      const result = await supabase.rpc('rider_update_delivery_status', {
        p_order_id: order.id,
        p_next_status: action,
      });
      error = result.error;
    }
    if (error) {
      setNotice({ type: 'error', message: error.message });
    } else {
      const message = action === 'accept'
        ? `Order #${orderLabel(order)} is yours. Head to the pickup point.`
        : action === 'picked_up'
          ? `Order #${orderLabel(order)} marked as picked up.`
          : `Order #${orderLabel(order)} marked delivered. Great work!`;
      setNotice({ type: 'success', message });
      setView(action === 'delivered' ? 'completed' : action === 'accept' || action === 'picked_up' ? 'active' : 'available');
      await loadOrders(true);
    }
    setBusyOrderId(null);
  }

  async function completeRiderProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setProfileSaveBusy(true);
    setProfileError('');
    setNotice(null);
    try {
      const { error } = await supabase.rpc('register_rider_profile', {
        p_full_name: profileName.trim(),
        p_phone: profilePhone.trim(),
        p_vehicle_type: profileVehicle,
      });
      if (error) throw error;
      await loadRiderProfile();
      setNotice({ type: 'success', message: 'Rider profile saved. Welcome to QuickCart!' });
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Could not save rider profile.');
    } finally {
      setProfileSaveBusy(false);
    }
  }


  if (!authReady || (user && profileLoading)) {
    return <div className="loading-screen"><div className="loading-logo"><Bike size={26} /></div><LoaderCircle className="spinner" size={24} /><span>Getting QuickCart Rider ready…</span></div>;
  }

  if (!user) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="brand-lockup"><span className="brand-icon"><Bike size={23} /></span><span>quickcart<span className="brand-light"> rider</span></span></div>
          <div className="login-hero">
            <div className="eyebrow"><span className="live-dot" /> RIDER PARTNER PORTAL</div>
            <h1>Your next delivery<br /><em>starts here.</em></h1>
            <p>Accept nearby orders, keep deliveries moving, and finish every drop with confidence.</p>
            <div className="login-stats"><div><strong>01</strong><span>Accept</span></div><ArrowRight size={16} /><div><strong>02</strong><span>Pick up</span></div><ArrowRight size={16} /><div><strong>03</strong><span>Deliver</span></div></div>
          </div>
          <form className="login-form" onSubmit={handlePasswordAuth}>
            <div><span className="form-kicker">{authMode === 'signin' ? 'WELCOME BACK' : 'JOIN QUICKCART'}</span><h2>{authMode === 'signin' ? 'Sign in to your rider account' : 'Create your rider account'}</h2><p>{authMode === 'signin' ? 'Use your email and password to manage deliveries.' : 'Add your details once. Your rider profile will be created automatically.'}</p></div>
            {authMode === 'signup' && <>
              <label htmlFor="rider-full-name">Full name</label>
              <div className="input-wrap"><input id="rider-full-name" type="text" value={signupName} onChange={(event) => setSignupName(event.target.value)} placeholder="Your full name" autoComplete="name" required /></div>
              <label htmlFor="rider-phone">Phone number</label>
              <div className="input-wrap"><input id="rider-phone" type="tel" value={signupPhone} onChange={(event) => setSignupPhone(event.target.value)} placeholder="9876543210" autoComplete="tel" required /></div>
              <label htmlFor="rider-vehicle">Vehicle type</label>
              <div className="input-wrap"><select id="rider-vehicle" value={signupVehicle} onChange={(event) => setSignupVehicle(event.target.value)}><option>Bike</option><option>Scooter</option><option>Bicycle</option><option>Car</option></select></div>
            </>}
            <label htmlFor="rider-email">Email address</label>
            <div className="input-wrap"><Mail size={17} /><input id="rider-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="rider@example.com" autoComplete="email" required /></div>
            <label htmlFor="rider-password">Password</label>
            <div className="input-wrap"><input id="rider-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} minLength={6} required /></div>
            {authError && <div className="inline-alert alert-error"><AlertCircle size={17} /><span>{authError}</span></div>}
            {authMessage && <div className="inline-alert alert-success"><CheckCircle2 size={17} /><span>{authMessage}</span></div>}
            <button className="primary-button full-button" type="submit" disabled={authBusy}>{authBusy ? <LoaderCircle className="spinner" size={18} /> : <ShieldCheck size={18} />} {authBusy ? 'Please wait…' : authMode === 'signin' ? 'Sign in' : 'Create account'} <ArrowRight size={17} /></button>
            <button className="subtle-button" type="button" onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setAuthError(''); setAuthMessage(''); }}>{authMode === 'signin' ? 'New rider? Create account' : 'Already registered? Sign in'}</button>
            <div className="secure-note"><ShieldCheck size={15} /> {authMode === 'signup' ? 'Your rider profile is created when you register.' : 'Your account is protected by Supabase authentication.'}</div>
          </form>
          <p className="login-foot">QUICKCART · LAST-MILE DELIVERY</p>
        </section>
        <aside className="login-art"><div className="art-glow art-glow-one" /><div className="art-glow art-glow-two" /><div className="art-topline"><span>QUICKCART LOGISTICS</span><span>RIDER NETWORK / 01</span></div><div className="art-map"><div className="map-grid" /><svg viewBox="0 0 560 650" role="img" aria-label="Illustrated delivery route"><path d="M43 511 C84 470 127 490 169 421 S225 331 282 354 S372 279 355 221 S411 142 508 116" className="route-shadow" /><path d="M43 511 C84 470 127 490 169 421 S225 331 282 354 S372 279 355 221 S411 142 508 116" className="route-line" /><circle cx="43" cy="511" r="9" className="route-start" /><circle cx="508" cy="116" r="12" className="route-end" /><circle cx="508" cy="116" r="4" className="route-end-core" /><g className="map-pin" transform="translate(280 352)"><rect x="-31" y="-31" width="62" height="62" rx="20" /><path d="M-10 4h20M-8 -5h17l5 9h-27zM-4 -11h10v6h-10z" /></g></svg><div className="art-route-tag tag-pickup"><span /> PICKUP · STORE #01</div><div className="art-route-tag tag-drop"><MapPin size={14} /> CUSTOMER DROP</div><div className="art-order-card"><div className="order-card-mark"><PackageCheck size={20} /></div><div><span>NEW DELIVERY</span><strong>Ready to roll</strong><small>Fresh orders, live updates</small></div><div className="card-arrow"><ArrowDownRight size={19} /></div></div><div className="art-caption"><span>01 / DAILY OPERATIONS</span><span>FAST. FRESH. RELIABLE.</span></div></div></aside>
      </main>
    );
  }

  if (!rider || !rider.is_active) {
    const missingRider = !rider;
    return (
      <main className="access-shell">
        <div className="access-card">
          <div className="brand-lockup"><span className="brand-icon"><Bike size={23} /></span><span>quickcart<span className="brand-light"> rider</span></span></div>
          <div className="access-icon"><ShieldCheck size={30} /></div>
          <span className="form-kicker">RIDER PROFILE</span>
          <h1>{missingRider ? 'Finish setting up your rider profile.' : 'Your rider account is paused.'}</h1>
          <p>{missingRider ? 'Add your details below to create your rider profile. You do not need to copy SQL or ask an admin for this step.' : 'Your rider profile exists but is marked inactive. Contact the QuickCart team to restore access.'}</p>
          <form className="login-form profile-completion-form" onSubmit={completeRiderProfile}>
            <label htmlFor="profile-full-name">Full name</label>
            <div className="input-wrap"><input id="profile-full-name" value={profileName} onChange={(event) => setProfileName(event.target.value)} autoComplete="name" required /></div>
            <label htmlFor="profile-phone">Phone number</label>
            <div className="input-wrap"><input id="profile-phone" type="tel" value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} autoComplete="tel" required /></div>
            <label htmlFor="profile-vehicle">Vehicle type</label>
            <div className="input-wrap"><select id="profile-vehicle" value={profileVehicle} onChange={(event) => setProfileVehicle(event.target.value)}><option>Bike</option><option>Scooter</option><option>Bicycle</option><option>Car</option></select></div>
            {profileError && <div className="inline-alert alert-error"><AlertCircle size={17} /><span>{profileError}</span></div>}
            {notice && <div className={`inline-alert ${notice.type === 'error' ? 'alert-error' : 'alert-success'}`}>{notice.type === 'error' ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{notice.message}</span></div>}
            <button className="primary-button full-button" type="submit" disabled={profileSaveBusy || !missingRider}>{profileSaveBusy ? <LoaderCircle className="spinner" size={17} /> : <CheckCircle2 size={17} />}{profileSaveBusy ? 'Saving profile…' : 'Save profile and continue'}</button>
          </form>
          <button className="signout-button" onClick={() => void signOut()}><LogOut size={16} /> Sign out</button>
          <p className="tiny-help">{missingRider ? 'If saving fails, run the self-registration SQL migration in Supabase and try again.' : 'This rider profile is inactive. An admin must reactivate it.'}</p>
        </div>
      </main>
    );
  }

  const counts = { available: availableOrders.length, active: activeOrders.length, completed: completedOrders.length };

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <a className="brand-lockup dashboard-brand" href="#top"><span className="brand-icon"><Bike size={22} /></span><span>quickcart<span className="brand-light"> rider</span></span></a>
        <div className="topbar-right"><div className="online-pill"><span className="live-dot" /> ONLINE</div><div className="topbar-divider" /><div className="rider-mini"><div className="avatar">{rider.full_name?.slice(0, 1).toUpperCase() || 'R'}</div><div><strong>{rider.full_name}</strong><span>{rider.vehicle_type || 'Delivery partner'}</span></div></div><button className="icon-button logout-icon" onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button></div>
      </header>
      <main className="dashboard-main" id="top">
        <section className="welcome-row"><div><div className="eyebrow dark-eyebrow"><span className="live-dot" /> RIDER DASHBOARD</div><h1>Hey {rider.full_name.split(' ')[0] || 'there'}, <em>let's move.</em></h1><p>Here’s what’s happening with your deliveries today.</p></div><button className="refresh-button" onClick={() => void loadOrders(true)} disabled={refreshing}>{refreshing ? <LoaderCircle className="spinner" size={17} /> : <RefreshCw size={17} />} Refresh</button></section>
        {activeOrders.length > 0 && <div className={`gps-status ${gpsPoint ? 'gps-on' : 'gps-waiting'}`}><LocateFixed size={17} /><span>{gpsError || (gpsPoint ? `GPS active · ±${Math.round(gpsPoint.accuracy)} m accuracy${activeOrders.some((order) => order.delivery_status === 'picked_up') ? ' · sharing with customer' : ' · customer tracking starts after pickup'}` : 'Waiting for GPS permission and current location…')}</span></div>}
        <section className="stats-grid">
          <div className="stat-card stat-highlight"><div className="stat-top"><span>AVAILABLE ORDERS</span><span className="stat-icon"><Package size={20} /></span></div><strong>{counts.available.toString().padStart(2, '0')}</strong><p>Waiting for a rider</p><div className="stat-bottom"><span className="stat-dot dot-amber" /> Live order queue</div></div>
          <div className="stat-card"><div className="stat-top"><span>MY DELIVERIES</span><span className="stat-icon stat-icon-purple"><Truck size={20} /></span></div><strong>{counts.active.toString().padStart(2, '0')}</strong><p>Accepted & in progress</p><div className="stat-bottom"><span className="stat-dot dot-purple" /> Keep things moving</div></div>
          <div className="stat-card"><div className="stat-top"><span>COMPLETED</span><span className="stat-icon stat-icon-green"><CheckCircle2 size={20} /></span></div><strong>{counts.completed.toString().padStart(2, '0')}</strong><p>Successfully delivered</p><div className="stat-bottom"><span className="stat-dot dot-green" /> Nice work today</div></div>
        </section>
        {notice && <div className={`toast-banner ${notice.type === 'error' ? 'toast-error' : 'toast-success'}`}><span>{notice.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}</span><p>{notice.message}</p><button aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div>}
        <section className="orders-section">
          <div className="orders-heading"><div><span className="form-kicker">DELIVERY MANAGEMENT</span><h2>Orders <span className="heading-count">{view === 'available' ? counts.available : view === 'active' ? counts.active : counts.completed}</span></h2></div><div className="orders-tools"><div className="search-wrap"><Package size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order or address" aria-label="Search orders" /></div></div></div>
          <div className="order-tabs" role="tablist" aria-label="Order filters">
            <button className={view === 'available' ? 'tab-active' : ''} onClick={() => setView('available')} role="tab" aria-selected={view === 'available'}><Package size={16} /> Available <span>{counts.available}</span></button>
            <button className={view === 'active' ? 'tab-active' : ''} onClick={() => setView('active')} role="tab" aria-selected={view === 'active'}><Truck size={16} /> My deliveries <span>{counts.active}</span></button>
            <button className={view === 'completed' ? 'tab-active' : ''} onClick={() => setView('completed')} role="tab" aria-selected={view === 'completed'}><CheckCircle2 size={16} /> Completed <span>{counts.completed}</span></button>
          </div>
          {ordersError && <div className="inline-alert alert-error orders-error"><AlertCircle size={18} /><div><strong>Could not load orders</strong><span>{ordersError}</span><small>Make sure the rider SQL setup was run successfully in your shared Supabase project.</small></div><button className="subtle-button" onClick={() => void loadOrders(true)}>Retry</button></div>}
          {ordersLoading && orders.length === 0 ? <div className="empty-state"><LoaderCircle className="spinner" size={27} /><h3>Checking for orders…</h3><p>Fetching the latest QuickCart deliveries.</p></div> : visibleOrders.length === 0 ? <div className="empty-state"><div className="empty-illustration">{view === 'available' ? <Bike size={32} /> : view === 'active' ? <Truck size={32} /> : <PackageCheck size={32} />}</div><h3>{view === 'available' ? 'You’re all caught up' : view === 'active' ? 'No deliveries in progress' : 'No completed deliveries yet'}</h3><p>{view === 'available' ? 'New customer orders will appear here automatically. Keep this page open.' : view === 'active' ? 'Accept an available order to start your next delivery.' : 'Orders you deliver will appear here.'}</p><button className="secondary-button" onClick={() => void loadOrders(true)}><RefreshCw size={16} /> Check for new orders</button></div> : <div className="orders-grid">{visibleOrders.map((order) => {
            const badge = deliveryBadge(order.delivery_status);
            const itemCount = (order.order_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
            const currentAction: Action | null = order.delivery_status === 'awaiting_rider' ? 'accept' : order.delivery_status === 'accepted' && order.rider_id === user.id ? 'picked_up' : order.delivery_status === 'picked_up' && order.rider_id === user.id ? 'delivered' : null;
            const actionLabel = currentAction === 'accept' ? 'Accept delivery' : currentAction === 'picked_up' ? 'Mark picked up' : currentAction === 'delivered' ? 'Mark delivered' : '';
            const ActionIcon = currentAction === 'accept' ? ArrowRight : currentAction === 'picked_up' ? PackageCheck : CheckCircle2;
            return <article className="order-card" key={order.id}>
              <div className="order-card-header"><div className="order-id-wrap"><div className="order-symbol"><PackageCheck size={19} /></div><div><span className="order-overline">ORDER #{orderLabel(order)}</span><div className="order-time"><Clock3 size={13} /> {formatDate(order.created_at)}</div></div></div><span className={`status-badge ${badge.className}`}><span />{badge.label}</span></div>
              <div className="order-address"><div className="address-icon"><MapPin size={18} /></div><div><span>DELIVER TO</span><p>{order.delivery_address || 'Delivery address not provided'}</p></div></div>
              <div className="order-item-list">{(order.order_items || []).slice(0, 3).map((item, index) => <div className="order-item" key={`${order.id}-${index}`}><span className="item-qty">{item.quantity}×</span><span className="item-name">{item.product_name}</span><span className="item-price">{money(item.line_total ?? item.unit_price * item.quantity)}</span></div>)}{(order.order_items || []).length > 3 && <div className="extra-items">+ {(order.order_items || []).length - 3} more item types</div>}{(order.order_items || []).length === 0 && <p className="items-unavailable">Item details aren’t available yet. Refresh in a few seconds.</p>}</div>
              <div className="order-meta-row"><div className="meta-piece"><Package size={15} /><span>{itemCount} item{itemCount === 1 ? '' : 's'}</span></div><div className="meta-piece"><PaymentIcon method={order.payment_method} /><span>{paymentLabel(order.payment_method)}</span></div></div>
              <div className="payment-note"><WalletCards size={14} /><span>{order.payment_status === 'paid' ? 'Payment recorded as paid' : order.payment_method === 'cod' ? 'Collect cash at delivery' : 'Demo checkout: payment not collected online'}</span></div>
              {view === 'active' && order.id === activeOrders[0]?.id && order.rider_id === user.id && order.delivery_status !== 'delivered' && <RiderRouteMap order={order} gps={gpsPoint} />}
              <div className="order-card-footer"><div><span>ORDER TOTAL</span><strong>{money(order.total_amount)}</strong></div>{currentAction ? <button className={`primary-button order-action ${currentAction === 'delivered' ? 'action-complete' : ''}`} disabled={busyOrderId === order.id} onClick={() => void performAction(order, currentAction)}>{busyOrderId === order.id ? <LoaderCircle className="spinner" size={17} /> : <ActionIcon size={17} />}{busyOrderId === order.id ? 'Updating…' : actionLabel}</button> : <span className="status-finished"><Check size={16} /> Completed</span>}</div>
            </article>;
          })}</div>}
          <div className="auto-refresh-note"><span className="live-dot" /> Updates automatically about every 10 seconds <span>·</span> <button onClick={() => void loadOrders(true)}>Refresh now</button></div>
        </section>
        <footer className="dashboard-footer"><div className="brand-mini"><Bike size={16} /> QUICKCART RIDER</div><span>Delivering fresh, one order at a time.</span><button onClick={() => void signOut()}><LogOut size={15} /> Sign out</button></footer>
      </main>
    </div>
  );
}
