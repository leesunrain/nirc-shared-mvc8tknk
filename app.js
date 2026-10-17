const $ = selector => document.querySelector(selector);
const DISTANCES = {
  '5': { label: '5km', km: 5, factor: 0.30 },
  '10': { label: '10km', km: 10, factor: 0.44 },
  '21.0975': { label: '하프', km: 21.0975, factor: 0.72 },
  '42.195': { label: '풀', km: 42.195, factor: 1 }
};

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function dewPoint(temp, rh) {
  const a = 17.625, b = 243.04;
  const gamma = Math.log(rh / 100) + (a * temp) / (b + temp);
  return (b * gamma) / (a - gamma);
}

function wetBulb(temp, rh) {
  return temp * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
    + Math.atan(temp + rh) - Math.atan(rh - 1.676331)
    + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035;
}

/* 연구에서 확인된 비선형 열 저하 경향을 구현한 앱용 추정곡선이다. */
function marathonHeatLoss(wbgt) {
  let excess = Math.max(0, wbgt - 10), loss = 0;
  const bands = [[4, 0.12], [4, 0.25], [4, 0.42], [Infinity, 0.60]];
  for (const [width, slope] of bands) {
    if (excess <= 0) break;
    const amount = Math.min(excess, width);
    loss += amount * slope;
    excess -= amount;
  }
  return Math.min(loss, 12);
}

function paceFactor(paceSeconds) { return clamp(1 + (300 - paceSeconds) / 900, 0.90, 1.10); }
function estimateLoss(wbgt, distanceKey, paceSeconds, acclimation) {
  return marathonHeatLoss(wbgt) * DISTANCES[distanceKey].factor * paceFactor(paceSeconds) * acclimation;
}
function uncertainty(loss, distanceKey) {
  const distanceExtra = distanceKey === '42.195' ? 0.08 : distanceKey === '21.0975' ? 0.05 : 0;
  return clamp(0.20 + distanceExtra + Math.max(0, loss - 3) * 0.012, 0.20, 0.32);
}
function parsePace(value) {
  const match = value.trim().match(/^(\d{1,2})[:\-](\d{1,2})$/);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return seconds >= 120 && seconds <= 900 ? seconds : null;
}
function formatPace(seconds) {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
function formatRaceTime(seconds) {
  const rounded = Math.round(seconds), hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60), secs = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}
function selected(name) { return document.querySelector(`input[name="${name}"]:checked`).value; }
function modelFor(distanceKey, pace, wbgt, acclimation) {
  const loss = estimateLoss(wbgt, distanceKey, pace, acclimation);
  const add = pace * loss / 100, ratio = uncertainty(loss, distanceKey);
  return {
    loss, add,
    low: Math.max(0, Math.round(add * (1 - ratio))),
    high: Math.round(add * (1 + ratio)),
    total: (pace + add) * DISTANCES[distanceKey].km
  };
}

function renderComparison(pace, wbgt, acclimation, activeDistance) {
  $('#distanceCompare').innerHTML = Object.entries(DISTANCES).map(([key, distance]) => {
    const result = modelFor(key, pace, wbgt, acclimation);
    return `<div class="compare-item${key === activeDistance ? ' active' : ''}"><span>${distance.label}</span><strong>+${Math.round(result.add)}초/km</strong><small>${formatRaceTime(result.total)}</small></div>`;
  }).join('');
}

function update() {
  const pace = parsePace($('#pace').value), temp = Number($('#temp').value);
  const rh = clamp(Number($('#rh').value), 5, 100);
  if (!pace || !Number.isFinite(temp) || !Number.isFinite(rh)) return;
  const sun = Number(selected('sun')), distanceKey = selected('distance');
  const acclimation = Number(selected('acclimation'));
  const dew = dewPoint(temp, rh), wet = wetBulb(temp, rh), wbgt = 0.7 * wet + 0.3 * temp + sun;
  const result = modelFor(distanceKey, pace, wbgt, acclimation);
  const adjustedPace = pace + result.add, add400 = result.add * 0.4, base400 = pace * 0.4;

  $('#selectedDistance').textContent = DISTANCES[distanceKey].label;
  $('#dew').textContent = `${dew.toFixed(1)}°C`;
  $('#wet').textContent = `${wet.toFixed(1)}°C`;
  $('#wbgt').textContent = `${wbgt.toFixed(1)}°C`;
  $('#tempSummary').textContent = `${temp.toFixed(1)}°C`;
  $('#rhSummary').textContent = `${Math.round(rh)}%`;
  $('#dewSummary').textContent = `${dew.toFixed(1)}°C`;
  $('#addKm').textContent = `+${Math.round(result.add)}`;
  $('#rangeKm').textContent = `권장 범위 +${result.low}~${result.high}초/km · ${DISTANCES[distanceKey].label}`;
  $('#originalPace').textContent = `${formatPace(pace)}/km`;
  $('#adjusted').textContent = `${formatPace(adjustedPace)}/km`;
  $('#add400').textContent = `+${Math.round(add400)}초`;
  $('#lap400').textContent = formatPace(base400 + add400);
  $('#loss').textContent = `${result.loss.toFixed(1)}%`;
  $('#finalTime').textContent = formatRaceTime(result.total);
  renderComparison(pace, wbgt, acclimation, distanceKey);

  let label = '부담 낮음', color = '#0d7b51';
  if (wbgt >= 18) { label = '주의'; color = '#b26a00'; }
  if (wbgt >= 23) { label = '높은 부담'; color = '#c34825'; }
  if (wbgt >= 28) { label = '기록보다 안전 우선'; color = '#a71d31'; }
  $('#status').textContent = label;
  $('#statusDot').style.background = color;
  localStorage.setItem('heatPace', JSON.stringify({ pace: $('#pace').value, temp, rh, sun, distance: distanceKey, acclimation }));
}

