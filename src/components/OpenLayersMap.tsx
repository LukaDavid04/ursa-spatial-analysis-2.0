import { useEffect, useRef, useState } from "react";
import { Map as OlMap, View } from "ol";
import "ol/ol.css";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import { Icon, Style } from "ol/style";
import { fromLonLat, toLonLat, transformExtent } from "ol/proj";
import { easeOut } from "ol/easing";
import pinIcon from "../assets/icons/pinIcon.svg";
import searchIcon from "../assets/icons/searchIcon.png";
import locationIcon from "../assets/icons/locationIcon.png";
import ursaLogo from "../assets/logos/ursaLogoWithLetters.png";
import type { ChatAction } from "../types/chatActions";

type GeocodeResult = {
  label: string;
  latitude: number;
  longitude: number;
  boundingBox?: [number, number, number, number];
};

export type MapState = {
  center: [number, number];
  zoom: number;
  bbox: [number, number, number, number] | null;
};

type OpenLayersMapProps = {
  onMapStateChange?: (state: MapState) => void;
  actions?: ChatAction[];
};

type PinData = {
  id: string;
  title: string;
  notes?: string | null;
  lat: number;
  lon: number;
};

const normalizePin = (value: unknown): PinData | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  // Shape-check any dynamic data before trusting it
  const record = value as Record<string, unknown>;
  const id = record.id;
  const title = record.title;
  const lat = record.lat;
  const lon = record.lon;
  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    typeof lat !== "number" ||
    typeof lon !== "number"
  ) {
    return null;
  }

  const notes = typeof record.notes === "string" ? record.notes : null;
  return {
    id,
    title,
    notes,
    lat,
    lon,
  };
};

