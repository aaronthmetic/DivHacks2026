"use client";

import { useEffect, useRef, useState } from "react";
import markerThing from "../public/images/markerTest.png"

let mapsPromise;
function loadGoogleMaps() {
  if (!mapsPromise) {
    mapsPromise = (async () => {
      if (!window.google?.maps?.importLibrary) {
        const response = await fetch("/api/api-key/googleMaps");
        if (!response.ok) throw new Error("Maps configuration unavailable");
        const { apiKey } = await response.json();
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          // loading=async requires the API callback, not the script load event.
          window.__divhacksMapsReady = () => {
            delete window.__divhacksMapsReady;
            resolve();
          };
          const params = new URLSearchParams({
            key: apiKey,
            loading: "async",
            callback: "__divhacksMapsReady",
            v: "weekly",
          });
          script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
          script.async = true;
          script.addEventListener("error", () => {
            delete window.__divhacksMapsReady;
            script.remove();
            reject(new Error("Maps script failed to load"));
          }, { once: true });
          document.head.appendChild(script);
        });
      }
      await Promise.all([
        window.google.maps.importLibrary("maps"),
        window.google.maps.importLibrary("marker"),
      ]);
    })().catch((error) => { mapsPromise = undefined; throw error; });
  }
  return mapsPromise;
}

