import { supabase } from "./supabase.js";

/* =========================================================
   RYDO PASSENGER APP
   ========================================================= */

const $ = (id) => document.getElementById(id);

let currentUser = null;
let currentSession = null;
let selectedVehicle = "Bike";
let selectedPayment = "Cash";
let pickupCoords = null;
let destinationCoords = null;
let currentRide = null;
let rideChannel = null;

/* ---------- Helpers ---------- */

function show(id, visible = true) {
  const el = $(id);
  if (el) el.style.display = visible ? "" : "none";
}

function text(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function value(id) {
  return $(id)?.value?.trim() || "";
}

function toast(message, type = "normal") {
  const el = $("toast");
  if (!el) {
    alert(message);
    return;
  }

  el.textContent = message;
  el.className = `toast show ${type}`;

  setTimeout(() => {
    el.className = "toast";
  }, 3500);
}

function setLoading(button, loading, normalText) {
  if (!button) return;

  button.disabled = loading;

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = "Please wait...";
  } else {
    button.textContent =
      button.dataset.originalText || normalText || button.textContent;
  }
}

/* =========================================================
   AUTH
   ========================================================= */

async function registerPassenger() {
  const name =
    value("registerName") ||
    value("regName") ||
    value("fullName");

  const phone =
    value("registerPhone") ||
    value("regPhone") ||
    value("phone");

  const email =
    value("registerEmail") ||
    value("regEmail");

  const password =
    value("registerPassword") ||
    value("regPassword");

  if (!name || !email || !password) {
    toast("Please fill in your name, email and password.", "error");
    return;
  }

  if (password.length < 6) {
    toast("Password must contain at least 6 characters.", "error");
    return;
  }

  const button =
    $("registerBtn") ||
    $("registerButton");

  setLoading(button, true);

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          phone: phone || "",
          role: "passenger"
        }
      }
    });

    if (error) throw error;

    if (data.user) {
      await createProfile(data.user, name, phone);
    }

    if (!data.session) {
      toast(
        "Registration successful. Check your email if verification is required.",
        "success"
      );
    } else {
      toast("Registration successful!", "success");
    }

    await checkSession();
  } catch (error) {
    console.error(error);
    toast(error.message || "Registration failed.", "error");
  } finally {
    setLoading(button, false, "Register");
  }
}

async function loginPassenger() {
  const email =
    value("loginEmail") ||
    value("email");

  const password =
    value("loginPassword") ||
    value("password");

  if (!email || !password) {
    toast("Enter your email and password.", "error");
    return;
  }

  const button =
    $("loginBtn") ||
    $("loginButton");

  setLoading(button, true);

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    currentSession = data.session;
    currentUser = data.user;

    await createProfile(
      currentUser,
      currentUser.user_metadata?.full_name || "",
      currentUser.user_metadata?.phone || ""
    );

    await showPassengerApp();
    toast("Welcome back to Rydo!", "success");
  } catch (error) {
    console.error(error);
    toast(error.message || "Login failed.", "error");
  } finally {
    setLoading(button, false, "Login");
  }
}

async function createProfile(user, name = "", phone = "") {
  if (!user) return;

  try {
    await supabase.from("profiles").upsert(
      {
        id: user.id,
        full_name:
          name ||
          user.user_metadata?.full_name ||
          "Rydo Passenger",
        phone:
          phone ||
          user.user_metadata?.phone ||
          "",
        role: "passenger"
      },
      {
        onConflict: "id"
      }
    );
  } catch (error) {
    console.warn("Profile creation:", error);
  }
}

async function logoutPassenger() {
  await supabase.auth.signOut();

  currentUser = null;
  currentSession = null;
  currentRide = null;

  if (rideChannel) {
    await supabase.removeChannel(rideChannel);
    rideChannel = null;
  }

  show("passengerApp", false);
  show("authSection", true);

  toast("Logged out.");
}

async function checkSession() {
  try {
    const { data } = await supabase.auth.getSession();

    currentSession = data.session;
    currentUser = data.session?.user || null;

    if (currentUser) {
      await showPassengerApp();
    } else {
      show("passengerApp", false);
      show("authSection", true);
    }
  } catch (error) {
    console.error("Session error:", error);
  }
}

