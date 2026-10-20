const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const searchInput = document.getElementById("member-search");
const filterToggle = document.getElementById("filter-toggle");
const filterPanel = document.getElementById("filter-panel");
const yearSelect = document.getElementById("filter-year");
const citySelect = document.getElementById("filter-city");
const memberList = document.getElementById("member-list");
const listCount = document.getElementById("list-count");
const statMapped = document.getElementById("stat-mapped");
const clockStrip = document.getElementById("clock-strip");
const titleText = document.getElementById("title-text");

const db = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let origin = BABSON_CAMPUS;
let members = [];
let visibleMembers = [];

const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  center: [BABSON_CAMPUS.lng, BABSON_CAMPUS.lat],
  zoom: 1.5,
  minZoom: 0.8,
  attributionControl: { compact: true },
});
// Slightly gentler wheel/trackpad zoom steps than the defaults (1/450 and 1/100) for smoother zooming.
map.scrollZoom.setWheelZoomRate(1 / 550);
map.scrollZoom.setZoomRate(1 / 130);
map.addControl(new maplibregl.NavigationControl(), "top-right");

const popup = new maplibregl.Popup({ offset: 12, closeButton: false, focusAfterOpen: false });

function toGeoJSON(members) {
  return {
    type: "FeatureCollection",
    features: members.map((m, index) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      properties: { index },
    })),
  };
}

// One point per distinct city, used for the city labels.
function citiesGeoJSON(members) {
  const cities = new Map();
  for (const m of members) {
    const key = `${m.city}|${m.country}`;
    if (!cities.has(key)) cities.set(key, m);
  }
  return {
    type: "FeatureCollection",
    features: [...cities.values()].map((m) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      properties: { city: m.city },
    })),
  };
}

function updateMapMembers(members) {
  visibleMembers = members;
  map.getSource("members")?.setData(toGeoJSON(members));
  map.getSource("member-cities")?.setData(citiesGeoJSON(members));
}

// Only http(s) links are rendered, so a profile can never inject a javascript: URL.
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function memberAvatar(m) {
  const avatar = document.createElement("div");
  avatar.className = "member-avatar";
  const src = m.image && safeUrl(m.image);
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    avatar.append(img);
  } else {
    avatar.textContent = initials(m.name);
  }
  return avatar;
}

// Built with DOM nodes rather than HTML so member-provided text is never parsed as markup.
function showPopup(m) {
  const content = document.createElement("div");
  content.className = "popup";

  const head = document.createElement("div");
  head.className = "popup-head";
  const text = document.createElement("div");
  const name = document.createElement("div");
  name.className = "popup-name";
  name.textContent = m.name;
  const meta = document.createElement("div");
  meta.className = "popup-meta";
  meta.textContent = `${m.city}, ${m.country} · ${m.year}`;
  text.append(name, meta);
  head.append(memberAvatar(m), text);
  content.append(head);

  if (m.headline) {
    const headline = document.createElement("div");
    headline.className = "popup-headline";
    headline.textContent = m.headline;
    content.append(headline);
  }

  const links = [
    ["LinkedIn", m.linkedin],
    ["Website", m.website],
  ].filter(([, url]) => url && safeUrl(url));
  if (links.length) {
    const row = document.createElement("div");
    row.className = "popup-links";
    for (const [label, url] of links) {
      const a = document.createElement("a");
      a.href = safeUrl(url);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = `${label} ↗`;
      row.append(a);
    }
    content.append(row);
  }

  popup.setLngLat([m.lng, m.lat]).setDOMContent(content).addTo(map);
}

// Only member cities get labels; country names appear once zoomed in.
const COUNTRY_LABEL_MIN_ZOOM = 4;

map.on("style.load", () => {
  map.setProjection({ type: "globe" });

  for (const layer of map.getStyle().layers) {
    if (!layer.id.startsWith("place_")) continue;
    if (layer.id.startsWith("place_country")) {
      map.setLayerZoomRange(layer.id, Math.max(layer.minzoom ?? 0, COUNTRY_LABEL_MIN_ZOOM), layer.maxzoom ?? 24);
    } else {
      map.removeLayer(layer.id);
    }
  }
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
      "circle-color": "#a855f7",
      "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#000",
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
    paint: { "text-color": "#000" },
  });

  map.addLayer({
    id: "member-points",
    type: "circle",
    source: "members",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#00c853",
      "circle-radius": 6,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#000",
    },
  });

  map.addSource("member-cities", { type: "geojson", data: citiesGeoJSON(visibleMembers) });

  map.addLayer({
    id: "member-city-labels",
    type: "symbol",
    source: "member-cities",
    layout: {
      "text-field": ["get", "city"],
      "text-font": ["Montserrat Medium"],
      "text-size": 11,
      "text-transform": "uppercase",
      "text-letter-spacing": 0.15,
      "text-anchor": "top",
      "text-offset": [0, 1.3],
    },
    paint: {
      "text-color": "#d8b4fe",
      "text-halo-color": "#000",
      "text-halo-width": 1.5,
    },
  });
});

// Keep the map's focal point in the area the floating sidebar doesn't cover,
// so the globe and fly-to targets center in the visible space.
const sidebarDocked = matchMedia("(max-width: 720px)");

function updateMapPadding() {
  const panel = sidebar.getBoundingClientRect();
  const area = map.getContainer().getBoundingClientRect();
  map.setPadding(
    sidebarDocked.matches
      ? { top: 0, right: 0, left: 0, bottom: Math.max(0, area.bottom - panel.top) }
      : { top: 0, right: 0, bottom: 0, left: Math.max(0, panel.right - area.left) }
  );
}
new ResizeObserver(updateMapPadding).observe(sidebar);
new ResizeObserver(updateMapPadding).observe(map.getContainer());