export default function GoogleMap() {
  const [failed, setFailed] = useState(false);
  const mapRef = useRef(null);
  const googleMapRef = useRef(null);
  const markersRef = useRef([]);

  /**
   * Add a marker with a custom icon and click popup.
   *
   * @param {number} lat
   * @param {number} lng
   * @param {string} title
   * @param {string} iconUrl - URL/path for marker icon
   * @param {string} imageUrl - URL/path for popup image
   */
  function addMarker(
  lat,
  lng,
  title = "",
  iconUrl = markerThing.src,
  imageUrls = []
) {
  if (!googleMapRef.current || !window.google?.maps) {
    console.error("Google Map has not loaded yet.");
    return;
  }

  const icon = document.createElement("img");
  icon.src = iconUrl;
  icon.alt = "";
  icon.width = 40;
  icon.height = 40;
  icon.style.objectFit = "contain";
  const marker = new window.google.maps.marker.AdvancedMarkerElement({
    position: { lat, lng },
    map: googleMapRef.current,
    title,
    gmpClickable: true,
  });
  marker.append(icon);

  // Each marker gets a unique ID so multiple galleries can exist.
  const galleryId =
    "gallery-" + Math.random().toString(36).substring(2, 9);

  const galleryHtml =
    imageUrls.length > 0
      ? `
        <div
          style="
            position: relative;
            width: 280px;
            height: 180px;
            overflow: hidden;
            border-radius: 8px;
          "
        >
          <img
            id="${galleryId}-image"
            src="${imageUrls[0]}"
            alt="${title}"
            style="
              width: 100%;
              height: 100%;
              object-fit: cover;
            "
          />

          ${
            imageUrls.length > 1
              ? `
                <button
                  id="${galleryId}-prev"
                  style="
                    position: absolute;
                    left: 8px;
                    top: 50%;
                    transform: translateY(-50%);

                    width: 34px;
                    height: 34px;

                    border: none;
                    border-radius: 50%;

                    background: rgba(0, 0, 0, 0.6);
                    color: white;

                    font-size: 20px;
                    cursor: pointer;

                    display: flex;
                    align-items: center;
                    justify-content: center;
                  "
                >
                  &#10094;
                </button>

                <button
                  id="${galleryId}-next"
                  style="
                    position: absolute;
                    right: 8px;
                    top: 50%;
                    transform: translateY(-50%);

                    width: 34px;
                    height: 34px;

                    border: none;
                    border-radius: 50%;

                    background: rgba(0, 0, 0, 0.6);
                    color: white;

                    font-size: 20px;
                    cursor: pointer;

                    display: flex;
                    align-items: center;
                    justify-content: center;
                  "
                >
                  &#10095;
                </button>

                <div
                  id="${galleryId}-counter"
                  style="
                    position: absolute;
                    bottom: 8px;
                    left: 50%;
                    transform: translateX(-50%);

                    background: rgba(0, 0, 0, 0.6);
                    color: white;

                    padding: 3px 8px;
                    border-radius: 10px;
                    font-size: 12px;
                  "
                >
                  1 / ${imageUrls.length}
                </div>
              `
              : ""
          }
        </div>
      `
      : "";

  const infoWindowContent = `
    <div style="width: 280px; padding: 4px;">
      ${galleryHtml}

      <h3
        style="
          margin: 8px 0 0 0;
          font-size: 16px;
        "
      >
        ${title}
      </h3>
    </div>
  `;

  const infoWindow = new window.google.maps.InfoWindow({
    content: infoWindowContent,
  });

  // Add carousel functionality once the InfoWindow DOM exists.
  infoWindow.addListener("domready", () => {
    if (imageUrls.length <= 1) return;

    const image = document.getElementById(`${galleryId}-image`);
    const prevButton = document.getElementById(`${galleryId}-prev`);
    const nextButton = document.getElementById(`${galleryId}-next`);
    const counter = document.getElementById(`${galleryId}-counter`);

    if (!image || !prevButton || !nextButton) return;

    let currentImage = 0;

    function updateImage() {
      image.src = imageUrls[currentImage];

      if (counter) {
        counter.textContent =
          `${currentImage + 1} / ${imageUrls.length}`;
      }
    }

    prevButton.onclick = (event) => {
      event.stopPropagation();

      currentImage =
        (currentImage - 1 + imageUrls.length) %
        imageUrls.length;

      updateImage();
    };

    nextButton.onclick = (event) => {
      event.stopPropagation();

      currentImage =
        (currentImage + 1) %
        imageUrls.length;

      updateImage();
    };
  });

  marker.addEventListener("gmp-click", () => {
    infoWindow.open({
      anchor: marker,
      map: googleMapRef.current,
    });
  });

  markersRef.current.push(marker);

  return marker;
}

  useEffect(() => {
    let cancelled = false;
    const previousAuthFailure = window.gm_authFailure;
    const authFailure = () => {
      if (!cancelled) setFailed(true);
      console.error("Google Maps authorization failed. Check Maps JavaScript API enablement, billing, and allowed website referrers in Google Cloud.");
      previousAuthFailure?.();
    };
    window.gm_authFailure = authFailure;
    loadGoogleMaps().then(() => {
      if (!cancelled) initializeMap();
    }).catch((error) => {
      if (!cancelled) {
        setFailed(true);
        console.error("Google Maps could not initialize:", error.message);
      }
    });

    function initializeMap() {
      if (!mapRef.current || !window.google?.maps) {
        return;
      }

      const startingLocation = {
        lat: 40.7128,
        lng: -74.006,
      };

      googleMapRef.current = new window.google.maps.Map(
        mapRef.current,
        {
          center: startingLocation,
          zoom: 13,
          // Advanced markers require a map ID; Google provides this demo ID for development.
          mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",

          // Prevent clicking Google's built-in POIs/icons
          clickableIcons: false,

          // Optional controls
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        }
      );

      // Example marker
      addMarker(
  40.7128,
  -74.006,
  "Example Location",
  markerThing.src,
  []
);
    }

    return () => {
      cancelled = true;
      if (window.gm_authFailure === authFailure) window.gm_authFailure = previousAuthFailure;
      markersRef.current.forEach((marker) => {
        window.google.maps.event.clearInstanceListeners(marker);
        marker.map = null;
      });

      markersRef.current = [];
      googleMapRef.current = null;
    };
  }, []);

  return (
    <div className="w-full min-w-0">
    {failed && <p role="status">The map is currently unavailable. Please try again later.</p>}
    <div
      aria-label="Location map"
      ref={mapRef}
      style={{
        width: "100%",
        height: "500px",
      }}
    />
    </div>
  );
}