const OpenLayersMap = ({ onMapStateChange, actions }: OpenLayersMapProps) => {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const minPinZoom = 6;
  const mapRef = useRef<OlMap | null>(null);
  const maxZoom = 18;
  const pinSourceRef = useRef<VectorSource | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSearchMinimized, setIsSearchMinimized] = useState(true);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [pins, setPins] = useState<PinData[]>([]);

  useEffect(() => {
    const pinSource = new VectorSource();
    // Quick note: cache styles by scale so icons aren't recreated on every render
    const styleCache = new Map<number, Style>();
    const pinLayer = new VectorLayer({
      source: pinSource,
      style: (_feature, resolution) => {
        const zoom = Math.log2(156543.03392804097 / resolution);
        // Keep pins hidden until the map is zoomed in enough to be useful
        if (zoom < minPinZoom) {
          return;
        }
        const scale = Math.min(0.78, Math.max(0.32, zoom / 20));
        const cacheKey = Number(scale.toFixed(2));
        const cached = styleCache.get(cacheKey);
        if (cached) {
          return cached;
        }
        const style = new Style({
          image: new Icon({
            src: pinIcon,
            anchor: [0.5, 1],
            scale: cacheKey,
          }),
        });
        styleCache.set(cacheKey, style);
        return style;
      },
    });

    const map = new OlMap({
      target: mapDivRef.current as HTMLDivElement,
      layers: [
        new TileLayer({
          source: new OSM(),
        }),
        pinLayer,
      ],
      view: new View({
        center: [0, 0],
        zoom: 2,
        maxZoom,
      }),
    });

    mapRef.current = map;
    pinSourceRef.current = pinSource;

    // Share the latest map view with whoever is listening (chat, etc)
    const pushMapState = () => {
      if (!onMapStateChange) {
        return;
      }

      const view = map.getView();
      const center = view.getCenter();
      if (!center) {
        return;
      }

      const size = map.getSize();
      const bbox = size
        ? (transformExtent(
            view.calculateExtent(size),
            "EPSG:3857",
            "EPSG:4326",
          ) as [number, number, number, number])
        : null;

      onMapStateChange({
        center: toLonLat(center) as [number, number],
        zoom: view.getZoom() ?? 2,
        bbox,
      });
    };

    pushMapState();
    map.on("moveend", pushMapState);

    return () => {
      map.un("moveend", pushMapState);
      map.setTarget(undefined);
      mapRef.current = null;
      pinSourceRef.current = null;
    };
  }, [onMapStateChange]);

  useEffect(() => {
    if (!actions || actions.length === 0) {
      return;
    }

    const map = mapRef.current;
    const view = map?.getView();

    // Merge action results into pin state and map movement in one pass
    setPins((prevPins) => {
      let nextPins = [...prevPins];
      actions.forEach((action) => {
        if (action.type === "geocode") {
          const { lat, lon } = action.result;
          if (view && typeof lat === "number" && typeof lon === "number") {
            view.animate({
              center: fromLonLat([lon, lat]),
              zoom: 12,
              duration: 700,
            });
          }
        }
        if (action.type === "list_pins" && Array.isArray(action.result)) {
          nextPins = action.result
            .map((item) => normalizePin(item))
            .filter((item): item is PinData => Boolean(item));
        }
        if (action.type === "create_pin") {
          const pin = normalizePin(action.result);
          if (pin) {
            nextPins = [
              pin,
              ...nextPins.filter((existing) => existing.id !== pin.id),
            ];
          }
        }
        if (action.type === "remove_pin") {
          const id = action.result.id;
          if (typeof id === "string") {
            nextPins = nextPins.filter((existing) => existing.id !== id);
          }
        }
        if (action.type === "remove_pins") {
          const result = action.result;
          if (result.removed_all === true) {
            nextPins = [];
            return;
          }
          const ids = result.ids;
          if (Array.isArray(ids)) {
            const idsToRemove = new Set(
              ids.filter((id): id is string => typeof id === "string"),
            );
            if (idsToRemove.size > 0) {
              nextPins = nextPins.filter(
                (existing) => !idsToRemove.has(existing.id),
              );
            }
          }
        }
      });
      return nextPins;
    });
  }, [actions]);

  useEffect(() => {
    const source = pinSourceRef.current;
    if (!source) {
      return;
    }

    source.clear();
    // Convert pin state into OpenLayers features
    const features = pins.map((pin) => {
      const feature = new Feature({
        geometry: new Point(fromLonLat([pin.lon, pin.lat])),
        title: pin.title,
        notes: pin.notes,
      });
      feature.setId(pin.id);
      return feature;
    });
    source.addFeatures(features);
  }, [pins]);

  const performSearch = async (searchText: string) => {
    if (!searchText.trim()) {
      setResults([]);
      setErrorMessage("Enter a location to search.");
      return;
    }

    // Reset async state before kicking off the geocode call
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(searchText.trim())}`,
        {
          headers: {
            "Accept-Language": "en",
          },
        },
      );

      if (!response.ok) {
        throw new Error("Geocoding request failed.");
      }

      const data = (await response.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
        boundingbox?: [string, string, string, string];
      }>;

      const parsedResults = data.map((entry) => {
        const boundingBox = entry.boundingbox
          ? ([
              Number(entry.boundingbox[2]),
              Number(entry.boundingbox[0]),
              Number(entry.boundingbox[3]),
              Number(entry.boundingbox[1]),
            ] as [number, number, number, number])
          : undefined;

        return {
          label: entry.display_name,
          latitude: Number(entry.lat),
          longitude: Number(entry.lon),
          boundingBox,
        };
      });

      setResults(parsedResults);
      if (parsedResults.length === 0) {
        setErrorMessage("No results found. Try another search.");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong while searching.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Keep the search UX snappy, run the query as soon as the form submits
    performSearch(query);
  };

  const handleResultSelect = (result: GeocodeResult) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const view = map.getView();
    const center = fromLonLat([result.longitude, result.latitude]);

    // If there's a bounding box, fit it, otherwise animate to a nice zoom
    if (result.boundingBox) {
      const extent = transformExtent(
        result.boundingBox,
        "EPSG:4326",
        "EPSG:3857",
      );
      view.fit(extent, {
        padding: [80, 80, 80, 80],
        duration: 1200,
        maxZoom,
        easing: easeOut,
      });
    } else {
      view.animate({
        center,
        zoom: 12,
        duration: 1000,
        easing: easeOut,
      });
    }

    setQuery(result.label);
    setResults([]);
  };

  const handleGeolocate = () => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported in this browser.");
      return;
    }

    setIsLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        map.getView().animate({
          center: fromLonLat([longitude, latitude]),
          zoom: 13,
          duration: 900,
          easing: easeOut,
        });
        setIsLocating(false);
      },
      () => {
        setIsLocating(false);
        setLocationError("Unable to access your location.");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      },
    );
  };

  return (
    <div className="map-shell">
      <div ref={mapDivRef} className="map" />
      <div className="map-logo" aria-hidden="true">
        <img src={ursaLogo} alt="Ursa" />
      </div>
      <div className={`map-search ${isSearchMinimized ? "is-collapsed" : ""}`}>
        {isSearchMinimized ? (
          <button
            className="map-search-minimized"
            type="button"
            onClick={() => setIsSearchMinimized(false)}
            aria-label="Expand search"
          >
            <span className="map-search-icon" aria-hidden="true">
              <img src={searchIcon} alt="" />
            </span>
          </button>
        ) : (
          <form className="map-search-form" onSubmit={handleSubmit}>
            <input
              className="map-search-input"
              type="search"
              value={query}
              placeholder="Search for a location"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search for a location"
            />
            <button
              className="map-search-button"
              type="submit"
              aria-label="Search"
            >
              {isLoading ? (
                <span className="map-search-spinner" aria-hidden="true" />
              ) : (
                <span className="map-search-icon" aria-hidden="true">
                  <img src={searchIcon} alt="" />
                </span>
              )}
            </button>
            <button
              className="map-search-collapse"
              type="button"
              onClick={() => setIsSearchMinimized(true)}
              aria-label="Minimize search"
            >
              <svg
                className="map-search-collapse-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </form>
        )}
        {!isSearchMinimized && errorMessage && (
          <p className="map-search-error">{errorMessage}</p>
        )}
        {!isSearchMinimized && results.length > 0 && (
          <ul className="map-search-results">
            {results.map((result) => (
              <li
                key={`${result.latitude}-${result.longitude}-${result.label}`}
              >
                <button
                  type="button"
                  onClick={() => handleResultSelect(result)}
                >
                  {result.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="map-geolocate">
        <button
          className="map-geolocate-button"
          type="button"
          onClick={handleGeolocate}
          aria-label="Locate me"
          aria-busy={isLocating}
        >
          {isLocating ? (
            <span className="map-geolocate-spinner" aria-hidden="true">
              <img
                className="map-geolocate-spinner-icon"
                src={locationIcon}
                alt=""
                aria-hidden="true"
              />
            </span>
          ) : (
            <img
              className="map-geolocate-icon"
              src={locationIcon}
              alt=""
              aria-hidden="true"
            />
          )}
        </button>
        {locationError && (
          <p className="map-geolocate-error" role="status">
            {locationError}
          </p>
        )}
      </div>
    </div>
  );
};

export default OpenLayersMap;
