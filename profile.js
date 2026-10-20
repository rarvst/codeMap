// Google sign-in and the "My Profile" panel, where members add or edit themselves on the map.
const joinButton = document.getElementById("join-button");
const profilePanel = document.getElementById("profile-panel");
const profileClose = document.getElementById("profile-close");
const profileForm = document.getElementById("profile-form");
const cityInput = document.getElementById("profile-city");
const citySuggestions = document.getElementById("city-suggestions");
const photoInput = document.getElementById("profile-photo");
const photoRemove = document.getElementById("photo-remove");
const photoPreview = document.getElementById("photo-preview");
const profileStatus = document.getElementById("profile-status");
const saveButton = document.getElementById("profile-save");
const signOutButton = document.getElementById("profile-signout");
const deleteButton = document.getElementById("profile-delete");

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

let currentUser = null;
let chosenCity = null; // { city, country, lat, lng }, set only by picking a search result
let imageUrl = null; // saved photo URL (or the Google avatar for new profiles)
let photoFile = null; // newly picked file, uploaded on save
let promptedForProfile = false;

// Heritage options: every ISO country, named in English by the browser.
const COUNTRY_CODES =
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FO FR GA GB GD GE GH GI GL GM GN GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NZ OM PA PE PF PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WS XK YE ZA ZM ZW";
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const heritageSelect = profileForm.elements.heritage;
for (const name of COUNTRY_CODES.split(" ").map((code) => regionNames.of(code)).sort((a, b) => a.localeCompare(b))) {
  heritageSelect.add(new Option(name, name));
}

function setStatus(message, isError = false) {
  profileStatus.textContent = message;
  profileStatus.classList.toggle("error", isError);
}

function updateJoinButton() {
  joinButton.textContent = currentUser ? "My profile" : "Join the map";
}

async function fetchOwnProfile() {
  const { data, error } = await db.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchOwnContact() {
  const { data, error } = await db.from("profile_contacts").select("email, phone").eq("id", currentUser.id).maybeSingle();
  if (error) throw error;
  return data;
}

function showPhotoPreview(src, name) {
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    photoPreview.replaceChildren(img);
  } else {
    photoPreview.replaceChildren(initials(name) || "?");
  }
  photoRemove.hidden = !src;
}

function fillForm(profile, contact) {
  const meta = currentUser.user_metadata ?? {};
  const f = profileForm.elements;
  f.name.value = profile?.name ?? meta.full_name ?? meta.name ?? "";
  f.year.value = profile?.year ?? "";
  f.linkedin.value = profile?.linkedin_url ?? "";
  f.website.value = profile?.website_url ?? "";
  f.heritage.value = profile?.heritage ?? "";
  f.industry.value = profile?.industry ?? "";
  f.company.value = profile?.company ?? "";
  f.position.value = profile?.code_position ?? "";
  f.email.value = contact?.email ?? "";
  f.phone.value = contact?.phone ?? "";
  chosenCity = profile ? { city: profile.city, country: profile.country, lat: profile.lat, lng: profile.lng } : null;
  cityInput.value = profile ? `${profile.city}, ${profile.country}` : "";
  imageUrl = profile ? profile.image_url : meta.avatar_url ?? null;
  photoFile = null;
  photoInput.value = "";
  showPhotoPreview(imageUrl, f.name.value);
  deleteButton.hidden = !profile;
}

async function openProfile() {
  profilePanel.hidden = false;
  setStatus("Loading…");
  try {
    const [profile, contact] = await Promise.all([fetchOwnProfile(), fetchOwnContact()]);
    fillForm(profile, contact);
    setStatus(profile ? "" : "Fill in your details to appear on the map.");
  } catch (err) {
    setStatus(err.message, true);
  }
}

function closeProfile() {
  profilePanel.hidden = true;
  showSuggestions([]);
}

joinButton.addEventListener("click", async () => {
  if (currentUser) return openProfile();
  const { error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) alert(`Sign-in failed: ${error.message}`);
});

profileClose.addEventListener("click", closeProfile);

signOutButton.addEventListener("click", async () => {
  await db.auth.signOut();
  closeProfile();
});

// Supabase warns against awaiting its own calls inside this callback, so follow-up work is deferred.
db.auth.onAuthStateChange((event, session) => {
  currentUser = session?.user ?? null;
  updateJoinButton();
  if (event === "TOKEN_REFRESHED") return;
  setTimeout(async () => {
    // Contact details are only readable when signed in, so reload when that changes.
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") loadMembers();
    if (!currentUser) return setOrigin(null);
    try {
      const profile = await fetchOwnProfile();
      setOrigin(profile);
      // First visit after signing in: open the form straight away if they aren't on the map yet.
      if (!profile && !promptedForProfile) openProfile();
      promptedForProfile = true;
    } catch (err) {
      console.error(err);
    }
  });
});

// City search (Photon, OpenStreetMap data). Coordinates are rounded to ~1 km so only the city is stored.
let citySearchTimer = null;
let citySearchController = null;
const roundCoord = (value) => Math.round(value * 100) / 100;

function showSuggestions(cities) {
  citySuggestions.replaceChildren();
  citySuggestions.hidden = cities.length === 0;
  cityInput.setAttribute("aria-expanded", String(cities.length > 0));
  for (const c of cities) {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = [c.city, c.region, c.country].filter(Boolean).join(", ");
    button.addEventListener("click", () => {
      chosenCity = { city: c.city, country: c.country, lat: c.lat, lng: c.lng };
      cityInput.value = `${c.city}, ${c.country}`;
      showSuggestions([]);
    });
    li.append(button);
    citySuggestions.append(li);
  }
}

