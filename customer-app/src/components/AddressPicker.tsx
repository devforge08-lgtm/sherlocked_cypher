import { useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import { MapPin, Search, X, Navigation, Save, AlertTriangle, LoaderCircle } from "lucide-react";
import "leaflet/dist/leaflet.css";

const defaultCenter: [number, number] = [12.9352, 77.6245];

export type DeliveryAddress = {
  id?: string;
  label: string;
  formattedAddress: string;
  placeId: string | null;
  latitude: number;
  longitude: number;
};

type Props = {
  currentAddress: DeliveryAddress | null;
  onClose: () => void;
  onSave: (address: DeliveryAddress) => void;
};

const pinIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function MapMover({ center }: { center: [number, number] }) {
  const map = useMap();
  map.setView(center);
  return null;
}

function MapClickHandler({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) { onMove(event.latlng.lat, event.latlng.lng); },
  });
  return null;
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lon),
    zoom: "18",
    addressdetails: "1",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`);
  if (!response.ok) throw new Error("Address lookup is temporarily unavailable.");
  const data = await response.json();
  return data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

async function searchAddress(query: string): Promise<{ label: string; lat: number; lon: number }[]> {
  const params = new URLSearchParams({
    format: "jsonv2",
    q: query,
    limit: "5",
    addressdetails: "1",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
  if (!response.ok) throw new Error("Address search is temporarily unavailable. Please try again.");
  const data = await response.json();
  return data.map((item: { display_name: string; lat: string; lon: string }) => ({
    label: item.display_name,
    lat: Number(item.lat),
    lon: Number(item.lon),
  }));
}

export default function AddressPicker({ currentAddress, onClose, onSave }: Props) {
  const [address, setAddress] = useState<DeliveryAddress>(() => currentAddress || {
    label: "Home",
    formattedAddress: "",
    placeId: null,
    latitude: defaultCenter[0],
    longitude: defaultCenter[1],
  });
  const [label, setLabel] = useState(currentAddress?.label || "Home");
  const [mapCenter, setMapCenter] = useState<[number, number]>([
    currentAddress?.latitude ?? defaultCenter[0],
    currentAddress?.longitude ?? defaultCenter[1],
  ]);
  const [query, setQuery] = useState(currentAddress?.formattedAddress || "");
  const [results, setResults] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingReverse, setLoadingReverse] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;
    setLoadingSearch(true);
    setError("");
    try {
      const matches = await searchAddress(query.trim());
      setResults(matches);
      if (!matches.length) setError("No matching addresses found. Try a nearby landmark or street name.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed. Try again.");
    } finally {
      setLoadingSearch(false);
    }
  }

  function selectResult(result: { label: string; lat: number; lon: number }) {
    setMapCenter([result.lat, result.lon]);
    setAddress((prev) => ({
      ...prev,
      formattedAddress: result.label,
      placeId: null,
      latitude: result.lat,
      longitude: result.lon,
    }));
    setQuery(result.label);
    setResults([]);
    setError("");
  }

  async function movePin(lat: number, lon: number) {
    setMapCenter([lat, lon]);
    setAddress((prev) => ({ ...prev, latitude: lat, longitude: lon }));
    setLoadingReverse(true);
    setError("");
    try {
      const formattedAddress = await reverseGeocode(lat, lon);
      setAddress((prev) => ({ ...prev, latitude: lat, longitude: lon, formattedAddress }));
      setQuery(formattedAddress);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not look up this pin.");
    } finally {
      setLoadingReverse(false);
    }
  }

  function handleSave() {
    if (!address.formattedAddress.trim()) {
      setError("Search for an address or click the map to select a location.");
      return;
    }
    onSave({ ...address, label: label.trim() || "Delivery address" });
  }

  return (
    <div className="qc-overlay">
      <button className="qc-overlay-backdrop" onClick={onClose} aria-label="Close address picker" />
      <section className="qc-address-modal" role="dialog" aria-modal="true" aria-labelledby="qc-address-title">
        <header className="qc-address-header">
          <div><span className="qc-address-kicker"><MapPin size={13} /> DELIVERY LOCATION</span><h2 id="qc-address-title">Where should we deliver?</h2><p>Search an address or click the map to move your delivery pin.</p></div>
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>

        <form className="qc-address-search" onSubmit={handleSearch}>
          <Search size={18} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search area, street or building..." aria-label="Search address" />
          <button type="submit" disabled={loadingSearch} aria-label="Search">
            {loadingSearch ? <LoaderCircle size={17} className="qc-spin" /> : <Search size={17} />}
          </button>
        </form>

        {results.length > 0 && (
          <div className="qc-address-results">
            {results.map((result, index) => (
              <button type="button" key={`${result.lat}-${result.lon}-${index}`} onClick={() => selectResult(result)}>
                <MapPin size={16} /><span>{result.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="qc-map-frame">
          <MapContainer center={mapCenter} zoom={address.formattedAddress ? 16 : 12} scrollWheelZoom className="qc-leaflet-map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
            />
            <MapMover center={mapCenter} />
            <Marker
              position={mapCenter}
              icon={pinIcon}
              draggable
              eventHandlers={{
                dragend: (event) => {
                  const point = event.target.getLatLng();
                  void movePin(point.lat, point.lng);
                },
              }}
            />
            <MapClickHandler onMove={(lat, lng) => void movePin(lat, lng)} />
          </MapContainer>
        </div>

        <div className="qc-pin-coordinates"><Navigation size={14} /><span>Pin: {address.latitude.toFixed(5)}, {address.longitude.toFixed(5)}</span>{loadingReverse && <span className="qc-reverse-status">Finding address…</span>}</div>
        <label className="qc-address-label">Save this address as
          <div className="qc-address-label-options">
            {["Home", "Work", "Other"].map((item) => <button type="button" key={item} className={label === item ? "selected" : ""} onClick={() => setLabel(item)}>{item}</button>)}
          </div>
        </label>
        {address.formattedAddress && <div className="qc-selected-address"><MapPin size={17} /><span>{address.formattedAddress}</span></div>}
        {error && <p className="qc-address-error"><AlertTriangle size={14} /> {error}</p>}
        <footer className="qc-address-footer"><button className="qc-address-cancel" onClick={onClose}>Cancel</button><button className="qc-address-save" onClick={handleSave}><Save size={16} /> Save address</button></footer>
        <p className="qc-map-attribution-note">Map data © OpenStreetMap contributors. Search is provided by Nominatim.</p>
      </section>
    </div>
  );
}
