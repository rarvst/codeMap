const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const searchInput = document.getElementById("member-search");
const filterToggle = document.getElementById("filter-toggle");
const filterPanel = document.getElementById("filter-panel");
const yearSelect = document.getElementById("filter-year");
const citySelect = document.getElementById("filter-city");
const memberList = document.getElementById("member-list");

let origin = BABSON_CAMPUS;
let visibleMembers = [];

const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  center: [BABSON_CAMPUS.lng, BABSON_CAMPUS.lat],
  zoom: 1.5,
});
map.addControl(new maplibregl.NavigationControl(), "top-right");

const popup = new maplibregl.Popup({ offset: 12, closeButton: false });

function toGeoJSON(members) {
  return {
    type: "FeatureCollection",
    features: members.map((m) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      properties: { name: m.name, city: m.city, year: m.year, lat: m.lat, lng: m.lng },
    })),
  };
}

function updateMapMembers(members) {
  visibleMembers = members;
  map.getSource("members")?.setData(toGeoJSON(members));
}

// Built with DOM nodes rather than HTML so member-provided text is never parsed as markup.
function showPopup(m) {
  const content = document.createElement("div");
  const name = document.createElement("div");
  name.className = "popup-name";
  name.textContent = m.name;
  const meta = document.createElement("div");
  meta.className = "popup-meta";
  meta.textContent = `${m.city} · ${m.year}`;
  content.append(name, meta);
  popup.setLngLat([m.lng, m.lat]).setDOMContent(content).addTo(map);
}

map.on("style.load", () => {
  map.setProjection({ type: "globe" });
});

map.on("load", () => {
  // Clustering merges members in the same city into one numbered dot until zoomed in.
  map.addSource("members", {
    type: "geojson",
    data: toGeoJSON(visibleMembers),
    cluster: true,
    clusterRadius: 40,
  });

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "members",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#00c853",
      "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#0a0a0a",
    },
  });

  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "members",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Montserrat Medium"],
      "text-size": 12,
    },
    paint: { "text-color": "#0a0a0a" },
  });

  map.addLayer({
    id: "member-points",
    type: "circle",
    source: "members",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#00c853",
      "circle-radius": 7,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#fff",
    },
  });
});

map.on("click", "clusters", async (e) => {
  const cluster = e.features[0];
  const zoom = await map.getSource("members").getClusterExpansionZoom(cluster.properties.cluster_id);
  map.easeTo({ center: cluster.geometry.coordinates, zoom });
});

map.on("click", "member-points", (e) => {
  showPopup(e.features[0].properties);
});

for (const layer of ["clusters", "member-points"]) {
  map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
}

// Great-circle distance in miles.
function distanceMiles(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

function initials(name) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function populateFilters() {
  const years = [...new Set(MEMBERS.map((m) => m.year))].sort();
  const cities = [...new Set(MEMBERS.map((m) => m.city))].sort();
  for (const year of years) yearSelect.add(new Option(year, year));
  for (const city of cities) citySelect.add(new Option(city, city));
}

function renderMembers() {
  const query = searchInput.value.trim().toLowerCase();
  const year = yearSelect.value;
  const city = citySelect.value;

  const rows = MEMBERS.filter(
    (m) =>
      (!query || m.name.toLowerCase().includes(query) || m.city.toLowerCase().includes(query)) &&
      (!year || String(m.year) === year) &&
      (!city || m.city === city)
  )
    .map((m) => ({ ...m, distance: distanceMiles(origin, m) }))
    .sort((a, b) => a.distance - b.distance);

  updateMapMembers(rows);
  memberList.replaceChildren();

  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "member-empty";
    empty.textContent = "No members found";
    memberList.append(empty);
    return;
  }

  for (const m of rows) {
    const li = document.createElement("li");
    li.className = "member";
    li.addEventListener("click", () => {
      map.flyTo({ center: [m.lng, m.lat], zoom: 10 });
      showPopup(m);
    });

    const avatar = document.createElement("div");
    avatar.className = "member-avatar";
    if (m.image) {
      const img = document.createElement("img");
      img.src = m.image;
      img.alt = "";
      avatar.append(img);
    } else {
      avatar.textContent = initials(m.name);
    }

    const info = document.createElement("div");
    info.className = "member-info";
    const name = document.createElement("div");
    name.className = "member-name";
    name.textContent = m.name;
    const meta = document.createElement("div");
    meta.className = "member-meta";
    meta.textContent = `${m.city} · ${m.year}`;
    info.append(name, meta);

    const dist = document.createElement("div");
    dist.className = "member-distance";
    dist.textContent = `${m.distance.toFixed(1)} mi`;

    li.append(avatar, info, dist);
    memberList.append(li);
  }
}

sidebarToggle.addEventListener("click", () => {
  const collapsed = sidebar.classList.toggle("collapsed");
  sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  sidebarToggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} members sidebar`);
  sidebarToggle.innerHTML = collapsed ? "&#x203A;" : "&#x2039;";
});

filterToggle.addEventListener("click", () => {
  filterPanel.hidden = !filterPanel.hidden;
  filterToggle.setAttribute("aria-expanded", String(!filterPanel.hidden));
});

document.addEventListener("click", (e) => {
  if (!filterPanel.hidden && !e.target.closest(".filter")) {
    filterPanel.hidden = true;
    filterToggle.setAttribute("aria-expanded", "false");
  }
});

searchInput.addEventListener("input", renderMembers);
yearSelect.addEventListener("change", renderMembers);
citySelect.addEventListener("change", renderMembers);

// Measure distances from the viewer's location when allowed, like Find My.
if ("geolocation" in navigator) {
  navigator.geolocation.getCurrentPosition((pos) => {
    origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    renderMembers();
  });
}

populateFilters();
renderMembers();