async function showPassengerApp() {
  show("authSection", false);
  show("authContainer", false);
  show("loginRegister", false);

  show("passengerApp", true);
  show("appSection", true);

  const name =
    currentUser?.user_metadata?.full_name ||
    "Passenger";

  text("welcomeName", `Welcome, ${name}`);

  await loadActiveRide();
}

/* =========================================================
   PASSWORD VISIBILITY
   ========================================================= */

function togglePasswordVisibility() {
  const password =
    $("loginPassword") ||
    $("password") ||
    $("registerPassword");

  if (!password) return;

  password.type =
    password.type === "password"
      ? "text"
      : "password";
}

/* =========================================================
   VEHICLE
   ========================================================= */

function selectVehicle(vehicle) {
  selectedVehicle = vehicle;

  document
    .querySelectorAll(
      "[data-vehicle], .vehicle-option, .vehicle-card"
    )
    .forEach((el) => {
      const name =
        el.dataset.vehicle ||
        el.dataset.type ||
        el.textContent.trim();

      el.classList.toggle(
        "selected",
        name.toLowerCase().includes(vehicle.toLowerCase())
      );
    });

  calculateFare();
}

/* =========================================================
   PAYMENT
   ========================================================= */

function selectPayment(payment) {
  selectedPayment = payment;

  document
    .querySelectorAll(
      "[data-payment], .payment-option, .payment-card"
    )
    .forEach((el) => {
      const name =
        el.dataset.payment ||
        el.dataset.type ||
        el.textContent.trim();

      el.classList.toggle(
        "selected",
        name.toLowerCase().includes(payment.toLowerCase())
      );
    });
}

/* =========================================================
   LOCATION
   ========================================================= */

function useCurrentLocation() {
  if (!navigator.geolocation) {
    toast("Your phone does not support location.", "error");
    return;
  }

  const button =
    $("locationBtn") ||
    $("useLocationBtn") ||
    $("gpsBtn");

  setLoading(button, true);

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      pickupCoords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };

      try {
        const address = await reverseGeocode(
          pickupCoords.lat,
          pickupCoords.lng
        );

        const input =
          $("pickup") ||
          $("pickupInput") ||
          $("pickupLocation");

        if (input) input.value = address;

        toast("Current location added.", "success");
        await calculateFare();
      } catch (error) {
        console.error(error);

        const input =
          $("pickup") ||
          $("pickupInput") ||
          $("pickupLocation");

        if (input) {
          input.value =
            `${pickupCoords.lat.toFixed(5)}, ${pickupCoords.lng.toFixed(5)}`;
        }

        toast("Location found.", "success");
      }

      setLoading(button, false, "Use my location");
    },
    (error) => {
      console.error(error);

      setLoading(button, false, "Use my location");

      toast(
        "Could not get your location. Please allow location access.",
        "error"
      );
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000
    }
  );
}

/* =========================================================
   GEOCODING + REAL ROAD ROUTING
   ========================================================= */

async function geocode(address) {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q: `${address}, Nepal`,
      format: "json",
      limit: "1",
      countrycodes: "np"
    });

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Could not find location.");
  }

  const results = await response.json();

  if (!results.length) {
    throw new Error(`Location not found: ${address}`);
  }

  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon)
  };
}

async function reverseGeocode(lat, lng) {
  const url =
    "https://nominatim.openstreetmap.org/reverse?" +
    new URLSearchParams({
      lat,
      lon: lng,
      format: "json",
      zoom: "18"
    });

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Reverse geocoding failed.");
  }

  const result = await response.json();

  return (
    result.display_name ||
    `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  );
}

async function getRoadRoute(start, end) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${start.lng},${start.lat};${end.lng},${end.lat}` +
    `?overview=false&steps=false`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Routing service unavailable.");
  }

  const data = await response.json();

  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error("Could not calculate road route.");
  }

  const route = data.routes[0];

  return {
    distanceKm: route.distance / 1000,
    durationMinutes: Math.ceil(route.duration / 60)
  };
}

/* =========================================================
   FARE
   ========================================================= */

const fallbackFareRules = {
  Bike: {
    base: 25,
    perKm: 14
  },
  Car: {
    base: 60,
    perKm: 25
  },
  "Tuk Tuk": {
    base: 45,
    perKm: 18
  }
};

