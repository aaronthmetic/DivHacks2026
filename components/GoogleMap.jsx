"use client";

import { useEffect, useRef } from "react";

export default function GoogleMap() {
  const mapRef = useRef(null);
  const googleMapRef = useRef(null);

  // Stores all ZIP markers/features
  const markersRef = useRef([]);

  // Stores currently selected marker data
  const selectedMarkerRef = useRef(null);

  // Stores currently selected ZIP code
  const selectedZipCodeRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function initializeMap() {
      try {
        // =================================================
        // GET GOOGLE MAPS API KEY
        // =================================================

        const response = await fetch(
          "/api/api-key/googleMaps"
        );

        if (!response.ok) {
          throw new Error(
            "Failed to retrieve Google Maps API key"
          );
        }

        const { apiKey } = await response.json();

        if (!apiKey) {
          throw new Error(
            "Google Maps API key was not returned"
          );
        }

        // =================================================
        // LOAD GOOGLE MAPS
        // =================================================

        if (!window.google?.maps) {
          await loadGoogleMaps(apiKey);
        }

        if (cancelled || !mapRef.current) {
          return;
        }

        // =================================================
        // MAP STYLING
        // =================================================

        const mapStyles = [
          // Hide landmarks / businesses / POIs
          {
            featureType: "poi",
            elementType: "all",
            stylers: [
              {
                visibility: "off",
              },
            ],
          },

          // Hide transit stations
          {
            featureType: "transit.station",
            elementType: "all",
            stylers: [
              {
                visibility: "off",
              },
            ],
          },

          // Keep administrative labels
          {
            featureType: "administrative",
            elementType: "labels",
            stylers: [
              {
                visibility: "on",
              },
            ],
          },

          // Keep city labels
          {
            featureType: "administrative.locality",
            elementType: "labels",
            stylers: [
              {
                visibility: "on",
              },
            ],
          },

          // Keep neighborhood labels
          {
            featureType: "administrative.neighborhood",
            elementType: "labels",
            stylers: [
              {
                visibility: "on",
              },
            ],
          },

          // Keep road names
          {
            featureType: "road",
            elementType: "labels",
            stylers: [
              {
                visibility: "on",
              },
            ],
          },
        ];

        // =================================================
        // CREATE MAP
        // =================================================

        const map = new window.google.maps.Map(
  mapRef.current,
  {
    center: {
      lat: 40.7128,
      lng: -74.006,
    },

    zoom: 11,

    // Limit zooming
    minZoom: 10,
    maxZoom: 18,

    clickableIcons: false,

    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,

    styles: mapStyles,
  }
);

        googleMapRef.current = map;

        // =================================================
        // ADD ZIP MARKERS
        // =================================================

        await Promise.all([
          addNYCZipMarker(
            "10001",
            "Chelsea",
            "/images/zealand.png"
          ),

          // Add additional markers here:
          //
          // addNYCZipMarker(
          //   "10002",
          //   "Lower East Side",
          //   "/images/lower-east-side.jpg"
          // ),
          //
          // addNYCZipMarker(
          //   "11201",
          //   "Downtown Brooklyn",
          //   "/images/brooklyn.jpg"
          // ),
        ]);
      } catch (error) {
        console.error(
          "Failed to initialize Google Map:",
          error
        );
      }
    }

    initializeMap();

    // =================================================
    // CLEANUP
    // =================================================

    return () => {
      cancelled = true;

      markersRef.current.forEach(
        ({
          marker,
          zipFeature,
          listeners = [],
        }) => {
          // Remove marker
          marker?.setMap(null);

          // Remove event listeners
          listeners.forEach((listener) => {
            listener?.remove();
          });

          // Remove ZIP GeoJSON
          if (
            zipFeature &&
            googleMapRef.current
          ) {
            googleMapRef.current.data.remove(
              zipFeature
            );
          }
        }
      );

      markersRef.current = [];
      selectedMarkerRef.current = null;
      selectedZipCodeRef.current = null;
      googleMapRef.current = null;
    };
  }, []);

  // =====================================================
  // LOAD GOOGLE MAPS SCRIPT
  // =====================================================

  function loadGoogleMaps(apiKey) {
    return new Promise((resolve, reject) => {
      // Already loaded
      if (window.google?.maps) {
        resolve();
        return;
      }

      // Check if script already exists
      const existingScript =
        document.querySelector(
          'script[data-google-maps="true"]'
        );

      if (existingScript) {
        existingScript.addEventListener(
          "load",
          resolve,
          { once: true }
        );

        existingScript.addEventListener(
          "error",
          reject,
          { once: true }
        );

        return;
      }

      // Create Google Maps script
      const script =
        document.createElement("script");

      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;

      script.async = true;
      script.defer = true;

      script.dataset.googleMaps = "true";

      script.onload = resolve;

      script.onerror = () => {
        reject(
          new Error(
            "Failed to load Google Maps"
          )
        );
      };

      document.head.appendChild(script);
    });
  }

  // =====================================================
  // FETCH NYC ZIP DATA
  // =====================================================

  async function addNYCZipMarker(
    zipCode,
    title,
    imageUrl,
    options = {}
  ) {
    try {
      const response = await fetch(
        `/api/zipcode/${zipCode}`
      );

      if (!response.ok) {
        throw new Error(
          `Could not load ZIP ${zipCode}`
        );
      }

      const data = await response.json();

      return addZipMarker({
        zipCode,
        title,
        imageUrl,

        geometry: data.geometry,
        center: data.center,

        // Image scaling configuration
        baseZoom: options.baseZoom ?? 11,
        baseMarkerSize:
          options.baseMarkerSize ?? 80,
        minMarkerSize:
          options.minMarkerSize ?? 30,
        maxMarkerSize:
          options.maxMarkerSize ?? 160,
        zoomScale:
          options.zoomScale ?? 0.35,
      });
    } catch (error) {
      console.error(
        `Failed to add ZIP ${zipCode}:`,
        error
      );

      return null;
    }
  }

  // =====================================================
  // ADD ZIP MARKER
  // =====================================================

  function addZipMarker({
    zipCode,
    title = "",
    imageUrl = "/markers/default-marker.png",

    geometry,
    center,

    baseZoom = 11,
    baseMarkerSize = 80,
    minMarkerSize = 30,
    maxMarkerSize = 160,
    zoomScale = 0.35,
  }) {
    const map = googleMapRef.current;

    if (!map || !window.google?.maps) {
      console.error(
        "Google Maps is not initialized."
      );

      return;
    }

    if (!geometry) {
      console.error(
        `No geometry found for ZIP ${zipCode}`
      );

      return;
    }

    // =================================================
    // PREPARE GEOJSON
    // =================================================

    const filledGeometry =
      removePolygonHoles(geometry);

    const features =
      map.data.addGeoJson({
        type: "Feature",

        properties: {
          zipCode,
          title,
        },

        geometry: filledGeometry,
      });

    const zipFeature = features[0];

    if (!zipFeature) {
      console.error(
        `Failed to create ZIP feature for ${zipCode}`
      );

      return;
    }

    // =================================================
    // ZIP STYLING
    // =================================================

    function setDefaultStyle() {
      map.data.overrideStyle(
        zipFeature,
        {
          fillColor: "#3b82f6",

          // Nearly invisible but keeps entire ZIP
          // polygon clickable.
          fillOpacity: 0.001,

          strokeColor: "#2563eb",
          strokeOpacity: 0,
          strokeWeight: 2,

          clickable: true,
          cursor: "pointer",
        }
      );
    }

    function showHighlight() {
      map.data.overrideStyle(
        zipFeature,
        {
          fillColor: "#3b82f6",
          fillOpacity: 0.35,

          strokeColor: "#2563eb",
          strokeOpacity: 1,
          strokeWeight: 2,

          clickable: true,
          cursor: "pointer",
        }
      );
    }

    function hideHighlight() {
      setDefaultStyle();
    }

    setDefaultStyle();

    // =================================================
    // DETERMINE MARKER POSITION
    // =================================================

    const hasValidCenter =
      center &&
      Number.isFinite(
        Number(center.lat)
      ) &&
      Number.isFinite(
        Number(center.lng)
      );

    const markerPosition =
      hasValidCenter
        ? {
            lat: Number(center.lat),
            lng: Number(center.lng),
          }
        : getGeometryCenter(
            filledGeometry
          );

    // =================================================
    // MARKER IMAGE SCALING
    // =================================================

    function getMarkerSize() {
      const zoom =
        map.getZoom() ?? baseZoom;

      // Scale image according to map zoom.
      //
      // Higher zoom = larger image.
      // Lower zoom = smaller image.
      const scale = Math.pow(
        2,
        (zoom - baseZoom) *
          zoomScale
      );

      return Math.max(
        minMarkerSize,
        Math.min(
          maxMarkerSize,
          baseMarkerSize * scale
        )
      );
    }

    function createMarkerIcon() {
      const size = getMarkerSize();

      return {
        url: imageUrl,

        // Always square
        scaledSize:
          new window.google.maps.Size(
            size,
            size
          ),

        // Center image over coordinate
        anchor:
          new window.google.maps.Point(
            size / 2,
            size / 2
          ),
      };
    }

    // =================================================
    // CREATE IMAGE MARKER
    // =================================================

    const marker =
      new window.google.maps.Marker({
        map,

        position: markerPosition,

        title:
          title ||
          `ZIP ${zipCode}`,

        icon: createMarkerIcon(),

        zIndex: 10,
      });

    // =================================================
    // SCALE IMAGE WHEN MAP ZOOMS
    // =================================================

    const zoomListener =
      map.addListener(
        "zoom_changed",
        () => {
          marker.setIcon(
            createMarkerIcon()
          );
        }
      );

    // =================================================
    // SELECTION STATE
    // =================================================

    let isSelected = false;

    const markerData = {
      marker,
      zipFeature,
      zipCode,

      // ---------------------------------------------
      // SELECT
      // ---------------------------------------------

      select() {
        // Deselect previously selected ZIP
        if (
          selectedMarkerRef.current &&
          selectedMarkerRef.current !==
            markerData
        ) {
          selectedMarkerRef.current.deselect();
        }

        isSelected = true;

        selectedMarkerRef.current =
          markerData;

        // Store selected ZIP code
        selectedZipCodeRef.current =
          zipCode;

        console.log(
          "Selected ZIP:",
          selectedZipCodeRef.current
        );

        showHighlight();
      },

      // ---------------------------------------------
      // DESELECT
      // ---------------------------------------------

      deselect() {
        isSelected = false;

        hideHighlight();

        if (
          selectedMarkerRef.current ===
          markerData
        ) {
          selectedMarkerRef.current =
            null;
        }

        if (
          selectedZipCodeRef.current ===
          zipCode
        ) {
          selectedZipCodeRef.current =
            null;
        }
      },

      // ---------------------------------------------
      // TOGGLE
      // ---------------------------------------------

      toggle() {
        if (isSelected) {
          markerData.deselect();
        } else {
          markerData.select();
        }
      },

      get selected() {
        return isSelected;
      },
    };

    // =================================================
    // IMAGE MARKER EVENTS
    // =================================================

    marker.addListener(
      "mouseover",
      () => {
        showHighlight();
      }
    );

    marker.addListener(
      "mouseout",
      () => {
        if (!isSelected) {
          hideHighlight();
        }
      }
    );

    marker.addListener(
      "click",
      () => {
        markerData.toggle();
      }
    );

    // =================================================
    // ZIP AREA EVENTS
    // =================================================

    // Hover anywhere inside ZIP
    const zipMouseOverListener =
      map.data.addListener(
        "mouseover",
        (event) => {
          if (
            event.feature !==
            zipFeature
          ) {
            return;
          }

          showHighlight();
        }
      );

    // Leave ZIP
    const zipMouseOutListener =
      map.data.addListener(
        "mouseout",
        (event) => {
          if (
            event.feature !==
            zipFeature
          ) {
            return;
          }

          if (!isSelected) {
            hideHighlight();
          }
        }
      );

    // Click anywhere inside ZIP
    const zipClickListener =
      map.data.addListener(
        "click",
        (event) => {
          if (
            event.feature !==
            zipFeature
          ) {
            return;
          }

          markerData.toggle();
        }
      );

    // =================================================
    // STORE LISTENERS
    // =================================================

    markerData.listeners = [
      zoomListener,
      zipMouseOverListener,
      zipMouseOutListener,
      zipClickListener,
    ];

    // =================================================
    // STORE MARKER
    // =================================================

    markersRef.current.push(
      markerData
    );

    return markerData;
  }

  // =====================================================
  // REMOVE POLYGON HOLES
  // =====================================================

  function removePolygonHoles(
    geometry
  ) {
    if (!geometry) {
      return geometry;
    }

    // Standard Polygon
    if (
      geometry.type === "Polygon"
    ) {
      return {
        type: "Polygon",

        // First ring is exterior boundary.
        // Remaining rings are holes.
        coordinates: [
          geometry.coordinates[0],
        ],
      };
    }

    // MultiPolygon
    if (
      geometry.type ===
      "MultiPolygon"
    ) {
      return {
        type: "MultiPolygon",

        // Keep exterior ring of each polygon.
        coordinates:
          geometry.coordinates.map(
            (polygon) => [
              polygon[0],
            ]
          ),
      };
    }

    return geometry;
  }

  // =====================================================
  // GET FALLBACK GEOMETRY CENTER
  // =====================================================

  function getGeometryCenter(
    geometry
  ) {
    const bounds =
      new window.google.maps.LatLngBounds();

    function processCoordinates(
      coordinates
    ) {
      // GeoJSON coordinate:
      //
      // [longitude, latitude]

      if (
        typeof coordinates?.[0] ===
          "number" &&
        typeof coordinates?.[1] ===
          "number"
      ) {
        bounds.extend({
          lat: coordinates[1],
          lng: coordinates[0],
        });

        return;
      }

      if (
        Array.isArray(coordinates)
      ) {
        coordinates.forEach(
          processCoordinates
        );
      }
    }

    processCoordinates(
      geometry.coordinates
    );

    return bounds.getCenter();
  }

  // =====================================================
  // RENDER MAP
  // =====================================================

  return (
    <div
      ref={mapRef}
      style={{
        width: "100%",
        height: "100vh",
      }}
    />
  );
}