document.querySelectorAll('input,select').forEach(element => element.addEventListener('input', update));
$('#reset').addEventListener('click', () => {
  localStorage.removeItem('heatPace');
  $('#pace').value = '4:30'; $('#temp').value = '25'; $('#rh').value = '70';
  document.querySelector('input[name="sun"][value="0"]').checked = true;
  document.querySelector('input[name="distance"][value="10"]').checked = true;
  document.querySelector('input[name="acclimation"][value="1"]').checked = true;
  update();
});

try {
  const saved = JSON.parse(localStorage.getItem('heatPace'));
  if (saved) {
    $('#pace').value = saved.pace || '4:30'; $('#temp').value = saved.temp ?? 25; $('#rh').value = saved.rh ?? 70;
    const sunInput = document.querySelector(`input[name="sun"][value="${saved.sun ?? 0}"]`);
    const distanceInput = document.querySelector(`input[name="distance"][value="${saved.distance || '10'}"]`);
    const acclimationInput = document.querySelector(`input[name="acclimation"][value="${saved.acclimation ?? 1}"]`);
    if (sunInput) sunInput.checked = true;
    if (distanceInput) distanceInput.checked = true;
    if (acclimationInput) acclimationInput.checked = true;
  }
} catch (error) { console.warn('저장된 설정을 불러오지 못했습니다.', error); }
update();

function coordinateName(lat, lon) { return `위도 ${Number(lat).toFixed(3)}, 경도 ${Number(lon).toFixed(3)}`; }
async function placeNameAt(lat, lon) {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ko`;
    const data = await fetch(url).then(response => { if (!response.ok) throw new Error(); return response.json(); });
    const parts = [data.locality || data.city, data.principalSubdivision].filter(Boolean);
    return [...new Set(parts)].join(', ') || coordinateName(lat, lon);
  } catch (error) { return coordinateName(lat, lon); }
}
function showPlace(name, time) {
  $('#currentPlace').textContent = name;
  $('#observedAt').textContent = time ? `${time.replace('T', ' ')} 기준` : '직접 입력한 날씨';
  $('#locationState').textContent = time ? `${name} · ${time.replace('T', ' ')} 기준` : name;
}
async function weatherAt(lat, lon, name) {
  const state = $('#locationState'); state.textContent = '날씨와 지역명을 불러오는 중…';
  $('#currentPlace').textContent = '위치를 확인하는 중…';
  try {
    const place = name || await placeNameAt(lat, lon);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m&timezone=auto`;
    const data = await fetch(url).then(response => { if (!response.ok) throw new Error(); return response.json(); });
    $('#temp').value = data.current.temperature_2m; $('#rh').value = data.current.relative_humidity_2m;
    showPlace(place, data.current.time); update();
  } catch (error) {
    showPlace(name || coordinateName(lat, lon), '');
    state.textContent = '날씨를 가져오지 못했습니다. 직접 입력해 주세요.';
  }
}
async function networkLocation() {
  const state = $('#locationState'); state.textContent = '정확한 위치 권한이 없어 대략적인 현재 지역을 확인 중…';
  try {
    const data = await fetch('https://ipwho.is/').then(response => { if (!response.ok) throw new Error(); return response.json(); });
    if (!data.success || !Number.isFinite(data.latitude)) throw new Error();
    await weatherAt(data.latitude, data.longitude, `${[data.city, data.region].filter(Boolean).join(', ')} (대략적 위치)`);
  } catch (error) { state.textContent = '현재 위치를 확인하지 못했습니다. 아래에서 지역을 검색해 주세요.'; }
}
function locate() {
  const state = $('#locationState');
  if (!navigator.geolocation) { networkLocation(); return; }
  state.textContent = '현재 위치 확인 중…';
  navigator.geolocation.getCurrentPosition(
    position => weatherAt(position.coords.latitude, position.coords.longitude), networkLocation,
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 }
  );
}
async function searchPlace() {
  const query = $('#place').value.trim(), box = $('#placeResults');
  if (!query) return;
  $('#locationState').textContent = '지역 검색 중…';
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=ko&format=json`;
    const data = await fetch(url).then(response => response.json()), rows = data.results || [];
    box.innerHTML = '';
    if (!rows.length) { box.hidden = true; $('#locationState').textContent = '검색 결과가 없습니다.'; return; }
    rows.forEach(place => {
      const button = document.createElement('button');
      button.textContent = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
      button.onclick = () => { box.hidden = true; $('#place').value = place.name; weatherAt(place.latitude, place.longitude, button.textContent); };
      box.appendChild(button);
    });
    box.hidden = false; $('#locationState').textContent = '아래에서 지역을 선택하세요.';
  } catch (error) { $('#locationState').textContent = '지역 검색에 실패했습니다.'; }
}
$('#locate').addEventListener('click', locate);
$('#searchPlace').addEventListener('click', searchPlace);
$('#place').addEventListener('keydown', event => { if (event.key === 'Enter') searchPlace(); });
locate();