async function getFareRule(vehicle) {
  try {
    const { data, error } = await supabase
      .from("fare_settings")
      .select("*")
      .eq("vehicle_type", vehicle)
      .maybeSingle();

    if (!error && data) {
      return {
        base:
          Number(data.base_fare ?? data.base ?? 0),
        perKm:
          Number(data.per_km ?? data.perKm ?? 0),
        minimum:
          Number(data.minimum_fare ?? data.minimum ?? 0)
      };
    }
  } catch (error) {
    console.warn("Fare settings table not available yet.");
  }

  return {
    ...fallbackFareRules[vehicle],
    minimum: 0
  };
}

async function calculateFare() {
  const pickup =
    value("pickup") ||
    value("pickupInput") ||
    value("pickupLocation");

  const destination =
    value("destination") ||
    value("destinationInput");

  if (!pickup || !destination) return;

  const fareElement =
    $("farePreview") ||
    $("estimatedFare") ||
    $("fare");

  try {
    if (!pickupCoords) {
      pickupCoords = await geocode(pickup);
    }

    if (!destinationCoords) {
      destinationCoords = await geocode(destination);
    }

    const route = await getRoadRoute(
      pickupCoords,
      destinationCoords
    );

    const rule = await getFareRule(selectedVehicle);

    let fare =
      rule.base +
      route.distanceKm * rule.perKm;

    if (rule.minimum) {
      fare = Math.max(fare, rule.minimum);
    }

    fare = Math.ceil(fare);

    if (fareElement) {
      fareElement.textContent = `NPR ${fare}`;
    }

    text(
      "distance",
      `${route.distanceKm.toFixed(1)} km`
    );

    text(
      "distanceValue",
      `${route.distanceKm.toFixed(1)} km`
    );

    text(
      "eta",
      `${route.durationMinutes} min`
    );

    text(
      "etaValue",
      `${route.durationMinutes} min`
    );

    const fareInput =
      $("fareInput") ||
      $("calculatedFare");

    if (fareInput) {
      fareInput.value = fare;
    }

    return {
      fare,
      distanceKm: route.distanceKm,
      etaMinutes: route.durationMinutes
    };
  } catch (error) {
    console.warn(error);

    if (fareElement) {
      fareElement.textContent = "Enter valid locations";
    }

    return null;
  }
}

/* =========================================================
   REQUEST RIDE
   ========================================================= */

async function requestRide() {
  if (!currentUser) {
    toast("Please login first.", "error");
    return;
  }

  const pickup =
    value("pickup") ||
    value("pickupInput") ||
    value("pickupLocation");

  const destination =
    value("destination") ||
    value("destinationInput");

  if (!pickup || !destination) {
    toast("Enter pickup and destination.", "error");
    return;
  }

  const button =
    $("requestRideBtn") ||
    $("requestButton");

  setLoading(button, true);

  try {
    const route = await calculateFare();

    if (!route) {
      throw new Error(
        "We could not calculate the route. Check both locations."
      );
    }

    const { data, error } = await supabase
      .from("rides")
      .insert({
        passenger_id: currentUser.id,
        pickup_location: pickup,
        destination: destination,
        vehicle_type: selectedVehicle,
        distance_km: Number(route.distanceKm.toFixed(2)),
        fare: route.fare,
        status: "requested"
      })
      .select()
      .single();

    if (error) throw error;

    currentRide = data;

    await updateRidePayment(data.id);

    showRide(data);

    subscribeToRide(data.id);

    toast(
      "Ride requested. Looking for a driver...",
      "success"
    );
  } catch (error) {
    console.error(error);

    toast(
      error.message || "Could not request ride.",
      "error"
    );
  } finally {
    setLoading(button, false, "Request Ride");
  }
}

async function updateRidePayment(rideId) {
  try {
    await supabase
      .from("rides")
      .update({
        payment_method: selectedPayment
      })
      .eq("id", rideId);
  } catch (error) {
    console.warn(
      "payment_method column may not exist yet."
    );
  }
}

/* =========================================================
   ACTIVE RIDE
   ========================================================= */

