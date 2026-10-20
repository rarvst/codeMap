// Map tools: a class-year timeline and a member-density heatmap.
const timeline = document.getElementById("timeline");
const timelineValue = document.getElementById("timeline-value");
const timelinePlay = document.getElementById("timeline-play");
const heatToggle = document.getElementById("heat-toggle");
const heatMeasure = document.getElementById("heat-measure");
const heatValue = document.getElementById("heat-value");
const heatLegend = document.getElementById("heat-legend");

const MEMBER_LAYERS = ["clusters", "cluster-count", "member-points"];
let heatOn = false;
let playTimer = null;

// Timeline: slide from the oldest class to the newest; the map and list show everyone up to that class.
function showTimelineValue() {
  const min = Number(timeline.min);
  timelineValue.textContent = timeline.disabled ? "—" : timelineYear === null ? `All (${min}–${timeline.max})` : `${min}–${timelineYear}`;
}

function setTimelineYear(year) {
  timelineYear = year >= Number(timeline.max) ? null : year;
  timeline.value = String(year);
  showTimelineValue();
  applyFilters();
}

// Called after members load: fit the slider to the class years present, keeping the chosen year if it still fits.
function refreshTools() {
  const years = members.map((m) => m.year).filter(Number.isFinite);
  timeline.disabled = years.length === 0 || Math.min(...years) === Math.max(...years);
  timelinePlay.disabled = timeline.disabled;
  if (years.length) {
    timeline.min = String(Math.min(...years));
    timeline.max = String(Math.max(...years));
    if (timelineYear !== null && (timelineYear < Number(timeline.min) || timelineYear >= Number(timeline.max))) timelineYear = null;
    timeline.value = String(timelineYear ?? timeline.max);
  }
  showTimelineValue();
  refreshHeatValues();
}

function stopPlaying() {
  clearInterval(playTimer);
  playTimer = null;
  timelinePlay.textContent = "▶";
  timelinePlay.setAttribute("aria-label", "Play timeline");
}

// Play steps through the classes from the oldest, one a second, ending with everyone shown.
timelinePlay.addEventListener("click", () => {
  if (playTimer) return stopPlaying();
  timelinePlay.textContent = "❚❚";
  timelinePlay.setAttribute("aria-label", "Pause timeline");
  let year = Number(timeline.min);
  setTimelineYear(year);
  playTimer = setInterval(() => {
    year += 1;
    setTimelineYear(year);
    if (year >= Number(timeline.max)) stopPlaying();
  }, 1000);
});

timeline.addEventListener("input", () => {
  stopPlaying();
  setTimelineYear(Number(timeline.value));
});

// Heatmap: density of the members currently shown, optionally narrowed to one industry or heritage.
function heatGeoJSON(rows) {
  return {
    type: "FeatureCollection",
    features: rows.map((m) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      properties: { industry: m.industry ?? "", heritage: m.heritage ?? "" },
    })),
  };
}

function updateHeat(rows) {
  map.getSource("heat")?.setData(heatGeoJSON(rows));
}

function heatFilter() {
  return heatMeasure.value && heatValue.value ? ["==", ["get", heatMeasure.value], heatValue.value] : null;
}

// Called from app.js on every style load, below the member layers.
function addHeatLayer() {
  map.addSource("heat", { type: "geojson", data: heatGeoJSON(visibleMembers) });
  map.addLayer({
    id: "member-heat",
    type: "heatmap",
    source: "heat",
    layout: { visibility: heatOn ? "visible" : "none" },
    ...(heatFilter() ? { filter: heatFilter() } : {}),
    paint: {
      "heatmap-weight": 1,
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1.4, 8, 3],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 16, 4, 30, 8, 55],
      "heatmap-opacity": 0.85,
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0, "rgba(168, 85, 247, 0)",
        0.2, "rgba(107, 33, 168, 0.55)",
        0.45, "#a855f7",
        0.7, "#00c853",
        1, "#d9ffe8",
      ],
    },
  });
}

// The heatmap replaces the member dots while it's on; city labels stay.
function applyHeatVisibility() {
  if (!map.getLayer("member-heat")) return;
  map.setLayoutProperty("member-heat", "visibility", heatOn ? "visible" : "none");
  map.setFilter("member-heat", heatFilter());
  for (const id of MEMBER_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", heatOn ? "none" : "visible");
}

function refreshHeatValues() {
  const key = heatMeasure.value;
  heatValue.hidden = !heatOn || !key;
  if (!key) return;
  const values = [...new Set(members.map((m) => m[key]).filter(Boolean))].sort();
  const current = heatValue.value;
  heatValue.replaceChildren(new Option(`Any ${key}`, ""), ...values.map((v) => new Option(v, v)));
  heatValue.value = values.includes(current) ? current : "";
}

function setHeat(on) {
  heatOn = on;
  heatToggle.setAttribute("aria-pressed", String(on));
  heatMeasure.hidden = !on;
  heatLegend.hidden = !on;
  if (on) popup.remove();
  refreshHeatValues();
  applyHeatVisibility();
}

heatToggle.addEventListener("click", () => setHeat(!heatOn));
heatMeasure.addEventListener("change", () => {
  heatValue.value = "";
  refreshHeatValues();
  applyHeatVisibility();
});
heatValue.addEventListener("change", applyHeatVisibility);
