"use client";

import { useEffect, useRef } from "react";
import markerThing from "../public/images/markerTest.png"

export default function GoogleMap() {
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
  iconUrl = "/markers/default-marker.png",
  imageUrls = []
) {
  if (!googleMapRef.current || !window.google?.maps) {
    console.error("Google Map has not loaded yet.");
    return;
  }

  const marker = new window.google.maps.Marker({
    position: { lat, lng },
    map: googleMapRef.current,
    title,

    icon: {
      url: iconUrl,
      scaledSize: new window.google.maps.Size(40, 40),
      anchor: new window.google.maps.Point(20, 40),
    },
  });

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

  marker.addListener("click", () => {
    infoWindow.open({
      anchor: marker,
      map: googleMapRef.current,
    });
  });

  markersRef.current.push(marker);

  return marker;
}

  useEffect(() => {
    async function loadMap() {
      try {
        const response = await fetch("/api/maps-config");

        if (!response.ok) {
          throw new Error("Failed to load Maps configuration");
        }

        const { apiKey } = await response.json();

        // Google Maps already loaded
        if (window.google?.maps) {
          initializeMap();
          return;
        }

        const existingScript = document.querySelector(
          'script[data-google-maps="true"]'
        );

        if (existingScript) {
          existingScript.addEventListener("load", initializeMap);
          return;
        }

        const script = document.createElement("script");

        script.src =
          `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;

        script.async = true;
        script.defer = true;
        script.dataset.googleMaps = "true";

        script.addEventListener("load", initializeMap);

        document.head.appendChild(script);
      } catch (error) {
        console.error("Google Maps failed to load:", error);
      }
    }

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
  markerThing,
  [
    "/images/location-1.jpg",
    "/images/location-2.jpg",
    "/images/location-3.jpg",
    "/images/location-4.jpg",
  ]
);
    }

    loadMap();

    return () => {
      markersRef.current.forEach((marker) => {
        marker.setMap(null);
      });

      markersRef.current = [];
    };
  }, []);

  return (
    <div
      ref={mapRef}
      style={{
        width: "100%",
        height: "500px",
      }}
    />
  );
}