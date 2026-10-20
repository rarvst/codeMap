// Click a country, state or city to outline it, zoom to it and list the members there.
// Boundaries come from OpenStreetMap's Nominatim service: at most one request a second, cached.
const regionBar = document.getElementById("region-bar");
const regionName = document.getElementById("region-name");
const regionCount = document.getElementById("region-count");
const regionClose = document.getElementById("region-close");
const regionLevelButtons = [...document.querySelectorAll("[data-region-level]")];
const mapHint = document.getElementById("map-hint");

const NEARBY_KM = 50; // city view also lists members this close to the city center (metro areas)
const REGION_LEVELS = ["country", "state", "city"];
const NOMINATIM_ZOOM = { country: 3, state: 5, city: 10 };
const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

const regionCache = new Map();
let lastLookupAt = 0;
let lookupToken = 0;
let regionPoint = null; // [lng, lat] of the click that chose the current area

function levelForZoom(zoom) {
  if (zoom < 3) return "country";
  if (zoom < 5.5) return "state";
  return "city";
}

function polygonsOf(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point, geometry) {
  return polygonsOf(geometry).some(([outer, ...holes]) => pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole)));
}

function bboxOf(polygons) {
  let [west, south, east, north] = [180, 90, -180, -90];
  for (const [outer] of polygons) {
    for (const [x, y] of outer) {
      west = Math.min(west, x);
      south = Math.min(south, y);
      east = Math.max(east, x);
      north = Math.max(north, y);
    }
  }
  return [west, south, east, north];
}

// Countries like the US span the antimeridian (Alaska's islands); zoom to the clicked part instead of the whole world.
function focusBbox(geometry, point) {
  const polygons = polygonsOf(geometry);
  const all = bboxOf(polygons);
  if (all[2] - all[0] <= 180) return all;
  const area = ([w, s, e, n]) => (e - w) * (n - s);
  const clicked = polygons.find(([outer]) => pointInRing(point, outer));
  const largest = polygons.reduce((best, p) => (area(bboxOf([p])) > area(bboxOf([best])) ? p : best));
  return bboxOf([clicked ?? largest]);
}

// Some places come back as a single point; treat them as a small circle so they can still be outlined.
function circlePolygon([lng, lat], km) {
  const ring = [];
  for (let i = 0; i <= 48; i++) {
    const angle = (i / 48) * 2 * Math.PI;
    ring.push([lng + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(angle), lat + (km / 110.57) * Math.sin(angle)]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

function signedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return sum;
}

// A world-sized polygon with the selected area cut out, used to dim everything else.
// MapLibre tells holes apart by winding order, so each hole is wound opposite to the outer ring.
function maskGeoJSON(region) {
  if (!region) return EMPTY_COLLECTION;
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const worldSign = Math.sign(signedArea(world));
  const holes = polygonsOf(region.geometry).map(([outer]) =>
    Math.sign(signedArea(outer)) === worldSign ? [...outer].reverse() : outer
  );
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...holes] } }],
  };
}

function regionGeoJSON(region) {
  if (!region) return EMPTY_COLLECTION;
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: region.geometry }] };
}

// Called from app.js on every style load, below the member layers.
function addRegionLayers(colors) {
  map.addSource("region-mask", { type: "geojson", data: maskGeoJSON(activeRegion) });
  map.addSource("region", { type: "geojson", data: regionGeoJSON(activeRegion) });
  map.addLayer({ id: "region-mask", type: "fill", source: "region-mask", paint: { "fill-color": colors.mask } });
  map.addLayer({ id: "region-fill", type: "fill", source: "region", paint: { "fill-color": "#a855f7", "fill-opacity": 0.12 } });
  map.addLayer({ id: "region-line", type: "line", source: "region", paint: { "line-color": "#00c853", "line-width": 2 } });
}

async function lookupRegion([lng, lat], level) {
  const key = `${level}:${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (regionCache.has(key)) return regionCache.get(key);

  const wait = lastLookupAt + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastLookupAt = Date.now();

  const params = new URLSearchParams({
    format: "geojson",
    polygon_geojson: "1",
    polygon_threshold: level === "country" ? "0.02" : "0.003",
    zoom: String(NOMINATIM_ZOOM[level]),
    lat: String(lat),
    lon: String(lng),
    "accept-language": "en",
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
  if (!res.ok) throw new Error(`Boundary lookup failed (${res.status})`);
  const feature = (await res.json()).features?.[0];

  let region = null;
  if (feature) {
    const point = [lng, lat];
    const geometry = polygonsOf(feature.geometry).length ? feature.geometry : circlePolygon(point, 10);
    const [west, south, east, north] = focusBbox(geometry, point);
    region = {
      level,
      name: feature.properties.name || feature.properties.display_name,
      geometry,
      bbox: [west, south, east, north],
      center: { lng: (west + east) / 2, lat: (south + north) / 2 },
    };
  }
  regionCache.set(key, region);
  return region;
}

// Members inside the area first; in city view, members just outside it follow as "nearby".
function regionMembers(rows) {
  const inside = [];
  const nearby = [];
  for (const m of rows) {
    if (pointInGeometry([m.lng, m.lat], activeRegion.geometry)) inside.push(m);
    else if (activeRegion.level === "city" && distanceMiles(activeRegion.center, m) * 1.609 <= NEARBY_KM) nearby.push({ ...m, nearby: true });
  }
  activeRegion.insideCount = inside.length;
  return [...inside, ...nearby];
}

function renderRegionBar(statusText) {
  regionBar.hidden = false;
  regionName.textContent = statusText ?? activeRegion?.name ?? "";
  regionCount.textContent = statusText || !activeRegion ? "" : `${activeRegion.insideCount ?? 0} here`;
  for (const button of regionLevelButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.regionLevel === activeRegion?.level));
  }
}

function setRegion(region) {
  activeRegion = region;
  map.getSource("region")?.setData(regionGeoJSON(region));
  map.getSource("region-mask")?.setData(maskGeoJSON(region));
  renderMembers();
  if (region) renderRegionBar();
  else regionBar.hidden = true;
}

function clearRegion() {
  lookupToken++;
  setRegion(null);
}

async function showRegion(point, level) {
  const token = ++lookupToken;
  regionPoint = point;
  renderRegionBar("Looking up…");
  let region = null;
  try {
    region = await lookupRegion(point, level);
  } catch (err) {
    console.error(err);
  }
  if (token !== lookupToken) return; // a newer click took over

  if (!region) return clearRegion(); // e.g. clicked the ocean
  mapHint.hidden = true;
  popup.remove();
  if (sidebar.classList.contains("collapsed")) sidebarToggle.click();
  setRegion(region);
  map.fitBounds(region.bbox, { padding: 48, maxZoom: 11, duration: 1200, essential: true });
}

function selectRegionAt(lngLat, forcedLevel) {
  const point = [lngLat.lng, lngLat.lat];
  let level = forcedLevel ?? levelForZoom(map.getZoom());
  // Clicking inside the selected area drills down a level: country → state → city.
  if (!forcedLevel && activeRegion && pointInGeometry(point, activeRegion.geometry)) {
    const deeper = REGION_LEVELS[REGION_LEVELS.indexOf(activeRegion.level) + 1];
    if (!deeper) return;
    level = deeper;
  }
  showRegion(point, level);
}

for (const button of regionLevelButtons) {
  button.addEventListener("click", () => {
    if (regionPoint && button.dataset.regionLevel !== activeRegion?.level) showRegion(regionPoint, button.dataset.regionLevel);
  });
}

regionClose.addEventListener("click", clearRegion);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && activeRegion) clearRegion();
});
