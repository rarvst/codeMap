// Map tools: a class-year timeline.
const timeline = document.getElementById("timeline");
const timelineValue = document.getElementById("timeline-value");
const timelinePlay = document.getElementById("timeline-play");

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