async function searchCities(query) {
  citySearchController?.abort();
  citySearchController = new AbortController();
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=en&layer=city`;
    const res = await fetch(url, { signal: citySearchController.signal });
    const { features } = await res.json();
    showSuggestions(
      features
        .filter((f) => f.properties.name && f.properties.country)
        .map((f) => ({
          city: f.properties.name,
          region: f.properties.state,
          country: f.properties.country,
          lng: roundCoord(f.geometry.coordinates[0]),
          lat: roundCoord(f.geometry.coordinates[1]),
        }))
    );
  } catch (err) {
    if (err.name !== "AbortError") showSuggestions([]);
  }
}

cityInput.addEventListener("input", () => {
  chosenCity = null;
  clearTimeout(citySearchTimer);
  const query = cityInput.value.trim();
  if (query.length < 2) return showSuggestions([]);
  citySearchTimer = setTimeout(() => searchCities(query), 300);
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".city-field")) showSuggestions([]);
});

// Photo: previewed locally, uploaded on save into the member's own folder.
photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  if (!file) return;
  if (!PHOTO_EXTENSIONS[file.type]) return setStatus("Photo must be a JPG, PNG or WebP image.", true);
  if (file.size > MAX_PHOTO_BYTES) return setStatus("Photo must be 2 MB or smaller.", true);
  photoFile = file;
  showPhotoPreview(URL.createObjectURL(file), profileForm.elements.name.value);
  setStatus("");
});

photoRemove.addEventListener("click", () => {
  imageUrl = null;
  photoFile = null;
  photoInput.value = "";
  showPhotoPreview(null, profileForm.elements.name.value);
});

async function removeOldPhotos(keepPath) {
  const folder = currentUser.id;
  const { data } = await db.storage.from("avatars").list(folder);
  const stale = (data ?? []).map((file) => `${folder}/${file.name}`).filter((path) => path !== keepPath);
  if (stale.length) await db.storage.from("avatars").remove(stale);
}

async function uploadPhoto(file) {
  const path = `${currentUser.id}/avatar-${Date.now()}.${PHOTO_EXTENSIONS[file.type]}`;
  const { error } = await db.storage.from("avatars").upload(path, file, { contentType: file.type });
  if (error) throw error;
  await removeOldPhotos(path);
  return db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

// Let people type "github.com/me" without the https:// prefix.
for (const input of [profileForm.elements.linkedin, profileForm.elements.website]) {
  input.addEventListener("blur", () => {
    const value = input.value.trim();
    if (value && !/^https?:\/\//i.test(value)) input.value = `https://${value}`;
  });
}

function validateForm() {
  const f = profileForm.elements;
  if (!f.name.value.trim()) return "Enter your name.";
  if (!f.year.checkValidity() || !f.year.value) return "Enter a class year between 1950 and 2100.";
  if (!chosenCity) return "Pick your city from the search results.";
  const linkedin = f.linkedin.value.trim();
  if (linkedin && !/^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(linkedin)) return "LinkedIn link should look like https://linkedin.com/in/you";
  const website = f.website.value.trim();
  if (website && !safeUrl(website)) return "Website link should start with https://";
  const email = f.email.value.trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "Enter a valid email address.";
  const phone = f.phone.value.trim();
  if (phone && !/^\+?[0-9 ().-]{7,25}$/.test(phone)) return "Phone can contain digits, spaces, + ( ) - and . only.";
  return null;
}

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const problem = validateForm();
  if (problem) return setStatus(problem, true);

  const f = profileForm.elements;
  saveButton.disabled = true;
  setStatus("Saving…");
  try {
    if (photoFile) imageUrl = await uploadPhoto(photoFile);
    else if (!imageUrl) await removeOldPhotos(null);
    photoFile = null;

    const profile = {
      id: currentUser.id,
      name: f.name.value.trim(),
      year: Number(f.year.value),
      ...chosenCity,
      linkedin_url: f.linkedin.value.trim() || null,
      website_url: f.website.value.trim() || null,
      image_url: imageUrl,
      heritage: f.heritage.value || null,
      industry: f.industry.value.trim() || null,
      company: f.company.value.trim() || null,
      code_position: f.position.value || null,
    };
    const { error } = await db.from("profiles").upsert(profile);
    if (error) throw error;

    const email = f.email.value.trim();
    const phone = f.phone.value.trim();
    const { error: contactError } =
      email || phone
        ? await db.from("profile_contacts").upsert({ id: currentUser.id, email: email || null, phone: phone || null })
        : await db.from("profile_contacts").delete().eq("id", currentUser.id);
    if (contactError) throw contactError;

    deleteButton.hidden = false;
    setStatus("Saved. You're on the map!");
    await loadMembers();
    setOrigin(profile);
    map.flyTo({ center: [chosenCity.lng, chosenCity.lat], zoom: 6, speed: 0.9, curve: 1.6, essential: true });
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    saveButton.disabled = false;
  }
});

deleteButton.addEventListener("click", async () => {
  if (!confirm("Remove your profile from the map?")) return;
  setStatus("Deleting…");
  try {
    const { error } = await db.from("profiles").delete().eq("id", currentUser.id);
    if (error) throw error;
    await removeOldPhotos(null);
    await loadMembers();
    setOrigin(null);
    fillForm(null, null);
    setStatus("Your profile was removed.");
  } catch (err) {
    setStatus(err.message, true);
  }
});