map.on("click", "clusters", async (e) => {
  const cluster = e.features[0];
  const zoom = await map.getSource("members").getClusterExpansionZoom(cluster.properties.cluster_id);
  map.easeTo({ center: cluster.geometry.coordinates, zoom, duration: 900 });
});

map.on("click", "member-points", (e) => {
  showPopup(visibleMembers[e.features[0].properties.index]);
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

// Rebuilds the filter options after each load, keeping the current choice when it still exists.
function populateFilters() {
  const years = [...new Set(members.map((m) => String(m.year)))].sort();
  const cities = [...new Set(members.map((m) => m.city))].sort();
  for (const [select, values] of [
    [yearSelect, years],
    [citySelect, cities],
  ]) {
    const current = select.value;
    select.length = 1;
    for (const value of values) select.add(new Option(value, value));
    select.value = values.includes(current) ? current : "";
  }
}

async function loadMembers() {
  const { data, error } = await db
    .from("profiles")
    .select("id, name, year, city, country, lat, lng, headline, linkedin_url, website_url, image_url");
  if (error) {
    console.error("Could not load members:", error.message);
    return;
  }
  members = data.map((p) => ({
    id: p.id,
    name: p.name,
    year: p.year,
    city: p.city,
    country: p.country,
    lat: p.lat,
    lng: p.lng,
    headline: p.headline,
    linkedin: p.linkedin_url,
    website: p.website_url,
    image: p.image_url,
  }));
  populateFilters();
  renderMembers();
}

function renderMembers() {
  const query = searchInput.value.trim().toLowerCase();
  const year = yearSelect.value;
  const city = citySelect.value;

  const rows = members.filter(
    (m) =>
      (!query || m.name.toLowerCase().includes(query) || m.city.toLowerCase().includes(query)) &&
      (!year || String(m.year) === year) &&
      (!city || m.city === city)
  )
    .map((m) => ({ ...m, distance: distanceMiles(origin, m) }))
    .sort((a, b) => a.distance - b.distance);

  updateMapMembers(rows);
  listCount.textContent = rows.length;
  statMapped.textContent = rows.length;
  memberList.replaceChildren();

  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "member-empty";
    empty.textContent = members.length ? "No members found" : "No one yet. Join the map!";
    memberList.append(empty);
    return;
  }

  for (const m of rows) {
    const li = document.createElement("li");
    li.className = "member";
    li.addEventListener("click", () => {
      map.flyTo({ center: [m.lng, m.lat], zoom: 10, speed: 0.9, curve: 1.6, essential: true });
      showPopup(m);
    });

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

    li.append(memberAvatar(m), info, dist);
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

// Header: types "Where is CODE?" one word at a time with a character scramble, then erases and repeats.
const TITLE_WORDS = [
  { text: "Where", className: "" },
  { text: "is", className: "" },
  { text: "CODE", className: "title-accent" },
  { text: "?", className: "title-mark" },
];
const SCRAMBLE_CHARS = "!<>-_/\\[]{}=+*^#01";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function titleWord(word) {
  const span = document.createElement("span");
  span.className = `title-word ${word.className}`;
  titleText.append(span);
  return span;
}

async function typeWord(word) {
  const span = titleWord(word);
  for (let i = 0; i < word.text.length; i++) {
    for (let frame = 0; frame < 4; frame++) {
      const glyph = SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      span.textContent = word.text.slice(0, i) + glyph;
      await sleep(35);
    }
    span.textContent = word.text.slice(0, i + 1);
  }
}

async function eraseWord(span) {
  while (span.textContent) {
    span.textContent = span.textContent.slice(0, -1);
    await sleep(45);
  }
  span.remove();
}

async function animateTitle() {
  for (;;) {
    for (const word of TITLE_WORDS) {
      await typeWord(word);
      await sleep(220);
    }
    await sleep(3200);
    for (const span of [...titleText.children].reverse()) {
      await eraseWord(span);
      await sleep(120);
    }
    await sleep(500);
  }
}

if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  for (const word of TITLE_WORDS) titleWord(word).textContent = word.text;
} else {
  animateTitle();
}

// World clocks. A green dot marks local business hours (Mon–Fri, 9:00–17:00).
const WORLD_CLOCKS = [
  { label: "SFO", zone: "America/Los_Angeles" },
  { label: "NYC", zone: "America/New_York" },
  { label: "LON", zone: "Europe/London" },
  { label: "PAR", zone: "Europe/Paris" },
  { label: "DXB", zone: "Asia/Dubai" },
  { label: "HKG", zone: "Asia/Hong_Kong" },
  { label: "TYO", zone: "Asia/Tokyo" },
];

const clocks = WORLD_CLOCKS.map(({ label, zone }) => {
  const item = document.createElement("div");
  item.className = "clock";
  const dot = document.createElement("span");
  dot.className = "clock-dot";
  const name = document.createElement("span");
  name.className = "clock-label";
  name.textContent = label;
  const time = document.createElement("span");
  time.className = "clock-time";
  item.append(dot, name, time);
  clockStrip.append(item);
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return { item, time, format };
});

function updateClocks() {
  const now = new Date();
  for (const { item, time, format } of clocks) {
    const parts = Object.fromEntries(format.formatToParts(now).map((p) => [p.type, p.value]));
    const hour = Number(parts.hour);
    time.textContent = `${parts.hour}:${parts.minute}:${parts.second}`;
    item.classList.toggle("open", !["Sat", "Sun"].includes(parts.weekday) && hour >= 9 && hour < 17);
  }
}
setInterval(updateClocks, 1000);
updateClocks();

renderMembers();
loadMembers();
