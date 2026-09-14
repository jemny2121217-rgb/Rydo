import { supabase } from "./supabase.js";

/*
  Rydo V1 - Admin Panel
  Uses the existing Supabase project and database structure.
*/

const state = {
  currentUser: null,
  currentDriver: null,
  currentVehicle: null,
  currentRide: null,
  rides: [],
  rideFilter: "all",
  confirmAction: null
};


/* =========================================================
   HELPERS
========================================================= */

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value) {
  const number = Number(value || 0);

  return `NPR ${number.toLocaleString("en-NP", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
}

function dateTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString();
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();

  if (
    value === "completed" ||
    value === "approved" ||
    value === "active"
  ) {
    return "success";
  }

  if (
    value === "requested" ||
    value === "accepted" ||
    value === "pending"
  ) {
    return "warning";
  }

  if (
    value === "cancelled" ||
    value === "rejected"
  ) {
    return "danger";
  }

  if (
    value === "started" ||
    value === "arrived"
  ) {
    return "info";
  }

  return "neutral";
}

function statusBadge(status) {
  const safeStatus = escapeHtml(status || "unknown");

  return `
    <span class="badge ${statusClass(status)}">
      ${safeStatus.toUpperCase()}
    </span>
  `;
}

function showToast(title, message, type = "success") {
  const toast = $("adminToast");
  const icon = $("adminToastIcon");

  if (!toast) return;

  $("adminToastTitle").textContent = title;
  $("adminToastMessage").textContent = message;

  if (type === "error") {
    icon.textContent = "!";
  } else {
    icon.textContent = "✓";
  }

  toast.classList.remove("hidden");

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 4500);
}

function closeModal(id) {
  const modal = $(id);

  if (modal) {
    modal.classList.add("hidden");
  }
}

function openModal(id) {
  const modal = $(id);

  if (modal) {
    modal.classList.remove("hidden");
  }
}

function setButtonLoading(button, loading, loadingText = "Saving...") {
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = loadingText;
  } else {
    button.disabled = false;
    button.textContent =
      button.dataset.originalText || button.textContent;
  }
}


/* =========================================================
   AUTHORIZATION
========================================================= */

async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}

async function getCurrentProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function verifyAdmin(user) {
  if (!user) {
    return false;
  }

  const profile = await getCurrentProfile(user.id);

  if (!profile) {
    throw new Error(
      "Your account does not have a Rydo profile."
    );
  }

  if (String(profile.role).toLowerCase() !== "admin") {
    throw new Error(
      "Access denied. This account is not an authorized Rydo administrator."
    );
  }

  return true;
}

async function showAdminApp(user) {
  state.currentUser = user;

  $("adminAuth").classList.add("hidden");
  $("adminApp").classList.remove("hidden");

  $("loggedAdminEmail").textContent =
    user.email || "Authorized administrator";

  setSystemStatus(true, "Connected");

  await loadEverything();
}

function showLoginPage() {
  $("adminApp").classList.add("hidden");
  $("adminAuth").classList.remove("hidden");

  state.currentUser = null;
}

function setSystemStatus(connected, text) {
  const dot = $("systemStatusDot");
  const label = $("systemStatusText");

  if (!dot || !label) return;

  label.textContent = text;

  if (connected) {
    dot.style.background = "var(--success)";
  } else {
    dot.style.background = "var(--danger)";
  }
}


/* =========================================================
   LOGIN / LOGOUT
========================================================= */

async function loginAdmin(event) {
  event.preventDefault();

  const email = $("adminEmail").value.trim();
  const password = $("adminPassword").value;

  const button = $("adminLoginBtn");
  const message = $("adminLoginMessage");

  if (!email || !password) {
    message.textContent = "Enter your email and password.";
    return;
  }

  setButtonLoading(button, true, "Checking...");

  message.textContent = "";

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new Error("Login failed.");
    }

    try {
      await verifyAdmin(data.user);
    } catch (authorizationError) {
      await supabase.auth.signOut();
      throw authorizationError;
    }

    message.textContent = "";

    await showAdminApp(data.user);

  } catch (error) {
    console.error("Admin login error:", error);

    message.textContent =
      error.message || "Unable to sign in.";

    showToast(
      "Login failed",
      error.message || "Unable to sign in.",
      "error"
    );
  } finally {
    setButtonLoading(button, false);
  }
}

async function logout() {
  await supabase.auth.signOut();
  showLoginPage();
}


/* =========================================================
   DASHBOARD
========================================================= */

async function loadDashboard() {
  try {
    const [
      ridesResult,
      driversResult,
      usersResult
    ] = await Promise.all([
      supabase
        .from("rides")
        .select(
          "id,status,fare,driver_earnings,admin_earnings,payment_method,payment_status,created_at"
        ),

      supabase
        .from("profiles")
        .select("id,role,is_verified,is_online"),

      supabase
        .from("profiles")
        .select("id,role")
    ]);

    if (ridesResult.error) throw ridesResult.error;
    if (driversResult.error) throw driversResult.error;
    if (usersResult.error) throw usersResult.error;

    const rides = ridesResult.data || [];
    const profiles = driversResult.data || [];
    const users = usersResult.data || [];

    const activeStatuses = [
      "requested",
      "accepted",
      "arrived",
      "started"
    ];

    const activeRides = rides.filter((ride) =>
      activeStatuses.includes(String(ride.status || "").toLowerCase())
    ).length;

    const completedRides = rides.filter(
      (ride) =>
        String(ride.status || "").toLowerCase() === "completed"
    ).length;

    const cancelledRides = rides.filter(
      (ride) =>
        String(ride.status || "").toLowerCase() === "cancelled"
    ).length;

    const drivers = profiles.filter(
      (profile) =>
        String(profile.role || "").toLowerCase() === "driver"
    );

    const passengers = users.filter(
      (profile) =>
        String(profile.role || "").toLowerCase() === "passenger"
    );

    const platformEarnings = rides.reduce(
      (sum, ride) => sum + Number(ride.admin_earnings || 0),
      0
    );

    const driverEarnings = rides.reduce(
      (sum, ride) => sum + Number(ride.driver_earnings || 0),
      0
    );

    $("totalRides").textContent = rides.length;
    $("activeRides").textContent = activeRides;
    $("completedRides").textContent = completedRides;
    $("cancelledRides").textContent = cancelledRides;

    $("totalDrivers").textContent = drivers.length;
    $("totalUsers").textContent = users.length;

    $("platformEarnings").textContent = money(platformEarnings);
    $("driverEarnings").textContent = money(driverEarnings);

    $("pendingDrivers").textContent =
      drivers.filter((driver) => !driver.is_verified).length;

    $("verifiedDrivers").textContent =
      drivers.filter((driver) => driver.is_verified).length;

    $("onlineDrivers").textContent =
      drivers.filter((driver) => driver.is_online).length;

    $("usersTotal").textContent = users.length;
    $("passengerCount").textContent = passengers.length;
    $("driverCount").textContent = drivers.length;

    $("verifiedDriverCount").textContent =
      drivers.filter((driver) => driver.is_verified).length;

    updatePaymentSummary(rides);

  } catch (error) {
    console.error("Dashboard error:", error);

    showToast(
      "Dashboard error",
      error.message || "Could not load dashboard.",
      "error"
    );
  }
}

function updatePaymentSummary(rides) {
  const cash = rides.filter(
    (ride) =>
      String(ride.payment_method || "").toLowerCase() === "cash"
  );

  const online = rides.filter(
    (ride) =>
      String(ride.payment_method || "").toLowerCase() === "online"
  );

  const paidOnline = online.filter(
    (ride) =>
      String(ride.payment_status || "").toLowerCase() === "paid"
  );

  const pendingOnline = online.filter(
    (ride) =>
      !["paid", "completed"].includes(
        String(ride.payment_status || "").toLowerCase()
      )
  );

  const paidAmount = paidOnline.reduce(
    (sum, ride) => sum + Number(ride.fare || 0),
    0
  );

  const pendingAmount = pendingOnline.reduce(
    (sum, ride) => sum + Number(ride.fare || 0),
    0
  );

  $("cashRides").textContent = cash.length;
  $("onlineRides").textContent = online.length;
  $("onlinePaid").textContent = money(paidAmount);
  $("onlinePending").textContent = money(pendingAmount);
}


/* =========================================================
   DRIVER MANAGEMENT
========================================================= */

async function loadDrivers() {
  const container = $("driversList");

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id,full_name,phone,role,is_online,is_verified,created_at"
      )
      .eq("role", "driver")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const drivers = data || [];

    $("pendingDrivers").textContent =
      drivers.filter((driver) => !driver.is_verified).length;

    $("verifiedDrivers").textContent =
      drivers.filter((driver) => driver.is_verified).length;

    $("onlineDrivers").textContent =
      drivers.filter((driver) => driver.is_online).length;

    if (!drivers.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">👤</div>
          <h3>No drivers registered</h3>
          <p>Driver registrations will appear here.</p>
        </div>
      `;

      return;
    }

    container.innerHTML = drivers
      .map((driver) => {
        const verification = driver.is_verified
          ? statusBadge("approved")
          : statusBadge("pending");

        const online = driver.is_online
          ? `<span class="badge success">ONLINE</span>`
          : `<span class="badge neutral">OFFLINE</span>`;

        return `
          <article class="data-card">

            <div class="data-card-header">

              <div class="data-card-title">
                <h3>
                  ${escapeHtml(driver.full_name || "Unnamed Driver")}
                </h3>

                <p>
                  ${escapeHtml(driver.phone || "No phone")}
                </p>
              </div>

              <div>
                ${verification}
                ${online}
              </div>

            </div>

            <div class="data-card-body">

              <div class="data-field">
                <span>Driver ID</span>
                <strong>${escapeHtml(driver.id)}</strong>
              </div>

              <div class="data-field">
                <span>Phone</span>
                <strong>${escapeHtml(driver.phone || "—")}</strong>
              </div>

              <div class="data-field">
                <span>Status</span>
                <strong>
                  ${driver.is_verified ? "Verified" : "Pending"}
                </strong>
              </div>

              <div class="data-field">
                <span>Registered</span>
                <strong>${escapeHtml(dateTime(driver.created_at))}</strong>
              </div>

            </div>

            <div class="data-card-actions">

              <button
                class="small-btn"
                data-action="view-driver"
                data-id="${escapeHtml(driver.id)}"
              >
                View
              </button>

              ${
                driver.is_verified
                  ? `
                    <button
                      class="danger-btn"
                      data-action="reject-driver"
                      data-id="${escapeHtml(driver.id)}"
                    >
                      Reject
                    </button>
                  `
                  : `
                    <button
                      class="primary-btn"
                      data-action="approve-driver"
                      data-id="${escapeHtml(driver.id)}"
                    >
                      Approve
                    </button>
                  `
              }

            </div>

          </article>
        `;
      })
      .join("");

  } catch (error) {
    console.error("Drivers error:", error);

    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Unable to load drivers</h3>
        <p>${escapeHtml(error.message || "Database error")}</p>
      </div>
    `;
  }
}

async function approveDriver(driverId) {
  try {
    const { error } = await supabase
      .from("profiles")
      .update({
        is_verified: true
      })
      .eq("id", driverId)
      .eq("role", "driver");

    if (error) throw error;

    showToast(
      "Driver approved",
      "The driver has been marked as verified."
    );

    closeModal("driverModal");

    await loadDrivers();
    await loadVehicles();
    await loadDashboard();

  } catch (error) {
    console.error("Approve driver error:", error);

    showToast(
      "Approval failed",
      error.message || "Could not approve driver.",
      "error"
    );
  }
}

async function rejectDriver(driverId) {
  try {
    const { error } = await supabase
      .from("profiles")
      .update({
        is_verified: false,
        is_online: false
      })
      .eq("id", driverId)
      .eq("role", "driver");

    if (error) throw error;

    showToast(
      "Driver rejected",
      "The driver has been marked as unverified."
    );

    closeModal("driverModal");

    await loadDrivers();
    await loadDashboard();

  } catch (error) {
    console.error("Reject driver error:", error);

    showToast(
      "Action failed",
      error.message || "Could not reject driver.",
      "error"
    );
  }
}

async function removeDriver(driverId) {
  try {
    /*
      Delete vehicles first because vehicles reference driver_id.
      If rides still reference the driver and your database does not
      use ON DELETE CASCADE, Supabase may correctly refuse deletion.
    */

    const { error: vehicleError } = await supabase
      .from("vehicles")
      .delete()
      .eq("driver_id", driverId);

    if (vehicleError) {
      throw vehicleError;
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", driverId)
      .eq("role", "driver");

    if (profileError) {
      throw profileError;
    }

    showToast(
      "Driver removed",
      "The driver profile was removed."
    );

    closeModal("driverModal");

    await loadDrivers();
    await loadVehicles();
    await loadDashboard();

  } catch (error) {
    console.error("Remove driver error:", error);

    showToast(
      "Driver not removed",
      error.message ||
        "The driver may still be referenced by existing rides.",
      "error"
    );
  }
}

async function viewDriver(driverId) {
  try {
    const { data: driver, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", driverId)
      .eq("role", "driver")
      .maybeSingle();

    if (error) throw error;

    if (!driver) {
      throw new Error("Driver not found.");
    }

    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("*")
      .eq("driver_id", driverId)
      .maybeSingle();

    state.currentDriver = driver;
    state.currentVehicle = vehicle || null;

    $("driverModalContent").innerHTML = `
      <div class="modal-content-grid">

        <div class="modal-detail">
          <span>Full Name</span>
          <strong>${escapeHtml(driver.full_name || "—")}</strong>
        </div>

        <div class="modal-detail">
          <span>Phone</span>
          <strong>${escapeHtml(driver.phone || "—")}</strong>
        </div>

        <div class="modal-detail">
          <span>Email</span>
          <strong>${escapeHtml(driver.email || "Not stored in profile")}</strong>
        </div>

        <div class="modal-detail">
          <span>Driver ID</span>
          <strong>${escapeHtml(driver.id)}</strong>
        </div>

        <div class="modal-detail">
          <span>Verification</span>
          <strong>
            ${driver.is_verified ? "Verified" : "Not verified"}
          </strong>
        </div>

        <div class="modal-detail">
          <span>Online</span>
          <strong>
            ${driver.is_online ? "Online" : "Offline"}
          </strong>
        </div>

        ${
          vehicle
            ? `
              <div class="modal-detail">
                <span>Vehicle Type</span>
                <strong>${escapeHtml(vehicle.vehicle_type || "—")}</strong>
              </div>

              <div class="modal-detail">
                <span>Vehicle Number</span>
                <strong>${escapeHtml(vehicle.vehicle_number || "—")}</strong>
              </div>

              <div class="modal-detail">
                <span>Vehicle Model</span>
                <strong>${escapeHtml(vehicle.model || "—")}</strong>
              </div>

              <div class="modal-detail">
                <span>Vehicle Approval</span>
                <strong>
                  ${vehicle.is_approved ? "Approved" : "Not approved"}
                </strong>
              </div>
            `
            : `
              <div class="modal-detail">
                <span>Vehicle</span>
                <strong>No vehicle registered</strong>
              </div>
            `
        }

      </div>
    `;

    $("approveDriverModalBtn").style.display =
      driver.is_verified ? "none" : "block";

    $("rejectDriverModalBtn").style.display =
      driver.is_verified ? "block" : "none";

    openModal("driverModal");

  } catch (error) {
    console.error("View driver error:", error);

    showToast(
      "Unable to open driver",
      error.message || "Could not load driver.",
      "error"
    );
  }
}


/* =========================================================
   VEHICLE MANAGEMENT
========================================================= */

async function loadVehicles() {
  const container = $("vehiclesList");

  try {
    const { data, error } = await supabase
      .from("vehicles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const vehicles = data || [];

    if (!vehicles.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🚗</div>
   
