import { getDepthColor } from './depth.js';

const WEED_RADIUS_KM = 0.010;
const MAX_GRID_CELLS = 40000;

export function createMap(elementId, center, zoom = 16) {
  const map = L.map(elementId).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  return map;
}

// Depth as it should be read on screen: the stored sounding plus the project's
// water-level offset.
export function displayDepth(reading, offset = 0) {
  return Number(reading.depth) + Number(offset || 0);
}

export function toFeatureCollection(points, offset = 0) {
  return turf.featureCollection(points.map(p => turf.point(
    [p.coords.longitude, p.coords.latitude],
    { depth: displayDepth(p, offset), hasWeeds: p.hasWeeds, isShore: p.isShore }
  )));
}

export function maxDepthOf(fc) {
  return Math.max(...fc.features.map(f => f.properties.depth), 1);
}

export function buildTinLayer(fc, maxDepth) {
  const tin = turf.tin(fc, 'depth');
  return L.geoJSON(tin, {
    style: (feature) => {
      const avg = (feature.properties.a + feature.properties.b + feature.properties.c) / 3;
      const color = getDepthColor(avg, maxDepth);
      return { fillColor: color, fillOpacity: 0.7, weight: 0.5, color, opacity: 0.8 };
    }
  });
}

// Keeps the interpolation grid to a sane number of cells; a wide bbox with the
// original fixed 5m cell could lock the browser up for minutes.
function gridCellSize(fc) {
  const [minX, minY, maxX, maxY] = turf.bbox(fc);
  const base = 0.00005;
  const cells = ((maxX - minX) / base) * ((maxY - minY) / base);
  if (cells <= MAX_GRID_CELLS) return base;
  return base * Math.sqrt(cells / MAX_GRID_CELLS);
}

export function buildContourLayer(fc, maxDepth) {
  const grid = turf.interpolate(fc, gridCellSize(fc), {
    gridType: 'point',
    property: 'depth',
    units: 'degrees',
    weight: 2
  });
  const breaks = Array.from({ length: Math.ceil(maxDepth) }, (_, i) => i + 1);
  const isobaths = turf.isolines(grid, breaks, { zProperty: 'depth' });
  return L.geoJSON(isobaths, {
    style: { color: '#000', weight: 1.5, opacity: 0.6, dashArray: '4,4' },
    onEachFeature: (feature, layer) => {
      if (feature.properties?.depth) {
        layer.bindTooltip(feature.properties.depth + 'm', { permanent: false, direction: 'center' });
      }
    }
  });
}

export function buildPointsLayer(fc, maxDepth, radius = 4) {
  return L.geoJSON(fc, {
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      radius,
      fillColor: getDepthColor(feature.properties.depth, maxDepth),
      color: '#333',
      weight: 1,
      fillOpacity: 0.9
    }),
    onEachFeature: (feature, layer) => {
      const weeds = feature.properties.hasWeeds ? ' (weeds)' : '';
      layer.bindPopup(`Depth: ${feature.properties.depth.toFixed(1)}m${weeds}`);
    }
  });
}

export function buildWeedsLayer(points) {
  const weedPoints = points.filter(p => p.hasWeeds);
  if (!weedPoints.length) return null;

  const buffered = weedPoints.map(p =>
    turf.buffer(turf.point([p.coords.longitude, p.coords.latitude]), WEED_RADIUS_KM, { units: 'kilometers' })
  );

  let cloud;
  try {
    cloud = buffered.length === 1
      ? buffered[0]
      : buffered.reduce((acc, buf) => {
          try {
            return turf.union(acc, buf);
          } catch {
            return acc;
          }
        });
  } catch {
    cloud = turf.featureCollection(buffered);
  }

  return L.geoJSON(cloud, {
    style: { fillColor: '#228B22', fillOpacity: 0.5, color: '#228B22', weight: 0, opacity: 0 },
    onEachFeature: (feature, layer) => {
      const blur = () => {
        if (layer._path) layer._path.style.filter = 'url(#weed-blur)';
      };
      blur();
      layer.on('add', blur);
    }
  });
}

function emojiMarkerLayer(features, { html, className, size, popup }) {
  return L.geoJSON(turf.featureCollection(features), {
    pointToLayer: (feature, latlng) => L.marker(latlng, {
      icon: L.divIcon({ className, html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
    }),
    onEachFeature: (feature, layer) => layer.bindPopup(popup(feature.properties))
  });
}

export function buildShoreLayer(points, size = 24) {
  const shore = points.filter(p => p.isShore);
  if (!shore.length) return null;
  return emojiMarkerLayer(
    shore.map(p => turf.point([p.coords.longitude, p.coords.latitude], { createdAt: p.createdAt })),
    {
      html: '🏖️',
      className: 'shore-map-marker',
      size,
      popup: (props) => `Shore line (${new Date(props.createdAt).toLocaleDateString()})`
    }
  );
}

export function buildFishLayer(catches, size = 24) {
  const located = (catches || []).filter(f => f.latitude && f.longitude);
  if (!located.length) return null;
  return emojiMarkerLayer(
    located.map(f => turf.point([f.longitude, f.latitude], {
      fishType: f.fishType, weight: f.weight, length: f.length, notes: f.notes
    })),
    {
      html: '🐟',
      className: 'fish-map-marker',
      size,
      popup: (props) => {
        const details = [
          props.fishType || 'Unknown',
          props.weight ? `${props.weight}kg` : null,
          props.length ? `${props.length}cm` : null,
          props.notes || null
        ].filter(Boolean).join(' • ');
        return `🐟 ${details}`;
      }
    }
  );
}

export function renderLegend(container, maxDepth, { offset = 0 } = {}) {
  if (!container) return;
  container.innerHTML = '';
  const steps = [0, 5, 10, 15, 20, Math.ceil(maxDepth)].filter((d, i, arr) => d <= Math.ceil(maxDepth) && arr.indexOf(d) === i);

  for (const d of steps) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = getDepthColor(d, maxDepth);
    item.append(swatch, document.createTextNode(`${d}m`));
    container.appendChild(item);
  }

  const marker = (className, text, label) => {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const mark = document.createElement('span');
    mark.className = className;
    if (text) mark.textContent = text;
    item.append(mark, document.createTextNode(label));
    container.appendChild(item);
  };
  marker('legend-weeds', '', 'Weeds');
  marker('legend-fish', '🏖️', 'Shore');
  marker('legend-fish', '🐟', 'Fish');

  if (offset) {
    const note = document.createElement('span');
    note.className = 'legend-item legend-offset';
    note.textContent = `depths include ${offset > 0 ? '+' : ''}${offset}m offset`;
    container.appendChild(note);
  }
}