async function loadActiveRide() {
  if (!currentUser) return;

  try {
    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("passenger_id", currentUser.id)
      .in("status", [
        "requested",
        "accepted",
        "arrived",
        "started"
      ])
      .order("created_at", {
        ascending: false
      })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      currentRide = data;
      showRide(data);
      subscribeToRide(data.id);
    }
  } catch (error) {
    console.warn("Active ride:", error);
  }
}

function showRide(ride) {
  if (!ride) return;

  show("activeRide", true);
  show("rideCard", true);

  text(
    "rideStatus",
    formatStatus(ride.status)
  );

  text(
    "ridePickup",
    ride.pickup_location || "-"
  );

  text(
    "rideDestination",
    ride.destination || "-"
  );

  text(
    "rideVehicle",
    ride.vehicle_type || "-"
  );

  text(
    "rideFare",
    `NPR ${Number(ride.fare || 0).toFixed(0)}`
  );

  text(
    "ridePayment",
    selectedPayment ||
      ride.payment_method ||
      "Cash"
  );

  text(
    "rideId",
    ride.id ? String(ride.id).slice(0, 8) : "-"
  );

  const status = String(ride.status || "").toLowerCase();

  show(
    "trackDriverBtn",
    ["accepted", "arrived", "started"].includes(status)
  );

  show(
    "cancelRideBtn",
    ["requested", "accepted"].includes(status)
  );
}

function formatStatus(status) {
  const map = {
    requested: "Finding a driver",
    accepted: "Driver accepted",
    arrived: "Driver has arrived",
    started: "Ride in progress",
    completed: "Ride completed",
    cancelled: "Ride cancelled"
  };

  return (
    map[String(status || "").toLowerCase()] ||
    status ||
    "Unknown"
  );
}

/* =========================================================
   REALTIME RIDE UPDATES
   ========================================================= */

function subscribeToRide(rideId) {
  if (rideChannel) {
    supabase.removeChannel(rideChannel);
  }

  rideChannel = supabase
    .channel(`rydo-ride-${rideId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "rides",
        filter: `id=eq.${rideId}`
      },
      (payload) => {
        currentRide = payload.new;
        showRide(payload.new);

        if (payload.new.status === "completed") {
          toast("Your ride is complete.", "success");
        }

        if (payload.new.status === "cancelled") {
          toast("Your ride was cancelled.", "error");
        }
      }
    )
    .subscribe();
}

/* =========================================================
   CANCEL RIDE
   ========================================================= */

async function cancelRide() {
  if (!currentRide?.id) return;

  const confirmed = confirm(
    "Are you sure you want to cancel this ride?"
  );

  if (!confirmed) return;

  try {
    const { error } = await supabase
      .from("rides")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: "Cancelled by passenger"
      })
      .eq("id", currentRide.id)
      .eq("passenger_id", currentUser.id);

    if (error) throw error;

    toast("Ride cancelled.");
    hideRide();
  } catch (error) {
    console.error(error);
    toast(
      error.message || "Could not cancel ride.",
      "error"
    );
  }
}

function hideRide() {
  currentRide = null;

  show("activeRide", false);
  show("rideCard", false);
  show("trackDriverBtn", false);

  if (rideChannel) {
    supabase.removeChannel(rideChannel);
    rideChannel = null;
  }
}

/* =========================================================
   TRACK DRIVER
   ========================================================= */

function openTracking() {
  if (!currentRide) {
    toast("No active ride.");
    return;
  }

  show("trackingPanel", true);
  show("trackingModal", true);

  text(
    "trackingStatus",
    formatStatus(currentRide.status)
  );

  loadDriverTracking();
}

function closeTracking() {
  show("trackingPanel", false);
  show("trackingModal", false);
}

async function loadDriverTracking() {
  if (!currentRide?.driver_id) {
    text(
      "trackingStatus",
      "Waiting for driver..."
    );
    return;
  }

  try {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", currentRide.driver_id)
      .maybeSingle();

    if (data) {
      text(
        "driverName",
        data.full_name || "Rydo Driver"
      );

      text(
        "driverPhone",
        data.phone || ""
      );
    }
  } catch (error) {
    console.warn("Driver profile:", error);
  }
}

/* =========================================================
   SOS
   ========================================================= */

function openSOS() {
  show("sosModal", true);
}

function closeSOS() {
  show("sosModal", false);
}

fun
