// Fetch Register adries (INSPIRE ad:Address) points for a bbox via WFS, parse the GML
// into flat address records, write GeoJSON. Usage: node src/fetchRa.ts "<minx miny maxx maxy>" <out.geojson>
import { writeFileSync } from "node:fs";

const WFS = "https://rageo.minv.sk/geoserver/ad/ows";
const [mnx, mny, mxx, mxy] = process.argv[2].split(/\s+/).map(Number);
const out = process.argv[3];
// WFS 2.0 with EPSG:4258 (urn) uses lat,lon axis order.
const bbox = `${mny},${mnx},${mxy},${mxx},urn:ogc:def:crs:EPSG::4258`;

const PAGE = 5000; // GeoServer caps a page at 5000 features
const members: string[] = [];
let matched = Infinity;
for (let start = 0; members.length < matched; start += PAGE) {
  const url =
    `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=ad:Address` +
    `&count=${PAGE}&startIndex=${start}&bbox=${encodeURIComponent(bbox)}`;
  const xml = await (await fetch(url, { headers: { "User-Agent": "volebna-mapa/0.1" } })).text();
  const page = xml.split("<wfs:member>").slice(1).map((m) => m.split("</wfs:member>")[0]);
  matched = +(xml.match(/numberMatched="(\d+)"/)?.[1] ?? matched);
  members.push(...page);
  process.stdout.write(`\r fetched ${members.length}/${matched}`);
  if (page.length === 0) break;
}
console.log();

type Rec = { lon: number; lat: number; raId: string | null; street: string | null; orient: string | null; supisne: string | null };
const parseMember = (m: string): Rec | null => {
  const pos = m.match(/<gml:pos>([^<]+)<\/gml:pos>/);
  if (!pos) return null;
  const [lat, lon] = pos[1].trim().split(/\s+/).map(Number);
  // The Address feature's own INSPIRE identifier = OSM `ref:minvskaddress` (a numeric RA
  // address-point id). Prefer inspireId/localId; fall back to the Address gml:id suffix.
  const raId = (m.match(/<(?:\w+:)?localId>\s*([^<]+?)\s*<\/(?:\w+:)?localId>/)
    ?? m.match(/gml:id="(?:ad\.)?Address\.(\d+)"/i))?.[1]?.trim() ?? null;
  let orient: string | null = null;
  let supisne: string | null = null;
  const dre = /<ad:designator>([^<]*)<\/ad:designator>\s*<ad:type[^>]*LocatorDesignatorTypeValue\/([a-zA-Z]+)/g;
  let d: RegExpExecArray | null;
  while ((d = dre.exec(m))) {
    if (d[2] === "addressNumber") supisne = d[1].trim();
    else if (d[2] === "buildingIdentifier") orient = d[1].trim();
  }
  const st = m.match(/id=ThoroughfareName\.\d+"\s+xlink:title="([^"]+)"/);
  return { lon, lat, raId, street: st ? st[1] : null, orient, supisne };
};

const recs = members.map(parseMember).filter((r): r is Rec => r !== null);
console.log(`parsed: ${recs.length}   with street: ${recs.filter((r) => r.street).length}   with súpisné: ${recs.filter((r) => r.supisne).length}   with ra_id: ${recs.filter((r) => r.raId).length}`);

writeFileSync(
  out,
  JSON.stringify({
    type: "FeatureCollection",
    features: recs.map((r) => ({ type: "Feature", geometry: { type: "Point", coordinates: [r.lon, r.lat] }, properties: { ra_id: r.raId, street: r.street, orient: r.orient, supisne: r.supisne } })),
  }),
);
console.log(`wrote ${out} (${recs.length})`);
